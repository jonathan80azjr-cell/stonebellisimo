import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { GROWTH_CLIENT } from './growth-client-config.mjs';
import { leadHasDesignation } from './lead-designations.mjs';

const COLLECTIONS = {
  leads: 'leads',
  emailEvents: 'email_events',
  feedback: 'feedback',
  reviewRequests: 'review_requests',
  inboundEvents: 'postmark_inbound_events',
  deliveryEvents: 'postmark_delivery_events'
};

const SALES_STATUSES = new Set(GROWTH_CLIENT.stages);

function rows(snapshot) {
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
}

function newestFirst(left, right) {
  return String(right.createdAt || right.receivedAt || right.submittedAt || '')
    .localeCompare(String(left.createdAt || left.receivedAt || left.submittedAt || ''));
}

function matchesStatus(lead, status) {
  if (['new', 'progress_completed', 'needs_feedback', 'feedback_sent', 'feedback_received', 'email_issue'].includes(status)) {
    return leadHasDesignation(lead, status);
  }
  if (SALES_STATUSES.has(status)) return lead.salesStatus === status;
  if (['new', 'in_progress', 'completed'].includes(status)) {
    return (lead.businessStatus || 'new') === status;
  }
  if (status === 'needs_feedback') {
    return ['pending', 'sending'].includes(lead.feedbackStatus || 'pending') && !lead.feedbackEmailSentAt;
  }
  if (status === 'feedback_sent') {
    return Boolean(lead.feedbackEmailSentAt) && !['received', 'unparsed'].includes(lead.feedbackStatus || 'pending');
  }
  if (status === 'feedback_received') {
    return ['received', 'unparsed'].includes(lead.feedbackStatus || 'pending');
  }
  if (status === 'email_failed') return Boolean(lead.feedbackEmailLastError);
  return true;
}

function matchesSearch(lead, search) {
  if (!search) return true;
  const query = String(search).toLowerCase();
  return [
    lead.customerName,
    lead.email,
    lead.phone,
    lead.projectType,
    lead.material,
    lead.source
  ].join(' ').toLowerCase().includes(query);
}

function eventId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function encodeCursor(lead) {
  return Buffer.from(JSON.stringify({ submittedAt: lead.submittedAt || '', id: lead.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return value?.submittedAt && value?.id ? value : null;
  } catch {
    return null;
  }
}

export function createFirestoreStore(db) {
  if (!db) throw new Error('Firestore is not configured.');

  const leads = db.collection(COLLECTIONS.leads);

  return {
    async countRecentByIpHash(ipHash, sinceIso) {
      const snapshot = await leads
        .where('ipHash', '==', ipHash)
        .where('submittedAt', '>=', sinceIso)
        .count()
        .get();
      return Number(snapshot.data().count || 0);
    },

    async createLead(lead) {
      await leads.doc(lead.id).create({ ...lead });
      return lead;
    },

    async getLeadById(id) {
      const snapshot = await leads.doc(id).get();
      return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    },

    async updateLeadBusiness(id, update) {
      const reference = leads.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return null;
        const current = snapshot.data();
        const becomingCompleted = update.businessStatus === 'completed' && current.businessStatus !== 'completed';
        const completedAt = update.businessStatus === 'completed' ? (current.completedAt || update.updatedAt) : null;
        const saved = {
          businessStatus: update.businessStatus,
          salesStatus: update.salesStatus || current.salesStatus || null,
          designation: update.designation === undefined ? (current.designation || null) : update.designation,
          clientChargeCents: update.clientChargeCents,
          biteSitesShareCents: update.biteSitesShareCents,
          biteSitesRateBps: update.biteSitesRateBps,
          completedAt,
          stageTimestamps: update.salesStatus ? {
            ...(current.stageTimestamps || {}),
            [update.stageTimestampField]: current.stageTimestamps?.[update.stageTimestampField] || update.updatedAt
          } : (current.stageTimestamps || {}),
          outcomeVersion: update.outcomeVersion || current.outcomeVersion || GROWTH_CLIENT.programCode,
          updatedAt: update.updatedAt
        };
        // A completion is the only event that starts the public review flow.
        // Do not overwrite an existing due date on repeated admin saves.
        if (becomingCompleted && !current.reviewRequestDueAt) {
          saved.reviewRequestDueAt = new Date(new Date(completedAt).getTime() + GROWTH_CLIENT.reputation.initial_request_delay_days * 24 * 60 * 60 * 1000).toISOString();
          saved.reviewRequestStatus = 'pending';
          saved.reviewRequestAttemptCount = 0;
          transaction.set(db.collection(COLLECTIONS.reviewRequests).doc(`${snapshot.id}_request`), {
            id: `${snapshot.id}_request`, leadId: snapshot.id, kind: 'request', state: 'pending', dueAt: saved.reviewRequestDueAt,
            claimedAt: null, sentAt: null, failedAt: null, leaseExpiresAt: null, createdAt: update.updatedAt, updatedAt: update.updatedAt
          }, { merge: true });
        }
        transaction.update(reference, saved);
        return { ...current, ...saved, id: snapshot.id };
      });
    },

    async getLatestLead() {
      const snapshot = await leads.orderBy('submittedAt', 'desc').limit(1).get();
      return snapshot.empty ? null : { ...snapshot.docs[0].data(), id: snapshot.docs[0].id };
    },

    async listLeadsSince(sinceIso, limit = 500) {
      const snapshot = await leads
        .where('submittedAt', '>=', sinceIso)
        .orderBy('submittedAt', 'asc')
        .limit(limit)
        .get();
      return rows(snapshot);
    },

    async markImmediateEmailSent(id, sentAt, messageId) {
      const update = { immediateEmailSentAt: sentAt, updatedAt: sentAt };
      if (messageId) update.postmarkImmediateMessageId = messageId;
      await leads.doc(id).update(update);
    },

    async getDueFeedbackLeads(now, staleBefore, limit, maxAttempts) {
      const snapshot = await leads
        .where('feedbackEmailDueAt', '<=', now)
        .orderBy('feedbackEmailDueAt', 'asc')
        .limit(Math.min(Math.max(limit * 4, limit), 200))
        .get();

      return rows(snapshot)
        .filter(lead => !lead.feedbackEmailSentAt)
        .filter(lead => !['received', 'unparsed'].includes(lead.feedbackStatus || 'pending'))
        .filter(lead => Number(lead.feedbackEmailAttemptCount || 0) < maxAttempts)
        .filter(lead => !lead.feedbackEmailClaimedAt || lead.feedbackEmailClaimedAt <= staleBefore)
        .slice(0, limit);
    },

    async claimFeedbackLead(id, claimedAt, staleBefore) {
      const reference = leads.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return false;
        const lead = snapshot.data();
        const claimable = !lead.feedbackEmailSentAt &&
          !['received', 'unparsed'].includes(lead.feedbackStatus || 'pending') &&
          (!lead.feedbackEmailClaimedAt || lead.feedbackEmailClaimedAt <= staleBefore);
        if (!claimable) return false;
        transaction.update(reference, {
          feedbackEmailClaimedAt: claimedAt,
          feedbackStatus: 'sending',
          updatedAt: claimedAt
        });
        return true;
      });
    },

    async markFeedbackSent(id, sentAt, messageId) {
      await leads.doc(id).update({
        feedbackEmailSentAt: sentAt,
        feedbackEmailClaimedAt: null,
        feedbackStatus: 'sent',
        feedbackEmailLastError: null,
        postmarkFeedbackMessageId: messageId || null,
        updatedAt: sentAt
      });
    },

    async markFeedbackSendFailed(id, failedAt, errorMessage) {
      await leads.doc(id).update({
        feedbackEmailClaimedAt: null,
        feedbackStatus: 'pending',
        feedbackEmailAttemptCount: FieldValue.increment(1),
        feedbackEmailLastError: String(errorMessage || '').slice(0, 1000),
        updatedAt: failedAt
      });
    },

    async getDueReviewRequests(now, staleBefore, limit, maxAttempts) {
      const snapshot = await leads.where('reviewRequestDueAt', '<=', now)
        .orderBy('reviewRequestDueAt', 'asc').limit(Math.min(Math.max(limit * 4, limit), 200)).get();
      return rows(snapshot)
        .filter(lead => lead.businessStatus === 'completed')
        .filter(lead => !lead.reviewRequestSentAt)
        .filter(lead => !lead.reviewRequestRepliedAt)
        .filter(lead => !lead.reviewRequestUncertainAt)
        .filter(lead => lead.dnd !== true && !lead.optedOutAt)
        .filter(lead => Number(lead.reviewRequestAttemptCount || 0) < maxAttempts)
        .filter(lead => !lead.reviewRequestClaimedAt || lead.reviewRequestClaimedAt <= staleBefore)
        .slice(0, limit);
    },

    async getDueReviewReminders(now, staleBefore, limit, maxAttempts) {
      const snapshot = await leads.where('reviewReminderDueAt', '<=', now)
        .orderBy('reviewReminderDueAt', 'asc').limit(Math.min(Math.max(limit * 4, limit), 200)).get();
      return rows(snapshot)
        .filter(lead => lead.businessStatus === 'completed' && lead.reviewRequestSentAt)
        .filter(lead => !lead.reviewReminderSentAt && !lead.reviewRequestClickedAt && !lead.reviewRequestRepliedAt)
        .filter(lead => !lead.reviewReminderUncertainAt)
        .filter(lead => lead.dnd !== true && !lead.optedOutAt)
        .filter(lead => Number(lead.reviewReminderAttemptCount || 0) < maxAttempts)
        .filter(lead => !lead.reviewReminderClaimedAt || lead.reviewReminderClaimedAt <= staleBefore)
        .slice(0, limit);
    },

    async claimReviewRequest(id, kind, claimedAt, staleBefore) {
      const reference = leads.doc(id);
      const ledgerReference = db.collection(COLLECTIONS.reviewRequests).doc(`${id}_${kind}`);
      return db.runTransaction(async transaction => {
        const [snapshot, ledgerSnapshot] = await Promise.all([transaction.get(reference), transaction.get(ledgerReference)]);
        if (!snapshot.exists) return false;
        const lead = snapshot.data();
        const reminder = kind === 'reminder';
        const claimedField = reminder ? 'reviewReminderClaimedAt' : 'reviewRequestClaimedAt';
        const sentField = reminder ? 'reviewReminderSentAt' : 'reviewRequestSentAt';
        const dueField = reminder ? 'reviewReminderDueAt' : 'reviewRequestDueAt';
        const uncertainField = reminder ? 'reviewReminderUncertainAt' : 'reviewRequestUncertainAt';
        const ledger = ledgerSnapshot.exists ? ledgerSnapshot.data() : {};
        const allowed = lead.businessStatus === 'completed' && lead.dnd !== true && !lead.optedOutAt && !lead[sentField] && !lead.reviewRequestRepliedAt &&
          (!reminder || (!lead.reviewRequestClickedAt && lead.reviewRequestSentAt)) &&
          lead[dueField] && lead[dueField] <= claimedAt &&
          !lead[uncertainField] && !ledger.uncertainAt &&
          (!lead[claimedField] || lead[claimedField] <= staleBefore) &&
          !ledger.sentAt && (!ledger.claimedAt || ledger.claimedAt <= staleBefore);
        if (!allowed) return false;
        transaction.update(reference, { [claimedField]: claimedAt, reviewRequestStatus: reminder ? 'reminder_sending' : 'sending', updatedAt: claimedAt });
        transaction.set(ledgerReference, {
          id: `${id}_${kind}`, leadId: id, kind, state: 'claimed', dueAt: lead[dueField], claimedAt,
          leaseExpiresAt: new Date(new Date(claimedAt).getTime() + 15 * 60 * 1000).toISOString(), updatedAt: claimedAt
        }, { merge: true });
        return true;
      });
    },

    // A worker can lose eligibility after its transactional claim (for example,
    // an opt-out or reply may arrive between the claim and the fresh read).
    // Release only this exact lease; never disturb a later claimant or a sent
    // ledger entry.
    async releaseReviewRequestClaim(id, kind, claimedAt, reason = 'ineligible', releasedAt = claimedAt) {
      const reference = leads.doc(id);
      const ledgerReference = db.collection(COLLECTIONS.reviewRequests).doc(`${id}_${kind}`);
      return db.runTransaction(async transaction => {
        const [snapshot, ledgerSnapshot] = await Promise.all([transaction.get(reference), transaction.get(ledgerReference)]);
        const reminder = kind === 'reminder';
        const claimedField = reminder ? 'reviewReminderClaimedAt' : 'reviewRequestClaimedAt';
        const ledger = ledgerSnapshot.exists ? ledgerSnapshot.data() : null;
        if (!ledger || ledger.claimedAt !== claimedAt || ledger.sentAt) return false;
        const freshLead = snapshot.exists ? snapshot.data() : null;
        // `claimedAt` identifies the lease; it is not an event time. An
        // intervening opt-out/reply can have advanced either document since
        // that claim, so never move canonical timestamps backwards.
        const effectiveAt = [claimedAt, releasedAt, freshLead?.updatedAt, ledger.updatedAt]
          .filter(value => Number.isFinite(Date.parse(value)))
          .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || releasedAt;
        if (snapshot.exists) {
          const lead = freshLead;
          if (lead[claimedField] !== claimedAt) return false;
          const update = { [claimedField]: null, updatedAt: effectiveAt };
          // Preserve click/reply as the more informative terminal state.
          if (!lead.reviewRequestRepliedAt && !lead.reviewRequestClickedAt) update.reviewRequestStatus = 'suppressed';
          transaction.update(reference, update);
        }
        transaction.set(ledgerReference, {
          state: 'suppressed',
          claimedAt: null,
          leaseExpiresAt: null,
          suppressedAt: effectiveAt,
          suppressionReason: String(reason || 'ineligible').slice(0, 80),
          updatedAt: effectiveAt
        }, { merge: true });
        return true;
      });
    },

    async markReviewRequestSent(id, kind, sentAt, messageId) {
      const reminder = kind === 'reminder';
      const leadReference = leads.doc(id);
      const ledgerReference = db.collection(COLLECTIONS.reviewRequests).doc(`${id}_${kind}`);
      await db.runTransaction(async transaction => {
        const update = reminder ? {
        reviewReminderSentAt: sentAt, reviewReminderClaimedAt: null, reviewRequestStatus: 'reminder_sent',
        postmarkReviewReminderMessageId: messageId || null, updatedAt: sentAt
      } : {
        reviewRequestSentAt: sentAt, reviewRequestClaimedAt: null, reviewReminderDueAt: new Date(new Date(sentAt).getTime() + GROWTH_CLIENT.reputation.reminder_delay_days * 24 * 60 * 60 * 1000).toISOString(),
        reviewRequestStatus: 'sent', postmarkReviewRequestMessageId: messageId || null, updatedAt: sentAt
      };
        transaction.update(leadReference, update);
        transaction.set(ledgerReference, { state: 'sent', sentAt, claimedAt: null, leaseExpiresAt: null, messageId: messageId || null, updatedAt: sentAt }, { merge: true });
        if (!reminder) {
          transaction.set(db.collection(COLLECTIONS.reviewRequests).doc(`${id}_reminder`), {
            id: `${id}_reminder`, leadId: id, kind: 'reminder', state: 'pending', dueAt: update.reviewReminderDueAt,
            claimedAt: null, sentAt: null, failedAt: null, leaseExpiresAt: null, createdAt: sentAt, updatedAt: sentAt
          }, { merge: true });
        }
      });
    },

    async markReviewRequestSendFailed(id, kind, failedAt, errorMessage) {
      const reminder = kind === 'reminder';
      const update = reminder ? {
        reviewReminderClaimedAt: null, reviewReminderAttemptCount: FieldValue.increment(1), reviewRequestStatus: 'reminder_pending',
        reviewReminderLastError: String(errorMessage || '').slice(0, 1000), updatedAt: failedAt
      } : {
        reviewRequestClaimedAt: null, reviewRequestAttemptCount: FieldValue.increment(1), reviewRequestStatus: 'pending',
        reviewRequestLastError: String(errorMessage || '').slice(0, 1000), updatedAt: failedAt
      };
      const batch = db.batch();
      batch.update(leads.doc(id), update);
      batch.set(db.collection(COLLECTIONS.reviewRequests).doc(`${id}_${kind}`), {
        state: 'failed', claimedAt: null, failedAt, leaseExpiresAt: null, error: String(errorMessage || '').slice(0, 1000), updatedAt: failedAt
      }, { merge: true });
      await batch.commit();
    },

    async markReviewRequestUncertain(id, kind, uncertainAt, errorMessage) {
      const reminder = kind === 'reminder';
      const update = reminder ? {
        reviewReminderClaimedAt: null,
        reviewReminderUncertainAt: uncertainAt,
        reviewRequestStatus: 'reminder_uncertain',
        reviewReminderLastError: String(errorMessage || '').slice(0, 1000),
        updatedAt: uncertainAt
      } : {
        reviewRequestClaimedAt: null,
        reviewRequestUncertainAt: uncertainAt,
        reviewRequestStatus: 'uncertain',
        reviewRequestLastError: String(errorMessage || '').slice(0, 1000),
        updatedAt: uncertainAt
      };
      const batch = db.batch();
      batch.update(leads.doc(id), update);
      batch.set(db.collection(COLLECTIONS.reviewRequests).doc(`${id}_${kind}`), {
        state: 'uncertain',
        claimedAt: null,
        uncertainAt,
        leaseExpiresAt: null,
        error: String(errorMessage || '').slice(0, 1000),
        updatedAt: uncertainAt
      }, { merge: true });
      await batch.commit();
    },

    async recordReviewRequestToken(id, tokenHash, expiresAt, nonce, updatedAt) {
      await leads.doc(id).update({ reviewRequestTokenHash: tokenHash, reviewRequestTokenExpiresAt: expiresAt, reviewRequestTokenNonce: nonce, updatedAt });
    },

    async markReviewRequestClicked(id, clickedAt) {
      const reference = leads.doc(id);
      const ledgerReference = db.collection(COLLECTIONS.reviewRequests).doc(`${id}_request`);
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return;
        const lead = snapshot.data();
        // A customer reply is terminal for this request. A delayed browser
        // click must not replace its status or re-open downstream handling.
        if (lead.reviewRequestRepliedAt) return;
        const update = { updatedAt: clickedAt };
        if (!lead.reviewRequestClickedAt) {
          update.reviewRequestClickedAt = clickedAt;
          update.reviewRequestStatus = 'clicked';
        }
        transaction.update(reference, update);
        transaction.set(ledgerReference, { clickedAt: lead.reviewRequestClickedAt || clickedAt, updatedAt: clickedAt }, { merge: true });
      });
    },

    async markReviewRequestReplied(id, repliedAt) {
      const batch = db.batch();
      batch.update(leads.doc(id), { reviewRequestRepliedAt: repliedAt, reviewRequestStatus: 'replied', updatedAt: repliedAt });
      batch.set(db.collection(COLLECTIONS.reviewRequests).doc(`${id}_request`), { repliedAt, updatedAt: repliedAt }, { merge: true });
      batch.set(db.collection(COLLECTIONS.reviewRequests).doc(`${id}_reminder`), { state: 'suppressed', repliedAt, updatedAt: repliedAt }, { merge: true });
      await batch.commit();
    },

    async saveFeedback(feedback) {
      return saveFeedbackRecord(db, leads, feedback, false);
    },

    async saveUnparsedFeedback(feedback) {
      return saveFeedbackRecord(db, leads, feedback, true);
    },

    async saveEmailEvent(event) {
      const id = event.id || eventId('email_event');
      await db.collection(COLLECTIONS.emailEvents).doc(id).set({
        ...event,
        id,
        leadId: event.leadId || null,
        createdAt: event.createdAt || new Date().toISOString()
      });
      if (event.status === 'failed' && event.leadId) {
        await leads.doc(event.leadId).set({ emailIssue: true, updatedAt: event.createdAt || new Date().toISOString() }, { merge: true });
      }
    },

    async saveInboundEvent(event) {
      const id = event.id || eventId('inbound_event');
      await db.collection(COLLECTIONS.inboundEvents).doc(id).set({
        ...event,
        id,
        leadId: event.leadId || null,
        receivedAt: event.receivedAt || new Date().toISOString(),
        createdAt: event.createdAt || new Date().toISOString()
      });
    },

    async saveDeliveryEvent(event) {
      const id = event.id || eventId('delivery_event');
      await db.collection(COLLECTIONS.deliveryEvents).doc(id).set({
        ...event,
        id,
        leadId: event.leadId || null,
        receivedAt: event.receivedAt || new Date().toISOString(),
        createdAt: event.createdAt || new Date().toISOString()
      });
    },

    async listLeads({ search = '', status = 'all', limit = 25, cursor = '' } = {}) {
      let count;
      if (!search && status === 'all') {
        count = Number((await leads.count().get()).data().count || 0);
      } else {
        count = 0;
        let countCursor = null;
        for (;;) {
          let countQuery = leads.orderBy('submittedAt', 'desc').limit(500);
          if (countCursor) countQuery = countQuery.startAfter(countCursor);
          const countPage = await countQuery.get();
          if (countPage.empty) break;
          count += rows(countPage)
            .filter(lead => matchesSearch(lead, search))
            .filter(lead => matchesStatus(lead, status)).length;
          if (countPage.size < 500) break;
          countCursor = countPage.docs.at(-1);
        }
      }

      const decoded = decodeCursor(cursor);
      let query = leads.orderBy('submittedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
      if (decoded) query = query.startAfter(decoded.submittedAt, decoded.id);
      const selected = [];
      let exhausted = false;
      let lastSnapshot = null;
      while (selected.length < limit + 1 && !exhausted) {
        let pageQuery = query.limit(100);
        if (lastSnapshot) pageQuery = query.startAfter(lastSnapshot).limit(100);
        const page = await pageQuery.get();
        if (page.empty) break;
        for (const document of page.docs) {
          const lead = { ...document.data(), id: document.id };
          if (matchesSearch(lead, search) && matchesStatus(lead, status)) selected.push(lead);
          if (selected.length >= limit + 1) break;
        }
        lastSnapshot = page.docs.at(-1);
        exhausted = page.size < 100;
      }

      const page = selected.slice(0, limit);

      return {
        count,
        leads: page,
        nextCursor: selected.length > limit && page.length ? encodeCursor(page.at(-1)) : null
      };
    },

    async getLeadDetail(id) {
      const lead = await this.getLeadById(id);
      if (!lead) return null;
      const [emailEvents, feedback, deliveryEvents, inboundEvents] = await Promise.all([
        queryLeadEvents(db, COLLECTIONS.emailEvents, id, 'createdAt'),
        queryLeadEvents(db, COLLECTIONS.feedback, id, 'createdAt'),
        queryLeadEvents(db, COLLECTIONS.deliveryEvents, id, 'receivedAt'),
        queryLeadEvents(db, COLLECTIONS.inboundEvents, id, 'receivedAt')
      ]);
      return { lead, emailEvents, feedback, deliveryEvents, inboundEvents };
    }
  };
}

async function saveFeedbackRecord(db, leads, feedback, unparsed) {
  const leadReference = leads.doc(feedback.leadId);
  const id = eventId('feedback');
  const feedbackReference = db.collection(COLLECTIONS.feedback).doc(id);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(leadReference);
    const lead = snapshot.exists ? snapshot.data() : null;
    const accepted = Boolean(lead && !['received', 'unparsed'].includes(lead.feedbackStatus));

    if (accepted) {
      transaction.update(leadReference, {
        rating: unparsed ? null : feedback.rating,
        feedbackComment: feedback.comment,
        feedbackReceivedAt: feedback.receivedAt,
        feedbackStatus: unparsed ? 'unparsed' : 'received',
        feedbackSource: feedback.source,
        updatedAt: feedback.receivedAt
      });
    }

    transaction.set(feedbackReference, {
      id,
      ...feedback,
      rating: unparsed ? null : feedback.rating,
      status: accepted ? (unparsed ? 'unparsed' : 'accepted') : 'duplicate',
      createdAt: feedback.receivedAt
    });
    return { accepted };
  });
}

async function queryLeadEvents(db, collectionName, leadId, orderField) {
  const snapshot = await db.collection(collectionName)
    .where('leadId', '==', leadId)
    .limit(100)
    .get();
  return rows(snapshot).sort(newestFirst).slice(0, 25);
}

export const FIRESTORE_COLLECTIONS = Object.freeze({ ...COLLECTIONS });

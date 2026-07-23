import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';

const COLLECTIONS = {
  leads: 'leads',
  emailEvents: 'email_events',
  feedback: 'feedback',
  inboundEvents: 'postmark_inbound_events',
  deliveryEvents: 'postmark_delivery_events'
};

function rows(snapshot) {
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
}

function newestFirst(left, right) {
  return String(right.createdAt || right.receivedAt || right.submittedAt || '')
    .localeCompare(String(left.createdAt || left.receivedAt || left.submittedAt || ''));
}

function matchesStatus(lead, status) {
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

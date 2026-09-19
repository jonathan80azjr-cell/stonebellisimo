import { createHash } from 'node:crypto';

export function normalizeCaption(value = '') { return String(value).replace(/\s+/g, ' ').trim(); }
export function captionFingerprint(caption) { return createHash('sha256').update(normalizeCaption(caption)).digest('hex'); }

/** Portable local-ledger key. This is never sent to HighLevel's API. */
export function socialPostIdempotencyKey({ sourceHash, accountId, caption, captionVersion, scheduledAt }) {
  if (!sourceHash || !accountId || !captionVersion || !scheduledAt) throw new TypeError('sourceHash, accountId, captionVersion, and scheduledAt are required');
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.valueOf())) throw new TypeError('scheduledAt must be a valid date');
  return createHash('sha256').update(`v1|${sourceHash}|${accountId}|${captionFingerprint(caption)}:${captionVersion}|${date.toISOString()}`).digest('hex');
}

function retryableReadStatus(status) { return status === 429 || status >= 500; }
function parsePost(body) { return body?.results?.post || null; }
function parsePosts(body) { return Array.isArray(body?.results?.posts) ? body.results.posts : []; }

export class HighLevelSocialPlanner {
  constructor({ fetch: fetchImpl, baseUrl = 'https://services.leadconnectorhq.com', accessToken, locationId, userId, approverId, sleep = () => Promise.resolve(), random = Math.random } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
    if (!locationId) throw new TypeError('locationId is required');
    this.fetch = fetchImpl; this.baseUrl = baseUrl.replace(/\/$/, ''); this.accessToken = accessToken; this.locationId = locationId;
    this.userId = userId; this.approverId = approverId; this.sleep = sleep; this.random = random;
  }

  headers() { return { Authorization: `Bearer ${this.accessToken}`, Version: 'v3', 'Content-Type': 'application/json', Accept: 'application/json' }; }
  requireWriteAuthorization({ userId, approverId } = {}) {
    if (!this.accessToken) throw new TypeError('accessToken is required');
    if (!(userId || this.userId)) throw new TypeError('userId is required');
    if (!(approverId || this.approverId)) throw new TypeError('approverId is required');
  }
  async request(path, options = {}, { read = false } = {}) {
    let lastError;
    for (let attempt = 0; attempt < (read ? 3 : 1); attempt += 1) {
      try {
        const response = await this.fetch(`${this.baseUrl}${path}`, { ...options, headers: { ...this.headers(), ...options.headers } });
        if (!read || !retryableReadStatus(response.status) || attempt === 2) return response;
      } catch (error) { lastError = error; if (!read || attempt === 2) throw error; }
      await this.sleep((2 ** attempt) * 100 + Math.floor(this.random() * 100));
    }
    throw lastError;
  }
  path(suffix = '') { return `/social-media-posting/${encodeURIComponent(this.locationId)}/posts${suffix}`; }

  async createInReview({ accountId, caption, media, scheduledAt, sourceHash, captionVersion, userId, approverId, type = 'post', ...extra }) {
    this.requireWriteAuthorization({ userId, approverId });
    if (!accountId) throw new TypeError('accountId is required');
    const idempotencyKey = socialPostIdempotencyKey({ sourceHash, accountId, caption, captionVersion, scheduledAt });
    const body = { ...extra, accountIds: [accountId], summary: caption, media, status: 'in_review', scheduleDate: new Date(scheduledAt).toISOString(), type, postApprovalDetails: { approver: approverId || this.approverId, approvalStatus: 'pending' }, userId: userId || this.userId };
    let response;
    try { response = await this.request(this.path(), { method: 'POST', body: JSON.stringify(body) }); }
    catch (error) { return { created: false, uncertainWrite: true, idempotencyKey, error: { name: error?.name || 'Error', message: error?.message || 'create failed' } }; }
    let raw = null; try { raw = await response.clone().json(); } catch { /* Still uncertain: HTTP response can mean it landed. */ }
    return { created: response.ok, uncertainWrite: true, idempotencyKey, status: response.status, post: parsePost(raw), remote: raw };
  }

  async getPost(postId) {
    if (!postId) throw new TypeError('postId is required');
    const response = await this.request(this.path(`/${encodeURIComponent(postId)}`), {}, { read: true });
    if (!response.ok) return { status: response.status, post: null };
    return { status: response.status, post: parsePost(await response.json()) };
  }

  async scheduleApprovedPost({ postId, accountId, caption, media, scheduledAt, userId, type = 'post', ...extra }) {
    this.requireWriteAuthorization({ userId });
    if (!postId || !accountId) throw new TypeError('postId and accountId are required');
    const body = {
      ...extra, accountIds: [accountId], summary: caption, media, status: 'scheduled',
      scheduleDate: new Date(scheduledAt).toISOString(), type, userId: userId || this.userId
    };
    let response;
    try { response = await this.request(this.path(`/${encodeURIComponent(postId)}`), { method: 'PUT', body: JSON.stringify(body) }); }
    catch (error) { return { scheduled: false, uncertainWrite: true, error: { name: error?.name || 'Error', message: error?.message || 'schedule failed' } }; }
    let remote = null; try { remote = await response.clone().json(); } catch { /* HTTP response still requires a readback. */ }
    return { scheduled: response.ok, uncertainWrite: true, status: response.status, remote };
  }

  async listPosts({ accountId, from, to, statusType = 'all', postType = 'post', skip = 0, limit = 100, includeUsers = false } = {}) {
    const body = { type: statusType, postType, accounts: accountId || '', skip: String(skip), limit: String(limit), fromDate: from ? new Date(from).toISOString() : undefined, toDate: to ? new Date(to).toISOString() : undefined, includeUsers: String(includeUsers) };
    const response = await this.request(this.path('/list'), { method: 'POST', body: JSON.stringify(body) }, { read: true });
    if (!response.ok) return { status: response.status, posts: [], complete: false };
    const raw = await response.json(); const posts = parsePosts(raw);
    // The endpoint does not document a universal total field. A short page proves this window is exhausted.
    const total = raw?.results?.count;
    const complete = Number.isFinite(total) ? skip + posts.length >= total : posts.length < limit;
    return { status: response.status, posts, complete, raw };
  }

  async reconcilePost({ accountId, caption, scheduledAt, windowHours = 1, postType = 'post', pageSize = 100 }) {
    if (!accountId || caption === undefined) throw new TypeError('accountId and caption are required');
    const center = new Date(scheduledAt); if (Number.isNaN(center.valueOf())) throw new TypeError('scheduledAt must be valid');
    const from = new Date(center.valueOf() - windowHours * 3600000); const to = new Date(center.valueOf() + windowHours * 3600000);
    const expected = captionFingerprint(caption); let skip = 0; const all = [];
    for (;;) {
      let page;
      try { page = await this.listPosts({ accountId, from, to, postType, skip, limit: pageSize }); } catch (error) { return { found: false, post: null, safeToCreate: false, error: 'remote_read_failed' }; }
      if (page.status < 200 || page.status >= 300 || !page.complete && page.posts.length === 0) return { found: false, post: null, safeToCreate: false, status: page.status, error: 'remote_read_incomplete' };
      all.push(...page.posts);
      if (page.complete) break;
      skip += page.posts.length;
    }
    const post = all.find((candidate) => {
      const date = new Date(candidate.scheduleDate);
      return Array.isArray(candidate.accountIds) && candidate.accountIds.length === 1 && candidate.accountIds[0] === accountId && captionFingerprint(candidate.summary || '') === expected && !Number.isNaN(date.valueOf()) && date.toISOString() === center.toISOString();
    });
    return { found: Boolean(post), post: post || null, safeToCreate: !post, status: 200 };
  }
}

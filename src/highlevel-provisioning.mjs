import { renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HIGHLEVEL_LOCATION_ID, readHighLevelPrivateToken } from './highlevel-admin.mjs';
import { CHANNELS as ATTRIBUTION_CHANNELS } from './growth-attribution.mjs';

const API_BASE = 'https://services.leadconnectorhq.com';
export const FOUNDATION_TAGS = [
  'bs:client:sb', 'bs:program:sb-growth-v1', 'bs:optout', 'bs:escalated', 'bs:urgent-language', 'bs:test',
  // Credit tags. Only channels that can carry a tagged link are represented,
  // because only a tagged link earns managed credit — see growth-attribution.mjs.
  'bs:managed-credit', 'bs:channel:gbp', 'bs:channel:instagram', 'bs:channel:facebook'
];
// HighLevel's custom-field endpoint accepts `options` for SINGLE_OPTIONS.
// `textBoxListOptions` is exclusively for the TEXTBOX_LIST field type.
const option = (name, model, options) => ({ name, model, dataType: 'SINGLE_OPTIONS', options });
const text = (name, model) => ({ name, model, dataType: 'TEXT' });
const date = (name, model) => ({ name, model, dataType: 'DATE' });
export const FOUNDATION_FIELDS = [
  text('BS Managed Client', 'contact'), option('BS Managed Program', 'contact', ['SB_GROWTH_V1']),
  option('BS Optout Status', 'contact', ['opted_out', 'active']), date('BS Optout At', 'contact'), text('BS Optout Channel', 'contact'), option('BS Optout Source', 'contact', ['keyword', 'platform_signal', 'staff', 'form']),
  option('BS Escalation Reason', 'contact', ['urgent_language', 'human_requested', 'uncertain', 'complaint', 'pricing', 'turn_cap', 'window_risk']), date('BS Escalated At', 'contact'), text('BS Escalation Channel', 'contact'), text('BS Assigned User', 'contact'), date('BS Staff Response At', 'contact'),
  text('BS Firebase Lead ID', 'contact'), text('BS HighLevel Contact ID', 'contact'), text('BS Outcome Version', 'contact'),
  text('BS Opportunity ID', 'opportunity'), date('BS Estimate Scheduled At', 'opportunity'), date('BS Job Completed At', 'opportunity'), date('BS Invoice Collected At', 'opportunity'),
  // Attribution. Without these the pipeline can show that a lead arrived but
  // never which channel produced it, so managed-channel performance is
  // unprovable. Option lists mirror growth-attribution.mjs exactly; a value the
  // resolver can emit but the field cannot store would drop credit silently.
  option('BS Source Platform', 'contact', ATTRIBUTION_CHANNELS),
  text('BS Source Content ID', 'contact'), text('BS Source Campaign', 'contact'),
  option('BS Attribution Confidence', 'contact', ['tagged', 'inferred', 'unknown']),
  option('BS Managed Credit', 'contact', ['managed', 'unmanaged']),
  date('BS First Touch At', 'contact'), option('BS First Touch Source', 'contact', ATTRIBUTION_CHANNELS),
  date('BS Last Touch At', 'contact'), option('BS Last Touch Source', 'contact', ATTRIBUTION_CHANNELS)
];
export const FOUNDATION_PIPELINE = {
  name: 'Stone Bellisimo Growth Outcomes', locationId: HIGHLEVEL_LOCATION_ID, showInFunnel: true, showInPieChart: true, useOpportunityProbability: false,
  stages: ['New Lead', 'Qualified', 'Estimate Scheduled', 'Job Completed', 'Invoice Collected', 'Repeat / Review', 'Lost'].map((name, index) => ({ name, position: index + 1, showInFunnel: index < 6 }))
};

function sameOptions(actual = [], expected = []) {
  const values = actual.map(item => typeof item === 'string' ? item : item.label).sort();
  return JSON.stringify(values) === JSON.stringify([...expected].sort());
}
function fieldMatches(actual, expected) {
  return actual?.locationId === HIGHLEVEL_LOCATION_ID && actual?.name === expected.name && actual?.model === expected.model && actual?.dataType === expected.dataType && (!expected.options || sameOptions(actual.picklistOptions, expected.options));
}
function pipelineMatches(actual) {
  return actual?.name === FOUNDATION_PIPELINE.name && actual?.locationId === HIGHLEVEL_LOCATION_ID &&
    actual?.showInFunnel === FOUNDATION_PIPELINE.showInFunnel && actual?.showInPieChart === FOUNDATION_PIPELINE.showInPieChart &&
    actual?.useOpportunityProbability === false && Array.isArray(actual.stages) && actual.stages.length === 7 &&
    actual.stages.every((stage, index) => stage.name === FOUNDATION_PIPELINE.stages[index].name &&
      Number(stage.position) === FOUNDATION_PIPELINE.stages[index].position &&
      stage.showInFunnel === FOUNDATION_PIPELINE.stages[index].showInFunnel);
}
function normalizedName(value) { return String(value || '').trim().toLowerCase(); }
function atomicJson(path, value) { const target = resolve(path); const temp = `${target}.tmp-${process.pid}`; writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, target); }
const READBACK_BACKOFF_MS = [250, 500, 1000];

export class HighLevelFoundationProvisioner {
  #token;
  constructor({ fetch: fetchImpl = globalThis.fetch, secretReader = readHighLevelPrivateToken, locationId = HIGHLEVEL_LOCATION_ID, writeLedger = atomicJson, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
    if (locationId !== HIGHLEVEL_LOCATION_ID) throw new Error('Provisioning is pinned to the Stone Bellisimo location.');
    this.fetch = fetchImpl; this.secretReader = secretReader; this.locationId = HIGHLEVEL_LOCATION_ID; this.writeLedger = writeLedger; this.sleep = sleep;
  }
  async request(method, path, body, version = 'v3') {
    if (!path.includes(this.locationId) && !path.startsWith('/opportunities/pipelines')) throw new Error('Request is outside pinned location.');
    this.#token ||= this.secretReader();
    const response = await this.fetch(`${API_BASE}${path}`, { method, headers: { Authorization: `Bearer ${this.#token}`, Version: version, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`HighLevel ${method} failed (${response.status}); stopped before further changes.`);
    try { return await response.json(); } catch { throw new Error(`HighLevel ${method} returned an unreadable response; stopped before further changes.`); }
  }
  getPipelines() { return this.request('GET', `/opportunities/pipelines?locationId=${encodeURIComponent(this.locationId)}`); }
  getPipeline(id) { return this.request('GET', `/opportunities/pipelines/${encodeURIComponent(id)}`); }
  getFields() { return this.request('GET', `/locations/${this.locationId}/customFields?model=all`); }
  getTags() { return this.request('GET', `/locations/${this.locationId}/tags`); }
  async readTagback(id, name) {
    for (let attempt = 0; attempt <= READBACK_BACKOFF_MS.length; attempt += 1) {
      const reread = await this.getTags();
      const tag = (reread.tags || []).find(item => item.id === id && item.name === name && item.locationId === this.locationId);
      if (tag) return tag;
      if (attempt < READBACK_BACKOFF_MS.length) await this.sleep(READBACK_BACKOFF_MS[attempt]);
    }
    return null;
  }
  async readFieldback(id, expected) {
    for (let attempt = 0; attempt <= READBACK_BACKOFF_MS.length; attempt += 1) {
      try {
        const reread = await this.request('GET', `/locations/${this.locationId}/customFields/${encodeURIComponent(id)}`);
        const field = reread.customField;
        if (fieldMatches(field, expected) && field.fieldKey) return field;
        throw new Error(`Field readback for ${expected.name} was uncertain; stopped before further changes.`);
      } catch (error) {
        if (!String(error?.message || '').includes('(404)') || attempt === READBACK_BACKOFF_MS.length) throw error;
        await this.sleep(READBACK_BACKOFF_MS[attempt]);
      }
    }
    return null;
  }
  async preflight() {
    const [pipelineResponse, fieldResponse, tagResponse] = await Promise.all([this.getPipelines(), this.getFields(), this.getTags()]);
    return { pipelines: pipelineResponse.pipelines || [], fields: fieldResponse.customFields || [], tags: tagResponse.tags || [] };
  }
  async provision({ apply = false, ledgerDirectory = 'ops/growth-automation/stone-bellisimo' } = {}) {
    const existing = await this.preflight(); const result = { apply, locationId: this.locationId, pipeline: null, tags: [], fields: [], created: [] };
    const namedPipelines = existing.pipelines.filter(item => normalizedName(item.name) === normalizedName(FOUNDATION_PIPELINE.name));
    if (namedPipelines.length > 1 || namedPipelines.some(item => !pipelineMatches(item))) throw new Error('Pipeline name collision or configuration mismatch; no update is permitted.');
    const pipeline = namedPipelines[0];
    for (const field of FOUNDATION_FIELDS) {
      const sameName = existing.fields.filter(item => normalizedName(item.name) === normalizedName(field.name));
      if (sameName.some(item => !fieldMatches(item, field)) || sameName.length > 1) throw new Error(`Custom-field collision for ${field.name}; no update is permitted.`);
    }
    for (const tag of FOUNDATION_TAGS) {
      const sameName = existing.tags.filter(item => normalizedName(item.name) === normalizedName(tag));
      if (sameName.length > 1 || sameName.some(item => item.name !== tag)) throw new Error(`Tag collision for ${tag}; no update is permitted.`);
    }
    if (!apply) return { ...result, pipeline: pipeline?.id || null, tags: FOUNDATION_TAGS.map(name => ({ name, id: existing.tags.find(tag => tag.name === name)?.id || null })), fields: FOUNDATION_FIELDS.map(field => ({ name: field.name, model: field.model, id: existing.fields.find(item => item.name === field.name && item.model === field.model)?.id || null })) };

    let verifiedPipeline = pipeline;
    if (!verifiedPipeline) {
      const created = await this.request('POST', '/opportunities/pipelines', FOUNDATION_PIPELINE); const id = created.id || created.pipeline?.id;
      if (!id) throw new Error('Pipeline create response lacked an ID; stopped before further changes.');
      let reread;
      try {
        reread = await this.getPipeline(id);
        verifiedPipeline = reread.pipeline || reread;
      } catch (error) {
        // HighLevel can create a pipeline successfully while its documented GET-by-ID
        // route returns 404. Only an exact ID found in a fresh list read is acceptable.
        if (!String(error?.message || '').includes('(404)')) throw error;
        const listed = await this.getPipelines();
        verifiedPipeline = (listed.pipelines || []).find(item => item.id === id) || null;
      }
      if (!pipelineMatches(verifiedPipeline)) throw new Error('Pipeline readback did not exactly match; stopped before further changes.');
      result.created.push('pipeline');
    }
    const verifiedTags = []; for (const name of FOUNDATION_TAGS) {
      let tag = existing.tags.find(item => item.name === name);
      if (!tag) { const created = await this.request('POST', `/locations/${this.locationId}/tags`, { name }); const id = created.tag?.id; if (!id) throw new Error(`Tag create for ${name} lacked an ID; stopped before further changes.`); tag = await this.readTagback(id, name); if (!tag) throw new Error(`Tag readback for ${name} was uncertain; stopped before further changes.`); result.created.push(`tag:${name}`); }
      verifiedTags.push(tag);
    }
    const verifiedFields = []; for (const field of FOUNDATION_FIELDS) {
      let current = existing.fields.find(item => item.name === field.name && item.model === field.model);
      if (!current) { const created = await this.request('POST', `/locations/${this.locationId}/customFields`, field); const id = created.customField?.id; if (!id) throw new Error(`Field create for ${field.name} lacked an ID; stopped before further changes.`); current = await this.readFieldback(id, field); if (!current) throw new Error(`Field readback for ${field.name} was uncertain; stopped before further changes.`); result.created.push(`field:${field.name}`); }
      verifiedFields.push(current);
    }
    const timestamp = new Date().toISOString();
    this.writeLedger(`${ledgerDirectory}/pipeline-ledger.json`, { locationId: this.locationId, readbackAt: timestamp, pipeline: verifiedPipeline });
    this.writeLedger(`${ledgerDirectory}/tag-ledger.json`, { locationId: this.locationId, readbackAt: timestamp, tags: verifiedTags.map(tag => ({ id: tag.id, name: tag.name })) });
    this.writeLedger(`${ledgerDirectory}/field-ledger.json`, { locationId: this.locationId, readbackAt: timestamp, fields: verifiedFields.map(field => ({ id: field.id, name: field.name, fieldKey: field.fieldKey, dataType: field.dataType, model: field.model, picklistOptions: field.picklistOptions || [] })) });
    return { ...result, pipeline: verifiedPipeline.id, tags: verifiedTags.map(tag => ({ name: tag.name, id: tag.id })), fields: verifiedFields.map(field => ({ name: field.name, id: field.id, fieldKey: field.fieldKey, model: field.model })) };
  }
}

import { execFileSync as nodeExecFileSync } from 'node:child_process';

export const HIGHLEVEL_FIREBASE_PROJECT = 'stone-bellisimo-dashboard';
export const HIGHLEVEL_LOCATION_ID = 'rB7WMB7KbqDC4eLCCfyX';
const API_BASE = 'https://services.leadconnectorhq.com';

/** Reads the private token only into process memory; callers must never log its return value. */
export function readHighLevelPrivateToken({ execFileSync = nodeExecFileSync } = {}) {
  try {
    const value = execFileSync('firebase', [
      'functions:secrets:access', 'HIGHLEVEL_PRIVATE_TOKEN', '--project', HIGHLEVEL_FIREBASE_PROJECT
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!value) throw new Error('empty secret');
    return value;
  } catch {
    // Do not include command output: Firebase CLI errors can include sensitive context.
    throw new Error('Unable to access HIGHLEVEL_PRIVATE_TOKEN from Firebase Secret Manager.');
  }
}

function query(path, parameters = {}) {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  return url.pathname + url.search;
}

export class HighLevelAdminDiscovery {
  #token;
  constructor({ fetch: fetchImpl = globalThis.fetch, secretReader = readHighLevelPrivateToken, locationId = HIGHLEVEL_LOCATION_ID } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
    if (locationId !== HIGHLEVEL_LOCATION_ID) throw new Error('HighLevel discovery is pinned to the Stone Bellisimo location.');
    this.fetch = fetchImpl; this.secretReader = secretReader; this.locationId = HIGHLEVEL_LOCATION_ID;
  }

  async read(path) {
    if (!path.startsWith(`/locations/${this.locationId}`) && !path.startsWith('/opportunities/pipelines') && !path.startsWith('/workflows/') && !path.startsWith(`/social-media-posting/${this.locationId}/`)) {
      throw new Error('Discovery endpoint is outside the pinned Stone Bellisimo location.');
    }
    this.#token ||= this.secretReader();
    const response = await this.fetch(`${API_BASE}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${this.#token}`, Version: 'v3', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HighLevel discovery request failed (${response.status}).`);
    return response.json();
  }

  // This helper intentionally has no write method. Calling it with a write verb is a hard stop.
  async request({ method = 'GET', path }) {
    if (method !== 'GET') throw new Error('HighLevel admin discovery permits read-only GET requests only.');
    return this.read(path);
  }

  getLocation() { return this.read(`/locations/${this.locationId}`); }
  getPermissions() { return this.read(`/locations/${this.locationId}/permissions`); }
  getPipelines() { return this.read(query('/opportunities/pipelines', { locationId: this.locationId })); }
  getCustomFields() { return this.read(query(`/locations/${this.locationId}/customFields`, { model: 'all' })); }
  getTags() { return this.read(`/locations/${this.locationId}/tags`); }
  getWorkflows() { return this.read(query('/workflows/', { locationId: this.locationId })); }
  getSocialAccounts() { return this.read(`/social-media-posting/${this.locationId}/accounts`); }

  async discover() {
    const [location, permissions, pipelines, customFields, tags, workflows, socialAccounts] = await Promise.all([
      this.getLocation(), this.getPermissions(), this.getPipelines(), this.getCustomFields(), this.getTags(), this.getWorkflows(), this.getSocialAccounts()
    ]);
    return { locationId: this.locationId, location, permissions, pipelines, customFields, tags, workflows, socialAccounts };
  }
}

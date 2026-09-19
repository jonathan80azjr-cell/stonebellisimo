import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(process.cwd(), 'scripts/growth-automation-preflight.mjs');
const base = JSON.parse(readFileSync(join(process.cwd(), 'ops/growth-automation/stone-bellisimo/client-config.json'), 'utf8'));
const directory = mkdtempSync(join(tmpdir(), 'sb-growth-'));
const execute = (name, value) => {
  const path = join(directory, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const resolveSentinels = (value) => {
  if (typeof value === 'string') return value.replaceAll('REQUIRED_UNSET', 'complete').replaceAll('UNVERIFIED', 'verified');
  if (Array.isArray(value)) return value.map(resolveSentinels);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveSentinels(item)]));
  return value;
};
const valid = resolveSentinels(clone(base));
valid.approved_copy = { ...valid.approved_copy, copy_version: 'v1_2026_08', consent_text_version: 'consent_v1_2026_08', approved_by: 'Jensy', approved_at: '2026-08-25T12:00:00Z', signoff: 'Jensy approved', evidence_reference: 'evidence/copy-approval-2026-08-25.md' };
valid.authorization_envelope = { ...valid.authorization_envelope, signed: true, signed_by: 'Jonathan', signed_at: '2026-08-25T12:00:00Z', signature_evidence_reference: 'evidence/envelope-2026-08-25.md', approved_copy_version: valid.approved_copy.copy_version, permitted_actions: [...valid.authorization_envelope.allowed_actions], live_write_action_scope: [...valid.authorization_envelope.allowed_actions], rollback_owner: 'Jensy', rollback_rules: 'runbook/rollback-v1', live_writes_authorized: true, action_authorizations: {} };
for (const action of valid.authorization_envelope.permitted_actions) valid.authorization_envelope.action_authorizations[action] = { dry_run_at: '2026-08-25T12:00:00Z', dry_run_evidence_reference: `evidence/${action}-dry-run.md`, change_sheet_reference: `changes/${action}.md`, exact_target_ids: Object.fromEntries((({profile_update:['highlevel_location','native_gbp_location'],draft_workflows:['highlevel_location'],create_in_review_post:['social_planner_gbp_account','social_planner_instagram_account','social_planner_facebook_account'],schedule_approved_post:['social_planner_gbp_account','social_planner_instagram_account','social_planner_facebook_account'],draft_review_reply:['highlevel_location','native_gbp_location'],send_review_request:['highlevel_location','firebase_project']})[action]).map((key) => [key, valid.accounts[key].id])) };
let result = execute('blocked', base);
assert.equal(result.status, 1); assert.match(result.stderr, /copy_version.*unresolved sentinel/); assert.match(result.stderr, /services_explicitly_not_offered.*unresolved sentinel/);
result = execute('valid', valid); assert.equal(result.status, 0, result.stderr);
const wrongAccount = clone(valid); wrongAccount.authorization_envelope.action_authorizations.profile_update.exact_target_ids.native_gbp_location = 'wrong-account';
result = execute('wrong-account', wrongAccount); assert.equal(result.status, 1); assert.match(result.stderr, /native_gbp_location/);
const missingDryRun = clone(valid); delete missingDryRun.authorization_envelope.action_authorizations.send_review_request.dry_run_evidence_reference;
result = execute('missing-dry-run', missingDryRun); assert.equal(result.status, 1); assert.match(result.stderr, /send_review_request.*requires dated dry run/);
console.log('growth-automation-preflight tests passed');

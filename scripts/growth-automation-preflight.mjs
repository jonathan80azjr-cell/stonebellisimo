#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const configPath = resolve(process.cwd(), process.argv[2] || 'ops/growth-automation/stone-bellisimo/client-config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const blockers = [];
const add = (path, detail = '') => blockers.push(detail ? `${path}: ${detail}` : path);
const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value) && !Number.isNaN(Date.parse(value));
const visit = (value, path = '') => {
  if (typeof value === 'string' && (value.includes('REQUIRED_UNSET') || value.includes('UNVERIFIED'))) add(path, 'contains unresolved sentinel');
  else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
};
const expectedStages = ['New Lead', 'Qualified', 'Estimate Scheduled', 'Job Completed', 'Invoice Collected', 'Repeat / Review', 'Lost'];
const expectedStates = ['discovered', 'needs_review', 'approved', 'optimized', 'uploaded', 'scheduled', 'published'];
const expectedMix = { project_reveal: 4, process: 3, material_education: 2, local_faq: 2, testimonial_offer: 1 };
const requiredTargets = {
  profile_update: ['highlevel_location', 'native_gbp_location'],
  draft_workflows: ['highlevel_location'],
  create_in_review_post: ['social_planner_gbp_account', 'social_planner_instagram_account', 'social_planner_facebook_account'],
  schedule_approved_post: ['social_planner_gbp_account', 'social_planner_instagram_account', 'social_planner_facebook_account'],
  draft_review_reply: ['highlevel_location', 'native_gbp_location'],
  send_review_request: ['highlevel_location', 'firebase_project']
};
const actionCatalog = Object.keys(requiredTargets);
visit(config);
for (const [path, expected] of Object.entries({
  'client.code': 'SB', 'client.program_code': 'SB_GROWTH_V1', 'client.vertical': 'appointment_services', 'client.timezone': 'America/New_York',
  'business_truth.canonical_phone_display': '201-553-1919', 'business_truth.canonical_phone_e164': '+12015531919',
  'business_truth.address': '618 23rd Street, Union City, NJ 07087'
})) {
  const actual = path.split('.').reduce((value, key) => value?.[key], config);
  if (actual !== expected) add(path, `must equal ${expected}`);
}
if (JSON.stringify(config.business_truth?.hours) !== JSON.stringify({monday:'08:00-17:00',tuesday:'08:00-17:00',wednesday:'08:00-17:00',thursday:'08:00-17:00',friday:'08:00-17:00',saturday:'closed',sunday:'closed'})) add('business_truth.hours', 'must match canonical hours');
if (JSON.stringify(config.outcome_system?.stages) !== JSON.stringify(expectedStages)) add('outcome_system.stages', 'must match allowed sequence');
if (JSON.stringify(config.publishing?.state_machine) !== JSON.stringify(expectedStates)) add('publishing.state_machine', 'must match allowed sequence');
if (JSON.stringify(config.publishing?.minimum_monthly_mix) !== JSON.stringify(expectedMix)) add('publishing.minimum_monthly_mix', 'must match the approved 4/3/2/2/1 content mix');
const copy = config.approved_copy || {};
if (!['Jensy', 'Jonathan'].includes(copy.approved_by)) add('approved_copy.approved_by', 'must be Jensy or Jonathan');
if (!isIsoDate(copy.approved_at)) add('approved_copy.approved_at', 'must be ISO date');
if (!copy.signoff || !copy.evidence_reference || !copy.copy_version || !copy.consent_text_version) add('approved_copy', 'requires signoff, evidence, copy version, and consent version');
const envelope = config.authorization_envelope || {};
if (envelope.signed !== true) add('authorization_envelope.signed');
if (envelope.live_writes_authorized !== true) add('authorization_envelope.live_writes_authorized');
if (!['Jensy', 'Jonathan'].includes(envelope.signed_by)) add('authorization_envelope.signed_by', 'must be Jensy or Jonathan');
if (!isIsoDate(envelope.signed_at)) add('authorization_envelope.signed_at', 'must be ISO date');
if (!envelope.signature_evidence_reference) add('authorization_envelope.signature_evidence_reference');
if (envelope.approved_copy_version !== copy.copy_version) add('authorization_envelope.approved_copy_version', 'must match approved_copy.copy_version');
if (!['Jensy', 'Jonathan'].includes(envelope.rollback_owner) || !envelope.rollback_rules) add('authorization_envelope.rollback', 'requires owner Jensy/Jonathan and rules');
const allowed = envelope.allowed_actions || [];
const permitted = envelope.permitted_actions || [];
if (JSON.stringify([...allowed].sort()) !== JSON.stringify([...actionCatalog].sort())) add('authorization_envelope.allowed_actions', 'must match the fixed action catalog');
if (!Array.isArray(permitted) || permitted.length === 0) add('authorization_envelope.permitted_actions');
for (const action of permitted) {
  if (!allowed.includes(action)) add(`authorization_envelope.permitted_actions.${action}`, 'not in allowed action catalog');
  if (!envelope.live_write_action_scope?.includes(action)) add(`authorization_envelope.live_write_action_scope.${action}`, 'not explicitly scoped');
  const authorization = envelope.action_authorizations?.[action];
  if (!authorization || !isIsoDate(authorization.dry_run_at) || !authorization.dry_run_evidence_reference || !authorization.change_sheet_reference) add(`authorization_envelope.action_authorizations.${action}`, 'requires dated dry run, evidence, and change sheet');
  const targets = authorization?.exact_target_ids || {};
  for (const targetName of requiredTargets[action] || []) {
    const target = config.accounts?.[targetName] || {};
    const expectedId = target.id;
    if (target.verification_state !== 'verified' || !target.evidence_reference) add(`accounts.${targetName}`, 'must have verified state and evidence');
    if (!expectedId || targets[targetName] !== expectedId) add(`authorization_envelope.action_authorizations.${action}.exact_target_ids.${targetName}`, 'must equal verified configured target ID');
  }
}
if (blockers.length) {
  console.error(`PRECHECK BLOCKED (${blockers.length}):`);
  [...new Set(blockers)].forEach((blocker) => console.error(`- ${blocker}`));
  process.exitCode = 1;
} else console.log('PRECHECK PASSED: configuration, approvals, target IDs, dry runs, and change sheets are complete.');

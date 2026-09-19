import { readFileSync } from 'node:fs';

const configUrl = new URL('../ops/growth-automation/stone-bellisimo/client-config.json', import.meta.url);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const GROWTH_CLIENT_CONFIG = deepFreeze(JSON.parse(readFileSync(configUrl, 'utf8')));

export const GROWTH_CLIENT = deepFreeze({
  code: GROWTH_CLIENT_CONFIG.client.code,
  programCode: GROWTH_CLIENT_CONFIG.client.program_code,
  timezone: GROWTH_CLIENT_CONFIG.client.timezone,
  ownerNames: GROWTH_CLIENT_CONFIG.staffing.co_owners,
  ownerEmails: GROWTH_CLIENT_CONFIG.staffing.owner_emails,
  salesHandoffOwner: GROWTH_CLIENT_CONFIG.staffing.sales_handoff_owner,
  businessHours: GROWTH_CLIENT_CONFIG.business_truth.hours,
  claimSlaBasis: GROWTH_CLIENT_CONFIG.quiet_hours.claim_sla_basis,
  stages: GROWTH_CLIENT_CONFIG.outcome_system.stages,
  publishing: GROWTH_CLIENT_CONFIG.publishing,
  reputation: GROWTH_CLIENT_CONFIG.reputation,
  sla: GROWTH_CLIENT_CONFIG.staffing.sla
});

export function publicGrowthConfig() {
  return {
    code: GROWTH_CLIENT.code,
    programCode: GROWTH_CLIENT.programCode,
    timezone: GROWTH_CLIENT.timezone,
    ownerNames: [...GROWTH_CLIENT.ownerNames],
    salesHandoffOwner: GROWTH_CLIENT.salesHandoffOwner,
    claimSlaBasis: GROWTH_CLIENT.claimSlaBasis,
    stages: [...GROWTH_CLIENT.stages],
    publishing: {
      approvalMode: GROWTH_CLIENT.publishing.approval_mode,
      clientCeilingPer24h: GROWTH_CLIENT.publishing.client_ceiling_per_24h,
      minLeadTimeMinutes: GROWTH_CLIENT.publishing.min_lead_time_minutes,
      stateMachine: [...GROWTH_CLIENT.publishing.state_machine],
      minimumMonthlyMedia: { ...GROWTH_CLIENT.publishing.minimum_monthly_media },
      minimumMonthlyMix: { ...GROWTH_CLIENT.publishing.minimum_monthly_mix }
    },
    sla: { ...GROWTH_CLIENT.sla }
  };
}

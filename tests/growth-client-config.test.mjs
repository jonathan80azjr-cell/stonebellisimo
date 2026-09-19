import test from 'node:test';
import assert from 'node:assert/strict';
import { GROWTH_CLIENT, GROWTH_CLIENT_CONFIG, publicGrowthConfig } from '../src/growth-client-config.mjs';

test('runtime growth constants come from the one no-secrets client configuration', () => {
  assert.equal(GROWTH_CLIENT.code, 'SB');
  assert.equal(GROWTH_CLIENT.programCode, 'SB_GROWTH_V1');
  assert.equal(GROWTH_CLIENT.timezone, 'America/New_York');
  assert.deepEqual(GROWTH_CLIENT.stages, GROWTH_CLIENT_CONFIG.outcome_system.stages);
  assert.deepEqual(GROWTH_CLIENT.ownerEmails, GROWTH_CLIENT_CONFIG.staffing.owner_emails);
  assert.equal(publicGrowthConfig().publishing.minimumMonthlyMedia.vertical_clips, 6);
  assert.deepEqual(publicGrowthConfig().publishing.minimumMonthlyMix, {
    project_reveal: 4, process: 3, material_education: 2, local_faq: 2, testimonial_offer: 1
  });
});

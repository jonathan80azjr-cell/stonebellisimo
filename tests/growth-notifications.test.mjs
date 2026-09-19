import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGrowthInquiryAlert, growthOwnerRecipients, processGrowthSla, staffedMinutesElapsed } from '../src/growth-notifications.mjs';

test('growth alerts go to the two owners by default and contain no message body', () => {
  assert.deepEqual(growthOwnerRecipients({}), ['jensyjimenez723@gmail.com', 'jonathan80azjr@gmail.com']);
  const alert = buildGrowthInquiryAlert({ platform: 'instagram', category: 'estimate_intent', message: 'private text' }, {}, 'new');
  assert.doesNotMatch(alert.text, /private text/);
  assert.match(alert.text, /No social message body/);
});

test('disabled SLA processing performs no alert work and records paused health', async () => {
  let health;
  const result = await processGrowthSla({}, {
    growthStore: { setHealth: async (_component, value) => { health = value; } },
    emailStore: {}
  });
  assert.equal(result.paused, true);
  assert.equal(health.status, 'paused');
});

test('claimed conversations stop reminders while unclaimed conversations breach once', async () => {
  const milestones = [];
  const result = await processGrowthSla({ GROWTH_NOTIFICATIONS_ENABLED: 'true', POSTMARK_MOCK_MODE: 'true' }, {
    now: Date.parse('2026-08-25T14:31:00Z'),
    growthStore: {
      listOpenInquiries: async () => [
        { id: 'claimed', claimedAt: '2026-08-25T14:05:00Z', createdAt: '2026-08-25T14:00:00Z' },
        { id: 'late', platform: 'facebook', category: 'estimate_intent', createdAt: '2026-08-25T14:00:00Z' }
      ],
      markSlaMilestone: async (id, milestone) => { milestones.push([id, milestone]); return true; },
      setHealth: async () => {}
    },
    emailStore: { saveEmailEvent: async () => {} }
  });
  assert.deepEqual(milestones, [['late', 'breach30']]);
  assert.equal(result.breaches, 1);
});

test('SLA clocks count staffed minutes and pause nights and weekends', async () => {
  assert.equal(staffedMinutesElapsed('2026-08-28T20:55:00Z', '2026-08-31T12:20:00Z', 30), 25);
  assert.equal(staffedMinutesElapsed('2026-08-28T22:00:00Z', '2026-08-31T12:30:00Z', 30), 30);
  const milestones = [];
  await processGrowthSla({ GROWTH_NOTIFICATIONS_ENABLED: 'true', POSTMARK_MOCK_MODE: 'true' }, {
    now: Date.parse('2026-08-31T12:20:00Z'),
    growthStore: {
      listOpenInquiries: async () => [{ id: 'weekend', platform: 'instagram', category: 'estimate_intent', createdAt: '2026-08-28T20:55:00Z' }],
      markSlaMilestone: async (_id, milestone) => { milestones.push(milestone); return true; },
      setHealth: async () => {}
    },
    emailStore: { saveEmailEvent: async () => {} }
  });
  assert.deepEqual(milestones, ['reminder15']);
});

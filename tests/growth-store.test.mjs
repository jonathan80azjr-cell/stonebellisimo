import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTrackedUrl,
  contentRemoteTransitionErrors,
  containsPhoneNumber,
  contentTransitionAllowed,
  monthlyContentReadiness,
  normalizeContentManifest,
  normalizeSocialInquiry,
  qualificationErrors,
  validateContentApproval
} from '../src/growth-store.mjs';

test('content follows the standard state machine without skips', () => {
  assert.equal(contentTransitionAllowed('discovered', 'needs_review'), true);
  assert.equal(contentTransitionAllowed('needs_review', 'approved'), true);
  assert.equal(contentTransitionAllowed('approved', 'published'), false);
  assert.equal(contentTransitionAllowed('published', 'discovered'), false);
});

test('scheduled and published states require three exact-account remote readbacks', () => {
  const completePackage = status => ({
    remotePostId: `post-${status}`, remoteAccountId: `account-${status}`, idempotencyKey: `key-${status}`,
    uncertainWrite: false, remoteStatus: status, remoteReadAt: '2026-08-25T12:00:00Z'
  });
  assert.equal(contentRemoteTransitionErrors({ channelPackages: {} }, 'scheduled').length, 3);
  const scheduled = { channelPackages: Object.fromEntries(['google', 'instagram', 'facebook'].map(channel => [channel, completePackage('scheduled')])) };
  assert.deepEqual(contentRemoteTransitionErrors(scheduled, 'scheduled'), []);
  assert.equal(contentRemoteTransitionErrors(scheduled, 'published').length, 3);
});

test('content approval is blocked by rights, privacy, offer, and prior-post checks', () => {
  assert.deepEqual(validateContentApproval({
    rightsApproved: false,
    privacyCleared: false,
    priorPostStatus: '',
    contentPillar: 'testimonial_offer',
    includesOffer: true,
    offerApproved: false
  }), [
    'Media rights approval is required.',
    'Customer privacy clearance is required.',
    'Prior-post status must be reviewed.',
    'An offer must be approved before this item advances.'
  ]);
});

test('a content manifest starts discovered and retains approval facts', () => {
  const manifest = normalizeContentManifest({
    month: '2026-08',
    material: 'Quartz',
    projectType: 'Kitchen countertops',
    city: 'Union City',
    contentPillar: 'project_reveal',
    rightsApproved: true,
    privacyCleared: true,
    priorPostStatus: 'new'
  }, '2026-08-25T12:00:00.000Z');
  assert.equal(manifest.status, 'discovered');
  assert.equal(manifest.rightsApproved, true);
  assert.equal(manifest.city, 'Union City');
  assert.deepEqual(manifest.assets, []);
});

test('structured social inquiries reject message bodies and street addresses', () => {
  const base = { platform: 'instagram', accountId: 'ig_1', remoteInquiryId: 'dm_1', category: 'estimate_intent' };
  assert.throws(() => normalizeSocialInquiry({ ...base, message: 'Please call me' }), /must not include message/);
  assert.throws(() => normalizeSocialInquiry({ ...base, streetAddress: '1 Main St' }), /must not include streetAddress/);
  const inquiry = normalizeSocialInquiry({ ...base, city: 'Hoboken', postalCode: '07030' }, '2026-08-25T12:00:00.000Z');
  assert.equal(inquiry.status, 'open');
  assert.equal(inquiry.city, 'Hoboken');
});

test('qualification requires every staff-confirmed condition and consent', () => {
  assert.equal(qualificationErrors({
    serviceFit: true,
    serviceAreaFit: true,
    genuineProjectIntent: true,
    usableContactMethod: 'platform_dm',
    consentState: 'granted',
    consentVersion: 'consent-v1'
  }).length, 0);
  assert.match(qualificationErrors({ consentState: 'requested' }).join(' '), /Contact consent/);
});

test('tracked links normalize the required organic attribution', () => {
  const url = new URL(buildTrackedUrl('https://stonebellisimollc.com/contact-us/?ref=profile', {
    source: 'instagram',
    medium: 'organic_social',
    campaign: 'sb_organic_202608',
    content: 'SB-202608-01-Bio'
  }));
  assert.equal(url.searchParams.get('ref'), 'profile');
  assert.equal(url.searchParams.get('utm_source'), 'instagram');
  assert.equal(url.searchParams.get('utm_medium'), 'organic_social');
  assert.equal(url.searchParams.get('utm_campaign'), 'sb_organic_202608');
  assert.equal(url.searchParams.get('utm_content'), 'sb-202608-01-bio');
});

test('Google post phone stuffing is detectable without catching ordinary project numbers', () => {
  assert.equal(containsPhoneNumber('Call (201) 553-1919 today'), true);
  assert.equal(containsPhoneNumber('Project 24 · 2026 quartz reveal'), false);
});

test('monthly publishing readiness requires twelve packages, eighteen photos, and six verified vertical clips', () => {
  const assets = [
    ...Array.from({ length: 18 }, (_, index) => ({ id: `photo-${index}`, mimeType: 'image/jpeg' })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `clip-${index}`, mimeType: 'video/mp4', verticalApproved: true }))
  ];
  const ready = monthlyContentReadiness(Array.from({ length: 12 }, (_, index) => ({
    projectId: `project-${index % 4}`,
    contentPillar: index < 4 ? 'project_reveal'
      : index < 7 ? 'process'
        : index < 9 ? 'material_education'
          : index < 11 ? 'local_faq' : 'testimonial_offer',
    rightsApproved: true,
    privacyCleared: true,
    assets: index === 0 ? assets : []
  })));
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.counts, { packages: 12, photos: 18, verticalClips: 6, projects: 4 });
  assert.deepEqual(ready.mix, { project_reveal: 4, process: 3, material_education: 2, local_faq: 2, testimonial_offer: 1 });
  assert.equal(monthlyContentReadiness([{ rightsApproved: true, privacyCleared: true, assets }]).ready, false);
});

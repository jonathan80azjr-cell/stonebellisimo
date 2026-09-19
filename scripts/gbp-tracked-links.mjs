#!/usr/bin/env node
// Generates every outbound link that belongs on the Google Business Profile,
// already tagged so the lead it produces is attributable.
//
// The profile is the one surface where an untagged link is unrecoverable: a
// visit from the Maps listing and a visit from an ordinary search result arrive
// with the same referrer, so if the link was not tagged at click time there is
// no later analysis that can separate them. Paste these exactly as printed.
import { buildGbpTrackedUrl, campaignForMonth } from '../src/growth-attribution.mjs';

const SITE = 'https://stonebellisimollc.com';
const PLACE_ID = 'ChIJVbaFyYZXwokRgfG3kFqd5MY';
const campaign = process.argv.find(argument => argument.startsWith('--campaign='))?.split('=')[1] || campaignForMonth();

const LINKS = [
  ['Website button', `${SITE}/`, 'gbp-website-button'],
  ['Appointment / "Request a quote" link', `${SITE}/contact-us/#wizard-section`, 'gbp-appointment-link'],
  ['Service — kitchen countertops', `${SITE}/`, 'gbp-service', 'kitchen-countertops'],
  ['Service — bathroom vanities', `${SITE}/`, 'gbp-service', 'bathroom-vanities'],
  ['Service — fireplace surrounds', `${SITE}/`, 'gbp-service', 'fireplace-surrounds'],
  ['Service — commercial fabrication', `${SITE}/`, 'gbp-service', 'commercial'],
  ['Area — Jersey City', `${SITE}/areas-we-serve/new-jersey/jersey-city/`, 'gbp-service', 'jersey-city'],
  ['Area — Hoboken', `${SITE}/areas-we-serve/new-jersey/hoboken/`, 'gbp-service', 'hoboken'],
  ['Area — Bayonne', `${SITE}/areas-we-serve/new-jersey/bayonne/`, 'gbp-service', 'bayonne'],
  ['Area — North Bergen', `${SITE}/areas-we-serve/new-jersey/north-bergen/`, 'gbp-service', 'north-bergen'],
  ['Area — Weehawken', `${SITE}/areas-we-serve/new-jersey/weehawken/`, 'gbp-service', 'weehawken'],
  ['Area — Secaucus', `${SITE}/areas-we-serve/new-jersey/secaucus/`, 'gbp-service', 'secaucus'],
  ['Post CTA — monthly project reveal', `${SITE}/contact-us/#wizard-section`, 'gbp-post', 'project-reveal'],
  ['Post CTA — material education', `${SITE}/`, 'gbp-post', 'material-education'],
  ['Post CTA — local FAQ', `${SITE}/`, 'gbp-post', 'local-faq']
];

console.log(`Campaign: ${campaign}\n`);
for (const [label, destination, placement, detail] of LINKS) {
  console.log(`${label}\n  ${buildGbpTrackedUrl(destination, { campaign, placement, detail })}\n`);
}

// The review link is deliberately NOT tagged. It leaves the site rather than
// entering it, so campaign parameters would be dropped by Google and only make
// the link look untrustworthy to the customer being asked for a review.
console.log('Review request link (send to customers; do not add UTMs — it points into Google, not the site)');
console.log(`  https://search.google.com/local/writereview?placeid=${PLACE_ID}\n`);
console.log('Profile links must be replaced when the campaign month rolls over:');
console.log('  node scripts/gbp-tracked-links.mjs --campaign=sb_organic_YYYYMM');

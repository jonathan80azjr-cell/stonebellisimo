// Google Analytics 4 loader. This is the ONLY place the measurement ID is
// written; scripts/build-client.mjs bundles it to public/assets/js/analytics.js
// and every page loads that one file. Pages must not set the ID inline, or the
// site ends up with twelve copies that drift apart.
//
// The measurement ID is not a secret. It is visible in the page source of every
// site that runs GA, so it is committed rather than injected from an env var:
// a build that forgets an env var would silently ship a site with no analytics,
// which is the failure mode this file exists to avoid.
//
// GA4 complements the first-party tracker in site-analytics.js; it does not
// replace it. The first-party tracker remains the source of truth for leads and
// conversions because it is server-confirmed and survives ad blockers.
const MEASUREMENT_ID = '';

(function () {
  if (!/^G-[A-Z0-9]+$/.test(MEASUREMENT_ID)) return;

  window.dataLayer = window.dataLayer || [];

  function gtag() {
    window.dataLayer.push(arguments);
  }

  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, { send_page_view: true });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
})();

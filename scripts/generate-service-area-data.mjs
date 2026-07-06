import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'public', 'data', 'service-areas');
const AREAS_DIR = join(ROOT, 'public', 'areas-we-serve');
const SOURCE_URL = 'https://raw.githubusercontent.com/scpike/us-state-county-zip/master/geo-data.csv';

const STATES = {
  nj: { name: 'New Jersey', abbr: 'NJ', file: 'nj.json', path: 'new-jersey' },
  pa: { name: 'Pennsylvania', abbr: 'PA', file: 'pa.json', path: 'pennsylvania' },
  nyc: { name: 'New York City', abbr: 'NY', file: 'nyc.json', path: 'new-york-city' },
  ny: { name: 'New York State', abbr: 'NY', file: 'ny.json', path: 'new-york' },
  ct: { name: 'Connecticut', abbr: 'CT', file: 'ct.json', path: 'connecticut' },
  ma: { name: 'Massachusetts', abbr: 'MA', file: 'ma.json', path: 'massachusetts' }
};

const PAGES = {
  nj: {
    title: 'New Jersey Countertop Installation Service Areas | Stone Bellisimo',
    description: 'Stone Bellisimo serves New Jersey with quartz countertops, granite countertops, marble, stone fabrication, and countertop installation. Search NJ towns and ZIP Codes.',
    h1: 'New Jersey countertop installation and stone fabrication.',
    kicker: 'New Jersey Service Areas',
    intro: 'Stone Bellisimo is based in Union City and regularly works throughout New Jersey, from nearby Hudson County and Bergen County projects to work as far south as Cape May. Homeowners, designers, builders, and commercial clients rely on our team for quartz countertops, granite countertops, marble countertops, quartzite, porcelain, kitchen countertops, bathroom vanities, and custom stone fabrication.',
    detail: 'Use the directory below to search towns, cities, counties, and ZIP Codes commonly associated with New Jersey service planning. For scheduling, access, and exact project address availability, contact the showroom and our team will confirm the right route.',
    featured: ['Union City', 'Jersey City', 'Hoboken', 'Newark', 'Princeton', 'Cape May'],
    img: '../../assets/img/portfolio_kitchen_grey-800.jpg'
  },
  pa: {
    title: 'Pennsylvania Countertop Installation Service Areas | Stone Bellisimo',
    description: 'Pennsylvania service areas for Stone Bellisimo countertop installation, quartz countertops, granite countertops, marble fabrication, and commercial stonework.',
    h1: 'Pennsylvania countertop service for select residential and commercial projects.',
    kicker: 'Pennsylvania Service Areas',
    intro: 'Stone Bellisimo is available for select Pennsylvania projects, especially where the scope calls for premium stone fabrication, careful measurement, and a polished installation plan. Our team has served parts of Pennsylvania for quartz countertops, granite countertops, marble countertops, kitchen countertops, bathroom vanities, and commercial stonework.',
    detail: 'Search the Pennsylvania directory below by town, county, or ZIP Code. Because travel, timing, and project scope matter, please contact us to confirm scheduling for your exact location.',
    featured: ['Philadelphia', 'Allentown', 'Bethlehem', 'Easton', 'Scranton', 'Pittsburgh'],
    img: '../../assets/img/portfolio_kitchen_peninsula-800.jpg'
  },
  nyc: {
    title: 'NYC Countertop Installation Service Areas | Stone Bellisimo',
    description: 'New York City countertop installation service areas by borough for quartz, granite, marble, porcelain, bathroom vanities, and commercial stonework.',
    h1: 'New York City stone fabrication and countertop installation by borough.',
    kicker: 'NYC Service Areas',
    intro: 'Stone Bellisimo works across New York City, including Manhattan, Brooklyn, Queens, the Bronx, and Staten Island. City projects often call for precise planning around access, building rules, elevator timing, seams, and installation windows, especially for kitchen countertops, bathroom vanities, and commercial stonework.',
    detail: 'Our NYC experience includes notable community and commercial work such as the Boys & Girls Club in the Bronx. Search by borough, neighborhood city name, county, or ZIP Code, then contact us to confirm scheduling for the exact project address.',
    featured: ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'],
    img: '../../assets/img/portfolio_marble_backsplash-800.jpg'
  },
  ny: {
    title: 'New York State Countertop Installation Service Areas | Stone Bellisimo',
    description: 'New York State countertop installation service areas for quartz, granite, marble, stone fabrication, kitchen countertops, vanities, and commercial stonework.',
    h1: 'New York State countertop installation and stone fabrication.',
    kicker: 'New York State Service Areas',
    intro: 'Stone Bellisimo serves New York City and is available for projects throughout New York State, including parts of upstate New York. From city apartments and commercial interiors to suburban renovations, our team brings refined stone fabrication and countertop installation to clients who expect clean communication and a precise finished result.',
    detail: 'New York City is a featured subregion with its own borough-focused page. Use this broader New York State directory to search towns, counties, and ZIP Codes commonly associated with service planning, then contact us to confirm scheduling for your exact address.',
    featured: ['New York City', 'Yonkers', 'White Plains', 'Albany', 'Syracuse', 'Buffalo'],
    img: '../../assets/img/gallery-1600.jpg'
  },
  ct: {
    title: 'Connecticut Countertop Installation Service Areas | Stone Bellisimo',
    description: 'Connecticut service areas for Stone Bellisimo quartz countertops, granite countertops, marble fabrication, countertop installation, and commercial stonework.',
    h1: 'Connecticut countertop projects with premium stone craftsmanship.',
    kicker: 'Connecticut Service Areas',
    intro: 'Stone Bellisimo has traveled north and east into Connecticut for stone projects that need careful fabrication, polished installation, and premium material guidance. We are available for select Connecticut kitchen countertops, bathroom vanities, marble countertops, quartzite, porcelain, and commercial stonework.',
    detail: 'Search Connecticut towns, counties, and ZIP Codes below. Coverage depends on project scope, timing, access, and route availability, so contact us to confirm scheduling for your exact location.',
    featured: ['Stamford', 'Greenwich', 'Norwalk', 'Bridgeport', 'New Haven', 'Hartford'],
    img: '../../assets/img/vanity-1200.jpg'
  },
  ma: {
    title: 'Massachusetts Countertop Installation Service Areas | Stone Bellisimo',
    description: 'Massachusetts extended service areas for Stone Bellisimo quartz, granite, marble, countertop installation, stone fabrication, and commercial stonework.',
    h1: 'Massachusetts extended service-area stone projects.',
    kicker: 'Massachusetts Extended Service Area',
    intro: 'Massachusetts is an extended service-area state for Stone Bellisimo. For the right residential, designer-led, builder, or commercial project, our team can review availability for quartz countertops, granite countertops, marble countertops, kitchen countertops, bathroom vanities, porcelain, quartzite, and custom stone fabrication.',
    detail: 'Search towns, counties, and ZIP Codes commonly associated with Massachusetts project planning below. Because Massachusetts work is handled as extended coverage, please contact us early to confirm schedule, travel, and project fit.',
    featured: ['Boston', 'Cambridge', 'Worcester', 'Springfield', 'Lowell', 'Newton'],
    img: '../../assets/img/kitchen-1200.jpg'
  }
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function slugify(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function titleCase(input) {
  return input
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\bMc([a-z])/g, (match, letter) => `Mc${letter.toUpperCase()}`)
    .replace(/\bSt\. ([a-z])/g, (match, letter) => `St. ${letter.toUpperCase()}`);
}

function boroughForCounty(county) {
  return {
    Bronx: 'Bronx',
    Kings: 'Brooklyn',
    'New York': 'Manhattan',
    Queens: 'Queens',
    Richmond: 'Staten Island'
  }[county] || null;
}

function groupRecords(rows, stateAbbr, mode = 'state') {
  const map = new Map();
  rows
    .filter((record) => record.state_abbr === stateAbbr)
    .filter((record) => /^\d{5}$/.test(String(record.zipcode)))
    .filter((record) => !/^zcta\b/i.test(record.city))
    .filter((record) => {
      if (mode !== 'nyc') return true;
      return Boolean(boroughForCounty(record.county));
    })
    .forEach((record) => {
      const city = titleCase(record.city);
      const county = titleCase(record.county);
      const region = mode === 'nyc' ? boroughForCounty(county) : county;
      const key = `${city}|${county}|${region}`;
      const existing = map.get(key) || {
        city,
        state: record.state_abbr,
        county,
        region,
        zipCodes: [],
        slug: slugify(`${city}-${record.state_abbr}-${region}`)
      };
      existing.zipCodes.push(String(record.zipcode).padStart(5, '0'));
      map.set(key, existing);
    });

  return [...map.values()]
    .map((record) => ({ ...record, zipCodes: [...new Set(record.zipCodes)].sort() }))
    .sort((a, b) => a.region.localeCompare(b.region) || a.city.localeCompare(b.city));
}

function areaJson(key, rows) {
  const config = STATES[key];
  const records = groupRecords(rows, config.abbr, key === 'nyc' ? 'nyc' : 'state');
  return {
    generatedAt: new Date().toISOString(),
    source: {
      name: 'scpike/us-state-county-zip geo-data.csv',
      url: SOURCE_URL,
      note: 'Records are ZIP/ZCTA-style city, state, and county associations. ZIP Codes are postal delivery identifiers and do not perfectly match municipal boundaries.'
    },
    serviceArea: config.name,
    state: config.abbr,
    records
  };
}

function nav(prefix = '.') {
  return `
<div id="mob-menu">
  <a href="${prefix}/">Home</a>
  <a href="${prefix}/#products">Products</a>
  <a href="${prefix}/#materials">Materials</a>
  <a href="${prefix}/about/">About</a>
  <a href="${prefix}/areas-we-serve.html">Areas We Serve</a>
  <a href="${prefix}/#reviews">Reviews</a>
  <a href="${prefix}/contact-us/">Contact</a>
  <div class="mob-cta-wrap"><a href="${prefix}/#wizard-section">Get Free Estimate</a></div>
</div>
<nav id="nav">
  <div class="nav-w">
    <a href="${prefix}/" class="n-logo"><img src="${prefix}/assets/img/logo-280.png" alt="Stone Bellisimo LLC - Custom Countertops logo" width="140" height="54" decoding="async"></a>
    <ul class="nl">
      <li><a href="${prefix}/#products">Products</a></li>
      <li><a href="${prefix}/#materials">Materials</a></li>
      <li><a href="${prefix}/about/">About</a></li>
      <li><a href="${prefix}/areas-we-serve.html" class="active">Areas We Serve</a></li>
      <li><a href="${prefix}/#process">Process</a></li>
      <li><a href="${prefix}/#reviews">Reviews</a></li>
      <li><a href="${prefix}/contact-us/">Contact</a></li>
    </ul>
    <a href="${prefix}/#wizard-section" class="n-cta">Free Estimate</a>
    <button class="n-ham" id="ham" onclick="toggleMenu()" aria-label="Open menu"><span></span><span></span><span></span></button>
  </div>
</nav>`;
}

function footer(prefix = '.') {
  return `
<footer>
  <div class="foot-w">
    <div class="foot-top">
      <a href="${prefix}/" class="foot-logo"><img src="${prefix}/assets/img/logo-280.png" alt="Stone Bellisimo LLC - Custom Countertops logo" width="93" height="36" loading="lazy" decoding="async"></a>
      <ul class="foot-nav">
        <li><a href="${prefix}/#products">Products</a></li>
        <li><a href="${prefix}/#materials">Materials</a></li>
        <li><a href="${prefix}/about/">About</a></li>
        <li><a href="${prefix}/areas-we-serve.html" class="active">Areas We Serve</a></li>
        <li><a href="${prefix}/#process">Process</a></li>
        <li><a href="${prefix}/#reviews">Reviews</a></li>
        <li><a href="${prefix}/contact-us/">Contact</a></li>
      </ul>
      <div class="foot-social">
        <a href="https://www.instagram.com/stonebellisimollc/" class="soc" target="_blank" rel="noopener" title="Instagram">IG</a>
        <a href="https://www.facebook.com/StoneBellisimoLLC" class="soc" target="_blank" rel="noopener" title="Facebook">FB</a>
        <a href="https://x.com/Stonebellisimo" class="soc" target="_blank" rel="noopener" title="X">X</a>
        <a href="https://www.pinterest.com/stonebellisimollc/" class="soc" target="_blank" rel="noopener" title="Pinterest">PT</a>
        <a href="https://www.houzz.com/pro/webuser-799389841/stone-bellisimo-llc" class="soc" target="_blank" rel="noopener" title="Houzz">HZ</a>
      </div>
    </div>
    <hr class="foot-divider">
    <div class="foot-bottom">
      <span class="foot-copy">(c) 2026 Stone Bellisimo LLC - 618 23rd Street, Union City, NJ 07087 - <a href="tel:+12015531919">201.553.1919</a></span>
    </div>
  </div>
</footer>`;
}

function sharedHead({ title, description, canonical, image = 'https://stonebellisimollc.com/assets/img/logo-280.png', cssPrefix = '.' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://cloudflareinsights.com; frame-src https://www.google.com https://maps.google.com; form-action 'self'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="twitter:card" content="summary_large_image">
<meta property="twitter:url" content="${canonical}">
<meta property="twitter:title" content="${title}">
<meta property="twitter:description" content="${description}">
<meta property="twitter:image" content="${image}">
<link rel="stylesheet" href="${cssPrefix}/components/bitesites-banner.css?v=7">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="icon" href="${cssPrefix}/assets/img/stone-bellisimo-favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="${cssPrefix}/assets/img/stone-bellisimo-favicon.png" type="image/png">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${cssPrefix}/assets/css/service-areas.css?v=1">`;
}

function schemaForPage(page, url, crumbs, areas = []) {
  return `<script type="application/ld+json">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['LocalBusiness', 'HomeAndConstructionBusiness'],
        '@id': 'https://stonebellisimollc.com/#business',
        name: 'Stone Bellisimo LLC',
        image: 'https://stonebellisimollc.com/assets/img/logo-280.png',
        telephone: '+1-201-553-1919',
        email: 'cesaryunda@hotmail.com',
        url: 'https://stonebellisimollc.com/',
        priceRange: '$$',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '618 23rd Street',
          addressLocality: 'Union City',
          addressRegion: 'NJ',
          postalCode: '07087',
          addressCountry: 'US'
        },
        areaServed: areas.map((name) => ({ '@type': 'AdministrativeArea', name }))
      },
      {
        '@type': 'Service',
        '@id': `${url}#service`,
        name: page.title,
        serviceType: 'Countertop installation, stone fabrication, quartz countertops, granite countertops, marble countertops, bathroom vanities, and commercial stonework',
        provider: { '@id': 'https://stonebellisimollc.com/#business' },
        areaServed: areas.map((name) => ({ '@type': 'AdministrativeArea', name }))
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: crumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: crumb.url
        }))
      }
    ]
  }, null, 2)}
</script>`;
}

const stateLinks = [
  ['New Jersey', './areas-we-serve/new-jersey/'],
  ['New York City', './areas-we-serve/new-york-city/'],
  ['New York State', './areas-we-serve/new-york/'],
  ['Pennsylvania', './areas-we-serve/pennsylvania/'],
  ['Connecticut', './areas-we-serve/connecticut/'],
  ['Massachusetts', './areas-we-serve/massachusetts/']
];

function mainPage() {
  const title = 'Areas We Serve | Stone Bellisimo LLC';
  const description = 'Stone Bellisimo serves New Jersey, New York, Pennsylvania, Connecticut, and extended Massachusetts service areas with premium countertop installation and stone fabrication.';
  const canonical = 'https://stonebellisimollc.com/areas-we-serve.html';
  const cards = [
    ['New Jersey', './areas-we-serve/new-jersey/', 'Regularly working throughout New Jersey, from our Union City base to projects as far south as Cape May.'],
    ['New York City', './areas-we-serve/new-york-city/', 'Borough-aware planning for Manhattan, Brooklyn, Queens, the Bronx, and Staten Island stone projects.'],
    ['New York State', './areas-we-serve/new-york/', 'Available for projects throughout New York State, including NYC and parts of upstate New York.'],
    ['Pennsylvania', './areas-we-serve/pennsylvania/', 'Serving select Pennsylvania countertop, vanity, and commercial stonework projects by scope and schedule.'],
    ['Connecticut', './areas-we-serve/connecticut/', 'Our work has reached north and east into Connecticut for premium residential and commercial installations.'],
    ['Massachusetts', './areas-we-serve/massachusetts/', 'Extended service-area coverage for Massachusetts projects where the fit, timing, and scope align.']
  ];
  return `${sharedHead({ title, description, canonical, cssPrefix: '.' })}
${schemaForPage({ title }, canonical, [
    { name: 'Home', url: 'https://stonebellisimollc.com/' },
    { name: 'Areas We Serve', url: canonical }
  ], ['New Jersey', 'New York', 'Pennsylvania', 'Connecticut', 'Massachusetts'])}
</head>
<body>
${nav('.')}
<main>
  <header class="area-hero main-hero">
    <div class="area-hero-bg" style="background-image:url('./assets/img/gallery-1600.jpg')"></div>
    <div class="area-hero-w">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="./">Home</a><span>Areas We Serve</span></nav>
      <div class="hero-pill"><span class="pill-dot"></span>Northeast Stone Fabrication</div>
      <h1>Premium countertop installation across the <em>tri-state region and Northeast.</em></h1>
      <p class="hero-sub">From New Jersey homes to New York City commercial spaces, Pennsylvania renovations, Connecticut properties, and select Massachusetts projects, Stone Bellisimo brings premium stone fabrication and installation to clients who expect craftsmanship, communication, and a clean finished result.</p>
      <div class="hero-actions">
        <a class="btn-gold" href="./#wizard-section">Request a Free Estimate</a>
        <a class="btn-ghost" href="./contact-us/">Confirm Service in Your Area</a>
        <a class="btn-ghost" href="./#gallery">View Our Work</a>
      </div>
    </div>
  </header>
  <section class="s intro-band">
    <div class="sw split">
      <div>
        <span class="s-tag">Regional Reach</span>
        <h2 class="s-h">Serving New Jersey, New York, Pennsylvania, Connecticut, and select <em>Massachusetts</em> projects.</h2>
      </div>
      <div class="copy-stack">
        <p>Stone Bellisimo serves a broad Northeast footprint rooted in the tri-state region. The team has worked across all of New Jersey, across all of New York City, throughout New York State, in parts of Pennsylvania, and as far north and east as Connecticut.</p>
        <p>Our work has taken us from Cape May to Connecticut, across New York City and upstate New York, including notable commercial and community projects such as the Boys & Girls Club in the Bronx.</p>
        <p>While our installation work is rooted in the Northeast, our client relationships have extended internationally, including close collaboration with clients in China.</p>
        <p>Explore dedicated pages for <a href="./areas-we-serve/new-jersey/">New Jersey</a>, <a href="./areas-we-serve/new-york-city/">New York City</a>, <a href="./areas-we-serve/new-york/">New York State</a>, <a href="./areas-we-serve/pennsylvania/">Pennsylvania</a>, <a href="./areas-we-serve/connecticut/">Connecticut</a>, and <a href="./areas-we-serve/massachusetts/">Massachusetts</a>.</p>
      </div>
    </div>
  </section>
  <section class="s trust-dark">
    <div class="sw">
      <span class="s-tag">What We Bring</span>
      <h2 class="s-h wh">Stonework that travels well because the process is <em>disciplined.</em></h2>
      <div class="trust-grid">
        <article class="trust-card"><h3>Material guidance</h3><p>Quartz countertops, granite countertops, marble countertops, quartzite, porcelain, and slab selection support for kitchens, vanities, fireplaces, and commercial surfaces.</p></article>
        <article class="trust-card"><h3>Measurement clarity</h3><p>Project-specific review of access, seams, edge profiles, sinks, walls, and installation timing before fabrication begins.</p></article>
        <article class="trust-card"><h3>Professional scheduling</h3><p>We serve broad regions without overpromising every address. Contact us to confirm scheduling for your exact location and project scope.</p></article>
      </div>
    </div>
  </section>
  <section class="s">
    <div class="sw">
      <span class="s-tag">Explore By State</span>
      <h2 class="s-h">Searchable service-area pages by <em>state and region.</em></h2>
      <div class="state-grid">
        ${cards.map(([name, href, text]) => `<article class="state-card"><h3>${name}</h3><p>${text}</p><a href="${href}">View ${name} service areas</a></article>`).join('\n        ')}
      </div>
      <p class="note">These pages list towns, cities, counties, boroughs, and ZIP Codes commonly associated with the service region. ZIP Codes are postal delivery identifiers, not guaranteed municipal boundaries or exact service promises.</p>
    </div>
  </section>
  <section class="cta-full">
    <div class="cta-content">
      <h2>Planning a stone project in the Northeast?</h2>
      <p>Tell us where the project is located and what you are building. We will confirm availability, timing, and whether your address fits our current route.</p>
      <div class="hero-actions center">
        <a class="btn-gold" href="./#wizard-section">Request a Free Estimate</a>
        <a class="btn-ghost" href="./contact-us/">Confirm Service in Your Area</a>
      </div>
    </div>
  </section>
</main>
${footer('.')}
<script src="./assets/js/service-area-search.js?v=1" defer></script>
<script src="./performance.js?v=2" defer></script>
</body>
</html>`;
}

function detailPage(key) {
  const page = PAGES[key];
  const state = STATES[key];
  const canonical = `https://stonebellisimollc.com/areas-we-serve/${state.path}/`;
  const prefix = '../..';
  const organicLinks = Object.entries(STATES)
    .filter(([other]) => other !== key)
    .map(([other, cfg]) => `<a href="../${cfg.path}/">${cfg.name}</a>`)
    .join(', ');
  const allLinks = Object.entries(STATES)
    .filter(([other]) => other !== key)
    .map(([other, cfg]) => `<a href="../${cfg.path}/">${cfg.name}</a>`)
    .join('');
  return `${sharedHead({ title: page.title, description: page.description, canonical, cssPrefix: prefix })}
${schemaForPage(page, canonical, [
    { name: 'Home', url: 'https://stonebellisimollc.com/' },
    { name: 'Areas We Serve', url: 'https://stonebellisimollc.com/areas-we-serve.html' },
    { name: state.name, url: canonical }
  ], [state.name])}
</head>
<body>
${nav(prefix)}
<main>
  <header class="area-hero detail-hero">
    <div class="area-hero-bg" style="background-image:url('${page.img}')"></div>
    <div class="area-hero-w">
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${prefix}/">Home</a><a href="${prefix}/areas-we-serve.html">Areas We Serve</a><span>${state.name}</span></nav>
      <div class="hero-pill"><span class="pill-dot"></span>${page.kicker}</div>
      <h1>${page.h1}</h1>
      <p class="hero-sub">${page.intro}</p>
      <div class="hero-actions">
        <a class="btn-gold" href="${prefix}/#wizard-section">Request a Free Estimate</a>
        <a class="btn-ghost" href="${prefix}/contact-us/">Confirm Service in Your Area</a>
      </div>
    </div>
  </header>
  <section class="s intro-band">
    <div class="sw split">
      <div>
        <span class="s-tag">Stone Bellisimo in ${state.name}</span>
        <h2 class="s-h">Quartz, granite, marble, porcelain, and custom stonework with <em>clear scheduling.</em></h2>
      </div>
      <div class="copy-stack">
        <p>${page.detail}</p>
        <p>We fabricate and install stone for <a href="${prefix}/#products">kitchen countertops</a>, <a href="${prefix}/#materials">quartz, granite, marble, quartzite, and porcelain surfaces</a>, bathroom vanities, fireplace surrounds, and commercial stonework. You can also <a href="${prefix}/areas-we-serve.html">return to the main Areas We Serve page</a> to compare nearby states.</p>
        <p>Planning across the region? Review our related service-area pages for ${organicLinks}.</p>
        ${key === 'ny' ? `<p>For borough-specific information, visit the dedicated <a href="../new-york-city/">New York City service area page</a>.</p>` : ''}
      </div>
    </div>
  </section>
  <section class="s quick-cta">
    <div class="sw quick-grid">
      <article><span class="s-tag">Featured Areas</span><h2>${page.featured.join(' · ')}</h2><p>Featured names are examples only. Use the searchable directory below for broader town, city, county, borough, and ZIP Code associations.</p></article>
      <article><span class="s-tag">Need Confirmation?</span><h2>Contact us before planning access or installation dates.</h2><p>ZIP Codes are postal delivery identifiers. Service availability should always be confirmed for exact project addresses.</p></article>
    </div>
  </section>
  <section class="s area-search-section">
    <div class="sw">
      <span class="s-tag">Search ${state.name}</span>
      <h2 class="s-h">Find towns, cities, counties, boroughs, and <em>ZIP Codes.</em></h2>
      <div class="area-search" data-service-area-search data-data-url="${prefix}/data/service-areas/${state.file}" data-region-label="${key === 'nyc' ? 'Borough' : 'County / Region'}">
        <div class="search-controls">
          <label for="service-area-query">Search by town, city, ZIP Code, ${key === 'nyc' ? 'borough' : 'county'}, or region</label>
          <div class="search-row">
            <input id="service-area-query" type="search" autocomplete="postal-code" placeholder="Try ${page.featured[0]} or a ZIP Code">
            <button type="button" data-clear-search>Clear search</button>
          </div>
        </div>
        <p class="search-summary" data-search-summary aria-live="polite">Loading service-area data...</p>
        <div class="results-grid" data-results></div>
        <div class="empty-state" data-empty-state hidden>Don't see your town or ZIP Code? <a href="${prefix}/contact-us/">Contact us</a> — we may still be able to help.</div>
      </div>
      <p class="note">Source data represents towns, cities, and ZIP Codes commonly associated with the service region. ZIP Codes and ZCTAs do not perfectly equal municipal boundaries, and availability should be confirmed for the exact project address.</p>
      <div class="state-link-row" aria-label="Other service area pages">${allLinks}</div>
    </div>
  </section>
  <section class="cta-full">
    <div class="cta-content">
      <h2>Ready to plan your ${state.name} countertop project?</h2>
      <p>Share the address, material direction, and project timeline. We will confirm availability and the best next step for measurement or showroom review.</p>
      <div class="hero-actions center">
        <a class="btn-gold" href="${prefix}/#wizard-section">Request a Free Estimate</a>
        <a class="btn-ghost" href="${prefix}/contact-us/">Confirm Service in Your Area</a>
      </div>
    </div>
  </section>
</main>
${footer(prefix)}
<script src="${prefix}/assets/js/service-area-search.js?v=1" defer></script>
<script src="${prefix}/performance.js?v=2" defer></script>
</body>
</html>`;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(AREAS_DIR, { recursive: true });

  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Unable to fetch source CSV: ${response.status}`);
  const csv = await response.text();
  const [header, ...lines] = parseCsv(csv);
  const rows = lines.map((line) => Object.fromEntries(header.map((name, index) => [name, line[index]])));

  for (const key of Object.keys(STATES)) {
    const json = areaJson(key, rows);
    await writeFile(join(DATA_DIR, STATES[key].file), `${JSON.stringify(json, null, 2)}\n`);
  }

  await writeFile(join(DATA_DIR, 'README.md'), `# Service Area Data

Generated by \`scripts/generate-service-area-data.mjs\`.

Source: \`geo-data.csv\` from \`scpike/us-state-county-zip\`:
${SOURCE_URL}

The source maps ZIP/ZCTA-style records to city, state, and county names. These files are used as a maintainable directory of towns, cities, counties/boroughs, and ZIP Codes commonly associated with Stone Bellisimo service planning.

Important wording note: ZIP Codes are postal delivery identifiers, and ZCTAs/ZIP associations do not perfectly equal municipal boundaries or guaranteed service coverage. Page copy should continue to say "serving", "available for projects across", "commonly associated with", and "contact us to confirm scheduling for your exact location."
`);

  await writeFile(join(ROOT, 'public', 'areas-we-serve.html'), mainPage());
  for (const key of Object.keys(STATES)) {
    const outDir = join(AREAS_DIR, STATES[key].path);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'index.html'), detailPage(key));
  }

  await writeFile(join(ROOT, 'public', 'service-areas', 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="0; url=../areas-we-serve.html">
<link rel="canonical" href="https://stonebellisimollc.com/areas-we-serve.html">
<title>Areas We Serve | Stone Bellisimo LLC</title>
</head>
<body>
<p>Stone Bellisimo service areas have moved to <a href="../areas-we-serve.html">Areas We Serve</a>.</p>
</body>
</html>
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

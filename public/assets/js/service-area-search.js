(function () {
  const navEl = document.getElementById('nav');
  if (navEl) {
    window.addEventListener('scroll', () => navEl.classList.toggle('light', window.scrollY > 70), { passive: true });
  }

  let menuOpen = false;
  window.toggleMenu = function toggleMenu() {
    menuOpen = !menuOpen;
    const menu = document.getElementById('mob-menu');
    const ham = document.getElementById('ham');
    if (menu) menu.classList.toggle('open', menuOpen);
    if (ham) ham.classList.toggle('open', menuOpen);
    document.body.style.overflow = menuOpen ? 'hidden' : '';
  };

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuOpen) window.toggleMenu();
  });

  const revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 })
    : null;

  document.querySelectorAll('.r,.r2,.r3,.state-card,.trust-card').forEach((element) => {
    if (revealObserver) revealObserver.observe(element);
    else element.classList.add('in');
  });

  function searchableText(record) {
    return [
      record.city,
      record.state,
      record.county,
      record.region,
      ...(record.zipCodes || [])
    ].join(' ').toLowerCase();
  }

  function groupByRegion(records) {
    return records.reduce((groups, record) => {
      const region = record.region || record.county || 'Region';
      if (!groups.has(region)) groups.set(region, []);
      groups.get(region).push(record);
      return groups;
    }, new Map());
  }

  function resultCard(record, regionLabel) {
    const zipPreview = (record.zipCodes || []).slice(0, 12).join(', ');
    const extra = (record.zipCodes || []).length > 12 ? ` +${record.zipCodes.length - 12} more` : '';
    return `<article class="result-card" id="${record.slug}">
      <h3>${record.city}</h3>
      <p><strong>${regionLabel}:</strong> ${record.region || record.county}</p>
      <p><strong>ZIP Codes:</strong> ${zipPreview}${extra}</p>
    </article>`;
  }

  function render(container, records, query) {
    const resultsEl = container.querySelector('[data-results]');
    const summaryEl = container.querySelector('[data-search-summary]');
    const emptyEl = container.querySelector('[data-empty-state]');
    const regionLabel = container.dataset.regionLabel || 'County / Region';
    const normalized = query.trim().toLowerCase();
    const visible = normalized
      ? records.filter((record) => searchableText(record).includes(normalized))
      : records;

    if (!resultsEl || !summaryEl || !emptyEl) return;
    emptyEl.hidden = visible.length > 0;
    summaryEl.textContent = visible.length === records.length
      ? `Showing ${visible.length.toLocaleString()} town and city records.`
      : `Showing ${visible.length.toLocaleString()} matching record${visible.length === 1 ? '' : 's'} for "${query}".`;

    const groups = groupByRegion(visible);
    resultsEl.innerHTML = [...groups.entries()].map(([region, groupRecords]) => `
      <section class="result-group" aria-label="${region}">
        <h3>${region}</h3>
        <div class="result-card-grid">
          ${groupRecords.map((record) => resultCard(record, regionLabel)).join('')}
        </div>
      </section>
    `).join('');
  }

  document.querySelectorAll('[data-service-area-search]').forEach(async (container) => {
    const input = container.querySelector('input[type="search"]');
    const clear = container.querySelector('[data-clear-search]');
    const summary = container.querySelector('[data-search-summary]');
    const dataUrl = container.dataset.dataUrl;
    if (!input || !dataUrl) return;

    try {
      const response = await fetch(dataUrl);
      if (!response.ok) throw new Error(`Unable to load ${dataUrl}`);
      const data = await response.json();
      const records = Array.isArray(data.records) ? data.records : [];
      render(container, records, input.value);
      input.addEventListener('input', () => render(container, records, input.value));
      if (clear) {
        clear.addEventListener('click', () => {
          input.value = '';
          input.focus();
          render(container, records, '');
        });
      }
    } catch (error) {
      if (summary) summary.textContent = 'Service-area data could not be loaded. Please contact us to confirm availability.';
      console.error(error);
    }
  });
}());

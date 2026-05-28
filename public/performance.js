(function () {
  'use strict';

  var metricId = Math.random().toString(36).slice(2);
  var page = location.pathname || '/';
  var navEntry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  var navigationType = navEntry ? navEntry.type : 'navigate';

  function rating(name, value) {
    var limits = {
      CLS: [0.1, 0.25],
      FCP: [1800, 3000],
      INP: [200, 500],
      LCP: [2500, 4000],
      TTFB: [800, 1800]
    }[name];

    if (!limits) return 'info';
    if (value <= limits[0]) return 'good';
    if (value <= limits[1]) return 'needs-improvement';
    return 'poor';
  }

  function sendMetric(name, value, extra) {
    if (!Number.isFinite(value)) return;

    var body = JSON.stringify(Object.assign({
      id: metricId + '-' + name,
      name: name,
      value: Math.round(value * 1000) / 1000,
      rating: rating(name, value),
      page: page,
      navigationType: navigationType,
      timestamp: Date.now()
    }, extra || {}));

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/performance', new Blob([body], { type: 'application/json' }));
      return;
    }

    fetch('/api/performance', {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true
    }).catch(function () {});
  }

  function observe(type, callback, options) {
    if (!('PerformanceObserver' in window)) return;
    try {
      var observer = new PerformanceObserver(callback);
      observer.observe(Object.assign({ type: type, buffered: true }, options || {}));
      return observer;
    } catch (error) {}
  }

  function applyAvifImages() {
    document.querySelectorAll('img[data-avif]').forEach(function (img) {
      var avif = img.getAttribute('data-avif');
      if (avif) img.src = avif;
    });
  }

  function detectAvif() {
    window.__avifSupported = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detectAvif, { once: true });
  } else {
    detectAvif();
  }

  observe('paint', function (list) {
    list.getEntries().forEach(function (entry) {
      if (entry.name === 'first-contentful-paint') sendMetric('FCP', entry.startTime);
    });
  });

  var cls = 0;
  observe('layout-shift', function (list) {
    list.getEntries().forEach(function (entry) {
      if (!entry.hadRecentInput) cls += entry.value;
    });
  });

  var lcp = 0;
  observe('largest-contentful-paint', function (list) {
    var entries = list.getEntries();
    var last = entries[entries.length - 1];
    if (last) lcp = last.startTime;
  });

  var inp = 0;
  observe('event', function (list) {
    list.getEntries().forEach(function (entry) {
      if (entry.interactionId && entry.duration > inp) inp = entry.duration;
    });
  }, { durationThreshold: 40 });

  window.addEventListener('load', function () {
    if (navEntry) sendMetric('TTFB', navEntry.responseStart);
  }, { once: true });

  function flushFinalMetrics() {
    if (lcp) sendMetric('LCP', lcp);
    sendMetric('CLS', cls);
    if (inp) sendMetric('INP', inp);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushFinalMetrics();
  });
  window.addEventListener('pagehide', flushFinalMetrics);
})();

# Bite Sites Banner Component Handoff

Use this document to install the Bite Sites credit banner in another codebase. The component is plain HTML and CSS, with PNG logo assets. It does not require JavaScript for hover/focus expansion.

## Goal

Add a centered "Made by" Bite Sites banner that:

- Shows "Made by" plus the compact Bite Sites logo in its collapsed state.
- Expands on hover or keyboard focus.
- Swaps to the expanded Bite Sites logo in the expanded state.
- Supports light and dark theme logo variants.
- Uses a white button background in dark mode so the dark logo assets remain visible.
- Hides the "Made by" text on small screens.
- Respects `prefers-reduced-motion`.

## Files to Copy

Copy these files into the destination project:

```text
public/components/bitesites-banner.css
public/assets/img/bitesites/logo-2-light.png
public/assets/img/bitesites/logo-3-light.png
public/assets/img/bitesites/logo-8-dark.png
public/assets/img/bitesites/logo-9-dark.png
```

Recommended destination structure:

```text
public/
  components/
    bitesites-banner.css
  assets/
    img/
      bitesites/
        logo-2-light.png
        logo-3-light.png
        logo-8-dark.png
        logo-9-dark.png
```

If the destination project uses a different folder structure, update the `url(...)` paths in the CSS custom properties.

## Add the CSS

Add this stylesheet link to each page that renders the banner:

```html
<link rel="stylesheet" href="/components/bitesites-banner.css">
```

If the page is nested or served differently, adjust the `href` so it points to the copied CSS file.

## Add the HTML

Place this markup where the credit banner should appear:

```html
<div class="bitesites-credit">
  <a class="bitesites-banner" href="https://bitesites.org" target="_blank" rel="noopener" aria-label="Made by Bite Sites">
    <span class="bitesites-banner__eyebrow">Made by</span>
    <span class="bitesites-banner__mark" aria-hidden="true">
      <span class="bitesites-banner__logo bitesites-banner__logo--rest"></span>
      <span class="bitesites-banner__logo bitesites-banner__logo--hover"></span>
    </span>
  </a>
</div>
```

## Theme Options

The default banner uses the light-logo assets on a dark button.

To force the default style:

```html
<a class="bitesites-banner bitesites-banner--light" href="https://bitesites.org" target="_blank" rel="noopener" aria-label="Made by Bite Sites">
```

To use the dark theme logo assets, use `bitesites-banner--dark`. In this mode, the button background must be white so the dark Bite Sites logo assets are visible:

```html
<a class="bitesites-banner bitesites-banner--dark" href="https://bitesites.org" target="_blank" rel="noopener" aria-label="Made by Bite Sites">
```

The CSS also responds to parent theme attributes:

```html
<body data-theme="dark">
```

or:

```html
<body data-theme="light">
```

When `data-theme="dark"` is present on a parent element, the banner should switch to the dark logo assets and a white button background.

## Optional Bottom-of-Page Expanded State

If the destination project wants the banner to expand automatically near the bottom of the page, toggle this class on the link:

```html
is-at-page-bottom
```

Example:

```html
<a class="bitesites-banner is-at-page-bottom" href="https://bitesites.org" target="_blank" rel="noopener" aria-label="Made by Bite Sites">
```

This class uses the same styles as hover/focus.

## Full CSS

Save this as `public/components/bitesites-banner.css`:

```css
.bitesites-banner {
  --bitesites-logo-rest: url("../assets/img/bitesites/logo-2-light.png");
  --bitesites-logo-hover: url("../assets/img/bitesites/logo-3-light.png");
  --bitesites-bg: #050505;
  --bitesites-bg-hover: #000;
  --bitesites-border: rgba(255, 255, 255, .14);
  --bitesites-text: rgba(255, 255, 255, .72);
  --bitesites-text-hover: #fff;
  --bitesites-ring: rgba(255, 255, 255, .32);
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 178px;
  height: 64px;
  padding: 5px 15px;
  overflow: hidden;
  color: var(--bitesites-text);
  font: 600 12px/1 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: .08em;
  text-decoration: none;
  text-transform: uppercase;
  background: var(--bitesites-bg);
  border: 1px solid var(--bitesites-border);
  border-radius: 999px;
  isolation: isolate;
  transition: width .45s cubic-bezier(.22, 1, .36, 1), height .45s cubic-bezier(.22, 1, .36, 1), padding .45s cubic-bezier(.22, 1, .36, 1), border-radius .45s cubic-bezier(.22, 1, .36, 1), gap .35s cubic-bezier(.22, 1, .36, 1), background .3s ease, border-color .3s ease, transform .3s ease, box-shadow .3s ease;
}

.bitesites-banner::after {
  content: "";
  position: absolute;
  inset: -60% -35%;
  z-index: -1;
  background: linear-gradient(115deg, transparent 34%, rgba(255, 255, 255, .28) 45%, rgba(255, 255, 255, .52) 50%, rgba(255, 255, 255, .22) 56%, transparent 68%);
  opacity: 0;
  transform: translateX(-65%) rotate(8deg);
  transition: opacity .2s ease;
}

.bitesites-banner:hover,
.bitesites-banner:focus-visible,
.bitesites-banner.is-at-page-bottom {
  justify-content: center;
  gap: 0;
  width: 228px;
  height: 78px;
  padding: 6px 22px;
  color: var(--bitesites-text-hover);
  background: var(--bitesites-bg-hover);
  border-color: var(--bitesites-ring);
  border-radius: 28px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, .18);
  transform: translateY(-2px);
}

.bitesites-banner:hover::after,
.bitesites-banner:focus-visible::after,
.bitesites-banner.is-at-page-bottom::after {
  opacity: 1;
  animation: bitesites-shimmer .9s cubic-bezier(.22, 1, .36, 1);
}

.bitesites-banner:focus-visible {
  outline: 2px solid var(--bitesites-ring);
  outline-offset: 3px;
}

.bitesites-banner__eyebrow {
  flex: 0 0 auto;
  max-width: 76px;
  white-space: nowrap;
  transition: opacity .28s ease, transform .35s cubic-bezier(.22, 1, .36, 1), max-width .35s cubic-bezier(.22, 1, .36, 1);
}

.bitesites-banner:hover .bitesites-banner__eyebrow,
.bitesites-banner:focus-visible .bitesites-banner__eyebrow,
.bitesites-banner.is-at-page-bottom .bitesites-banner__eyebrow {
  max-width: 0;
  opacity: 0;
  transform: translateX(-14px);
}

.bitesites-banner__mark {
  position: relative;
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  transition: flex-basis .45s cubic-bezier(.22, 1, .36, 1), width .45s cubic-bezier(.22, 1, .36, 1), height .45s cubic-bezier(.22, 1, .36, 1), transform .45s cubic-bezier(.22, 1, .36, 1);
}

.bitesites-banner:hover .bitesites-banner__mark,
.bitesites-banner:focus-visible .bitesites-banner__mark,
.bitesites-banner.is-at-page-bottom .bitesites-banner__mark {
  flex-basis: 78px;
  width: 78px;
  height: 78px;
  transform: none;
}

.bitesites-banner__logo {
  position: absolute;
  inset: 0;
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;
  transition: opacity .38s ease, transform .45s cubic-bezier(.22, 1, .36, 1), filter .3s ease;
}

.bitesites-banner__logo--rest {
  background-image: var(--bitesites-logo-rest);
  opacity: .9;
}

.bitesites-banner__logo--hover {
  background-image: var(--bitesites-logo-hover);
  opacity: 0;
  transform: scale(.9);
}

.bitesites-banner:hover .bitesites-banner__logo--rest,
.bitesites-banner:focus-visible .bitesites-banner__logo--rest,
.bitesites-banner.is-at-page-bottom .bitesites-banner__logo--rest {
  opacity: 0;
  transform: scale(.86);
}

.bitesites-banner:hover .bitesites-banner__logo--hover,
.bitesites-banner:focus-visible .bitesites-banner__logo--hover,
.bitesites-banner.is-at-page-bottom .bitesites-banner__logo--hover {
  opacity: 1;
  transform: scale(1.14) translateX(0);
  filter: drop-shadow(0 0 12px rgba(255, 255, 255, .18));
}

.bitesites-credit {
  display: flex;
  justify-content: center;
  margin-top: 26px;
}

.bitesites-banner--light,
[data-theme="light"] .bitesites-banner {
  --bitesites-logo-rest: url("../assets/img/bitesites/logo-2-light.png");
  --bitesites-logo-hover: url("../assets/img/bitesites/logo-3-light.png");
  --bitesites-bg: #050505;
  --bitesites-bg-hover: #000;
  --bitesites-border: rgba(255, 255, 255, .14);
  --bitesites-text: rgba(255, 255, 255, .72);
  --bitesites-text-hover: #fff;
  --bitesites-ring: rgba(255, 255, 255, .32);
}

.bitesites-banner--dark,
[data-theme="dark"] .bitesites-banner {
  --bitesites-logo-rest: url("../assets/img/bitesites/logo-8-dark.png");
  --bitesites-logo-hover: url("../assets/img/bitesites/logo-9-dark.png");
  --bitesites-bg: #fff;
  --bitesites-bg-hover: #fff;
  --bitesites-border: rgba(0, 0, 0, .14);
  --bitesites-text: rgba(0, 0, 0, .72);
  --bitesites-text-hover: #000;
  --bitesites-ring: rgba(0, 0, 0, .28);
}

@media (max-width: 520px) {
  .bitesites-credit {
    justify-content: center;
  }

  .bitesites-banner {
    justify-content: center;
    gap: 0;
    width: min(96px, 100%);
    height: 64px;
    padding: 5px 15px;
  }

  .bitesites-banner:hover,
  .bitesites-banner:focus-visible,
  .bitesites-banner.is-at-page-bottom {
    width: min(124px, 100%);
    height: 78px;
    padding: 6px 20px;
  }

  .bitesites-banner .bitesites-banner__eyebrow {
    max-width: 0;
    opacity: 0;
  }

  .bitesites-banner .bitesites-banner__mark,
  .bitesites-banner:hover .bitesites-banner__mark,
  .bitesites-banner:focus-visible .bitesites-banner__mark,
  .bitesites-banner.is-at-page-bottom .bitesites-banner__mark {
    flex-basis: 78px;
    width: 78px;
    height: 78px;
  }

  .bitesites-banner.is-at-page-bottom .bitesites-banner__logo--rest {
    opacity: 0;
    transform: scale(.86);
  }

  .bitesites-banner.is-at-page-bottom .bitesites-banner__logo--hover {
    opacity: 1;
    transform: scale(1.14) translateX(0);
    filter: drop-shadow(0 0 12px rgba(255, 255, 255, .18));
  }
}

@media (prefers-reduced-motion: reduce) {
  .bitesites-banner,
  .bitesites-banner::after,
  .bitesites-banner__eyebrow,
  .bitesites-banner__mark,
  .bitesites-banner__logo {
    transition: none;
  }

  .bitesites-banner:hover::after,
  .bitesites-banner:focus-visible::after {
    animation: none;
  }
}

@keyframes bitesites-shimmer {
  from {
    transform: translateX(-65%) rotate(8deg);
  }

  to {
    transform: translateX(65%) rotate(8deg);
  }
}
```

## Verification Checklist

After installation, verify:

- The collapsed banner centers the "Made by" text and logo within the button.
- Hovering with a mouse expands the button and shows the larger Bite Sites logo.
- Tabbing to the link with a keyboard triggers the same expanded state.
- The four PNG assets load without 404s.
- In dark mode, the button background is white and the dark logo assets are visible.
- On screens under `520px`, the text is hidden and the logo remains centered.
- If the CSS file or asset folder moved, all `url(...)` paths were updated.

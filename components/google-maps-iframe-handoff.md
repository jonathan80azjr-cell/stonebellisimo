# Exportable Google Maps Iframe Component

This guide explains how to recreate the exportable Google Maps iframe component in another React codebase and customize it for different brand colorways.

## Component Goals

- Use a plain Google Maps iframe embed, so no Maps JavaScript API key is required.
- Keep the map reusable by passing location, logo, URLs, labels, and colorway values as props.
- Style the iframe with CSS custom properties so each brand can change the marker, banner, and map filter without editing component logic.
- Keep the marker accessible as a real link to Google Maps.

## Files To Copy

```text
src/GoogleMapsIframe.jsx
src/googleMapsIframeColorways.js
public/components/google-maps-iframe.css
```

Import `google-maps-iframe.css` from the destination app stylesheet or link it from the page that renders the component.

## URL Setup

```js
const storeName = 'Brand Name'
const storeAddress = '123 Main St, Newark, NJ 07102'
const encodedMapQuery = encodeURIComponent(`${storeName}, ${storeAddress}`)

export const googleMapEmbedUrl = `https://www.google.com/maps?q=${encodedMapQuery}&output=embed`
export const googleMapsPlaceUrl = `https://www.google.com/maps/search/?api=1&query=${encodedMapQuery}`
```

## Basic Usage

```jsx
import GoogleMapsIframe from './GoogleMapsIframe'
import { stockRoomMapColorway } from './googleMapsIframeColorways'

function LocationPanel() {
  return (
    <div className="map-panel">
      <GoogleMapsIframe
        address="123 Main St, Newark, NJ 07102"
        colorway={stockRoomMapColorway}
        embedUrl={googleMapEmbedUrl}
        logoAlt="Brand Name logo"
        logoSrc="/logo.png"
        placeUrl={googleMapsPlaceUrl}
        storeName="Brand Name"
        title="Google Map for Brand Name"
      />
    </div>
  )
}
```

## Required Container CSS

The parent container controls the map size. Use a stable height or aspect ratio.

```css
.map-panel {
  position: relative;
  min-height: 460px;
  overflow: hidden;
  border: 1px solid #d0d5dd;
  border-radius: 4px;
  background: #ffffff;
}
```

## Colorway Props

| Key | Controls |
| --- | --- |
| `accent` | Marker ring color |
| `accentStrong` | Marker ring hover color |
| `bannerBackground` | Address banner background |
| `bannerBorder` | Address banner border |
| `bannerText` | Store name text |
| `bannerMuted` | Address text |
| `markerBackground` | Marker badge background |
| `markerHalo` | Animated marker pulse |
| `markerShadow` | Marker shadow |
| `markerShadowHover` | Marker hover shadow |
| `filter` | CSS filter applied to the iframe |

## Example Brand Colorways

The helper exports these ready-to-use colorways:

```js
import {
  luxuryBlackGoldMap,
  streetwearRedMap,
  wellnessGreenMap,
} from './googleMapsIframeColorways'
```

## Notes For Other Codebases

- If the site has a Content Security Policy, allow frames from `https://www.google.com` and `https://www.google.com/maps/`.
- The centered marker is a branded overlay, not a Google Maps pin. It should link to the real Google Maps place URL.
- Keep `loading="lazy"` and `referrerPolicy="no-referrer-when-downgrade"` on the iframe.
- Use `showBanner={false}` or `showMarker={false}` when a layout needs only the iframe.

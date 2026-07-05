export const stockRoomMapColorway = {
  accent: '#b39158',
  accentStrong: '#8f6b35',
  bannerBackground: 'rgba(255, 255, 255, 0.94)',
  bannerBorder: 'rgba(179, 145, 88, 0.28)',
  bannerText: '#17130d',
  bannerMuted: '#655f55',
  markerBackground: '#ffffff',
  markerHalo: 'rgba(179, 145, 88, 0.2)',
  markerShadow: 'rgba(70, 48, 20, 0.22)',
  markerShadowHover: 'rgba(70, 48, 20, 0.34)',
  filter: 'grayscale(0.65) sepia(0.16) saturate(0.92) brightness(1.02) contrast(0.96)',
}

export const luxuryBlackGoldMap = {
  accent: '#b68a35',
  accentStrong: '#8f681e',
  bannerBackground: 'rgba(15, 15, 16, 0.92)',
  bannerBorder: 'rgba(255, 255, 255, 0.18)',
  bannerText: '#f4d58d',
  bannerMuted: '#f2f0e8',
  markerBackground: '#111111',
  markerHalo: 'rgba(182, 138, 53, 0.22)',
  markerShadow: 'rgba(182, 138, 53, 0.36)',
  markerShadowHover: 'rgba(182, 138, 53, 0.5)',
  filter: 'grayscale(1) sepia(0.25) saturate(0.9) brightness(0.85) contrast(1.15)',
}

export const wellnessGreenMap = {
  accent: '#2f855a',
  accentStrong: '#276749',
  bannerBackground: 'rgba(255, 255, 255, 0.95)',
  bannerBorder: 'rgba(47, 133, 90, 0.22)',
  bannerText: '#22543d',
  bannerMuted: '#4a5568',
  markerBackground: '#f7fff9',
  markerHalo: 'rgba(47, 133, 90, 0.2)',
  markerShadow: 'rgba(47, 133, 90, 0.3)',
  markerShadowHover: 'rgba(47, 133, 90, 0.42)',
  filter: 'grayscale(0.75) sepia(0.18) saturate(1.2) hue-rotate(75deg) brightness(1) contrast(0.98)',
}

export const streetwearRedMap = {
  accent: '#e11d48',
  accentStrong: '#be123c',
  bannerBackground: 'rgba(20, 20, 20, 0.92)',
  bannerBorder: 'rgba(255, 255, 255, 0.16)',
  bannerText: '#ffffff',
  bannerMuted: '#fecdd3',
  markerBackground: '#ffffff',
  markerHalo: 'rgba(225, 29, 72, 0.24)',
  markerShadow: 'rgba(225, 29, 72, 0.38)',
  markerShadowHover: 'rgba(225, 29, 72, 0.5)',
  filter: 'grayscale(1) sepia(0.22) saturate(1.7) hue-rotate(305deg) brightness(0.9) contrast(1.08)',
}

export function mapColorwayToCssVars(colorway = stockRoomMapColorway) {
  const mapColorway = { ...stockRoomMapColorway, ...colorway }

  return {
    '--map-accent': mapColorway.accent,
    '--map-accent-strong': mapColorway.accentStrong,
    '--map-banner-background': mapColorway.bannerBackground,
    '--map-banner-border': mapColorway.bannerBorder,
    '--map-banner-text': mapColorway.bannerText,
    '--map-banner-muted': mapColorway.bannerMuted,
    '--map-marker-background': mapColorway.markerBackground,
    '--map-marker-halo': mapColorway.markerHalo,
    '--map-marker-shadow': mapColorway.markerShadow,
    '--map-marker-shadow-hover': mapColorway.markerShadowHover,
    '--map-filter': mapColorway.filter,
  }
}

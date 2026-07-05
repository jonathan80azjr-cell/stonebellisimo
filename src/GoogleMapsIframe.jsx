import { mapColorwayToCssVars, stockRoomMapColorway } from './googleMapsIframeColorways'

function getInitials(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || 'MAP'
}

export default function GoogleMapsIframe({
  address,
  className = '',
  colorway = stockRoomMapColorway,
  embedUrl,
  logoAlt = '',
  logoSrc,
  placeUrl,
  showBanner = true,
  showMarker = true,
  storeName,
  title,
}) {
  const mapTitle = title || `Google Map for ${storeName}`
  const mapStyle = mapColorwayToCssVars(colorway)
  const wrapperClassName = ['google-maps-iframe', className].filter(Boolean).join(' ')

  return (
    <div className={wrapperClassName} style={mapStyle}>
      <iframe
        src={embedUrl}
        title={mapTitle}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />

      {showMarker ? (
        <a
          className="google-maps-iframe__marker"
          href={placeUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${storeName} in Google Maps`}
        >
          {logoSrc ? (
            <img src={logoSrc} alt={logoAlt} />
          ) : (
            <span aria-hidden="true">{getInitials(storeName)}</span>
          )}
        </a>
      ) : null}

      {showBanner ? (
        <a
          className="google-maps-iframe__banner"
          href={placeUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <strong>{storeName}</strong>
          <span>{address}</span>
        </a>
      ) : null}
    </div>
  )
}

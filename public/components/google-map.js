const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#f2efe8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4a4134' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#fbfaf6' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#8f6b35' }] },
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e4dccd' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#776d5f' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d6d0c1' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#6f675c' }] },
]

const DEFAULT_STORE = {
  name: 'Stone Bellisimo LLC',
  address: '618 23rd Street, Union City, NJ 07087',
  lat: 40.7677443,
  lng: -74.0342948,
  logoAlt: 'Stone Bellisimo LLC logo',
  placeId: 'ChIJVbaFyYZXwokRgfG3kFqd5MY',
}

let googleMapsPromise
let browserKeyPromise

function getMetaContent(name) {
  return document.querySelector(`meta[name="${name}"]`)?.content?.trim() || ''
}

function urlsForLocation(config) {
  const query = encodeURIComponent(`${config.storeName}, ${config.address}`)
  const lat = Number(config.lat || DEFAULT_STORE.lat)
  const lng = Number(config.lng || DEFAULT_STORE.lng)
  const placeId = encodeURIComponent(config.placeId || '')
  const placeIdQuery = placeId ? `&query_place_id=${placeId}` : ''

  return {
    embedUrl: `https://www.google.com/maps?ll=${lat},${lng}&z=17&output=embed`,
    placeUrl: `https://www.google.com/maps/search/?api=1&query=${query}${placeIdQuery}`,
  }
}

function setLoading(root, isLoading) {
  root.classList.toggle('google-map--loading', isLoading)
}

function createStoreBanner(config) {
  const banner = document.createElement('div')
  banner.className = 'google-maps-iframe__banner map-store-banner'
  banner.setAttribute('aria-label', `${config.storeName} address: ${config.address}`)

  const name = document.createElement('strong')
  name.textContent = config.storeName
  const address = document.createElement('span')
  address.textContent = config.address

  banner.append(name, address)
  return banner
}

function createMarkerContent(config, className) {
  const marker = document.createElement('span')
  marker.className = className

  const logo = document.createElement('img')
  logo.src = config.logoSrc
  logo.alt = config.logoAlt
  logo.loading = 'lazy'
  logo.decoding = 'async'

  marker.append(logo)
  return marker
}

function renderIframeFallback(root, config) {
  const frame = document.createElement('iframe')
  frame.src = config.embedUrl
  frame.title = config.title
  frame.loading = 'lazy'
  frame.referrerPolicy = 'no-referrer-when-downgrade'
  frame.allowFullscreen = true
  frame.tabIndex = -1

  const marker = document.createElement('a')
  marker.className = 'google-maps-iframe__marker'
  marker.href = config.placeUrl
  marker.target = '_blank'
  marker.rel = 'noopener'
  marker.setAttribute('aria-label', `Open ${config.storeName} in Google Maps`)
  marker.append(createMarkerContent(config, ''))

  const wrapper = document.createElement('div')
  wrapper.className = 'google-maps-iframe google-map__fallback'
  wrapper.append(frame, marker, createStoreBanner(config))

  root.replaceChildren(wrapper)
  root.dataset.mapMode = 'iframe'
  setLoading(root, false)
}

function loadBrowserKeyFromEndpoint(endpoint) {
  if (!endpoint) return Promise.resolve('')
  if (!browserKeyPromise) {
    browserKeyPromise = fetch(endpoint, { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => body?.apiKey || '')
      .catch(() => '')
  }

  return browserKeyPromise
}

async function resolveApiKey(root) {
  const inlineKey = root.dataset.apiKey?.trim()
    || getMetaContent('google-maps-api-key')
    || window.STONEBELLISIMO_GOOGLE_MAPS_API_KEY
    || ''

  if (inlineKey) return inlineKey

  const endpoint = root.dataset.apiKeyEndpoint || getMetaContent('google-maps-api-key-endpoint')
  return loadBrowserKeyFromEndpoint(endpoint)
}

function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.Map && window.google?.maps?.OverlayView) {
    return Promise.resolve()
  }

  if (!googleMapsPromise) {
    googleMapsPromise = new Promise((resolve, reject) => {
      const callbackName = `initStoneBellisimoMap_${Date.now()}`
      const script = document.createElement('script')

      window.gm_authFailure = () => reject(new Error('Google Maps authentication failed.'))
      window[callbackName] = () => {
        delete window[callbackName]
        resolve()
      }

      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${callbackName}&v=weekly`
      script.async = true
      script.defer = true
      script.onerror = () => reject(new Error('Google Maps script failed to load.'))
      document.head.append(script)
    })
  }

  return googleMapsPromise
}

function renderApiMap(root, config) {
  const wrapper = document.createElement('div')
  wrapper.className = 'google-maps-iframe google-map__api'

  const canvas = document.createElement('div')
  canvas.className = 'google-map__canvas'
  wrapper.append(canvas, createStoreBanner(config))

  root.replaceChildren(wrapper)

  const position = { lat: config.lat, lng: config.lng }
  const map = new google.maps.Map(canvas, {
    center: position,
    zoom: 17,
    styles: MAP_STYLES,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'cooperative',
  })

  class HTMLMarker extends google.maps.OverlayView {
    constructor(markerPosition) {
      super()
      this.markerPosition = markerPosition
      this.div = null
    }

    onAdd() {
      const marker = document.createElement('div')
      marker.className = 'google-maps-iframe__marker google-maps-iframe__marker--js'
      marker.tabIndex = 0
      marker.setAttribute('role', 'link')
      marker.setAttribute('aria-label', `Open ${config.storeName} in Google Maps`)
      marker.append(createMarkerContent(config, ''))

      const openMap = (event) => {
        event.preventDefault()
        event.stopPropagation()
        window.open(config.placeUrl, '_blank', 'noopener,noreferrer')
      }

      marker.addEventListener('click', openMap)
      marker.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') openMap(event)
      })

      this.div = marker
      this.getPanes().overlayMouseTarget.appendChild(marker)
    }

    draw() {
      const point = this.getProjection().fromLatLngToDivPixel(this.markerPosition)
      if (!this.div || !point) return
      this.div.style.left = `${point.x}px`
      this.div.style.top = `${point.y}px`
    }

    onRemove() {
      this.div?.remove()
      this.div = null
    }
  }

  new HTMLMarker(new google.maps.LatLng(config.lat, config.lng)).setMap(map)
  root.dataset.mapMode = 'api'
  setLoading(root, false)
}

function configFromRoot(root) {
  const storeName = root.dataset.storeName || DEFAULT_STORE.name
  const address = root.dataset.address || DEFAULT_STORE.address
  const config = {
    storeName,
    address,
    lat: Number(root.dataset.lat || DEFAULT_STORE.lat),
    lng: Number(root.dataset.lng || DEFAULT_STORE.lng),
    logoSrc: root.dataset.logoSrc || '/assets/img/logo-280.png',
    logoAlt: root.dataset.logoAlt || DEFAULT_STORE.logoAlt,
    placeId: root.dataset.placeId || DEFAULT_STORE.placeId,
  }
  const urls = urlsForLocation(config)

  return {
    ...config,
    ...urls,
    title: root.dataset.title || `Google Map for ${storeName}`,
  }
}

async function initMap(root) {
  const config = configFromRoot(root)
  setLoading(root, true)

  try {
    const apiKey = await resolveApiKey(root)
    if (!apiKey) throw new Error('Missing Google Maps browser API key.')
    await loadGoogleMaps(apiKey)
    renderApiMap(root, config)
  } catch (error) {
    console.info('Using Google Maps iframe fallback.', error?.message || error)
    renderIframeFallback(root, config)
  }
}

document.querySelectorAll('[data-google-map]').forEach(initMap)

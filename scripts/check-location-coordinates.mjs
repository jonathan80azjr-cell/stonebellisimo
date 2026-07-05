import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const OFFICIAL_LOCATION = {
  address: '618 23rd Street, Union City, NJ 07087',
  lat: 40.7677443,
  lng: -74.0342948,
}

const coordinateFiles = [
  'public/components/google-map.js',
  'public/index.html',
  'public/contact-us/index.html',
]

function fail(message) {
  console.error(`Location coordinate check failed: ${message}`)
  process.exitCode = 1
}

for (const relativePath of coordinateFiles) {
  const absolutePath = path.join(repoRoot, relativePath)
  const content = await readFile(absolutePath, 'utf8')
  const hasLat = content.includes(String(OFFICIAL_LOCATION.lat))
  const hasLng = content.includes(String(OFFICIAL_LOCATION.lng))
  const hasAddress = content.includes(OFFICIAL_LOCATION.address)

  if (!hasAddress) {
    fail(`${relativePath} is missing ${OFFICIAL_LOCATION.address}`)
  }

  if (!hasLat || !hasLng) {
    fail(`${relativePath} must use ${OFFICIAL_LOCATION.lat}, ${OFFICIAL_LOCATION.lng}`)
  }
}

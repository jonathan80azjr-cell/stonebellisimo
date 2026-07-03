const DEFAULT_PLACE_ID = 'ChIJVbaFyYZXwokRgfG3kFqd5MY';
const DEFAULT_REVIEW_LIMIT = 5;
const DEFAULT_CACHE_SECONDS = 15 * 60;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8'
};

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin'
};

function getEnv(env, name, fallback = '') {
  const value = env?.[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function parsePositiveInteger(value, fallback, min = 1, max = 60 * 60 * 24) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

function cleanText(value, maxLength = 1000) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeReview(review) {
  const text = cleanText(review?.text);
  const authorName = cleanText(review?.author_name, 120) || 'Google reviewer';
  const publishedAt = Number.isFinite(Number(review?.time))
    ? new Date(Number(review.time) * 1000).toISOString()
    : '';

  return {
    authorName,
    authorInitial: authorName.charAt(0).toUpperCase() || 'G',
    authorUrl: cleanText(review?.author_url, 500),
    profilePhotoUrl: cleanText(review?.profile_photo_url, 500),
    rating: Number(review?.rating) || 0,
    text,
    relativeTime: cleanText(review?.relative_time_description, 80),
    publishedAt
  };
}

function normalizePlace(result = {}, limit = DEFAULT_REVIEW_LIMIT) {
  const reviews = Array.isArray(result.reviews) ? result.reviews : [];
  const fiveStarReviews = reviews
    .map(normalizeReview)
    .filter(review => review.rating === 5 && review.text)
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, limit);

  return {
    source: 'google',
    placeName: cleanText(result.name, 160) || 'Stone Bellisimo LLC',
    rating: Number(result.rating) || null,
    userRatingsTotal: Number(result.user_ratings_total) || null,
    googleMapsUrl: cleanText(result.url, 500),
    sort: 'newest',
    filter: '5-star',
    maxOfficialReviews: 5,
    reviews: fiveStarReviews,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchGoogleReviews(env) {
  const apiKey = getEnv(env, 'GOOGLE_MAPS_API_KEY') || getEnv(env, 'GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    return {
      configured: false,
      place: normalizePlace()
    };
  }

  const placeId = getEnv(env, 'GOOGLE_PLACE_ID', DEFAULT_PLACE_ID);
  const limit = parsePositiveInteger(getEnv(env, 'GOOGLE_REVIEWS_LIMIT'), DEFAULT_REVIEW_LIMIT, 1, 5);
  const endpoint = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  endpoint.searchParams.set('place_id', placeId);
  endpoint.searchParams.set('fields', 'name,rating,user_ratings_total,reviews,url');
  endpoint.searchParams.set('reviews_sort', 'newest');
  endpoint.searchParams.set('key', apiKey);

  const response = await fetch(endpoint.toString(), {
    headers: {
      'accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Google Places request failed with ${response.status}`);
  }

  const body = await response.json();
  if (body.status !== 'OK') {
    throw new Error(`Google Places returned ${body.status || 'UNKNOWN_STATUS'}`);
  }

  return {
    configured: true,
    place: normalizePlace(body.result || {}, limit)
  };
}

export async function handleGoogleReviewsRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...SECURITY_HEADERS,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type'
      }
    });
  }

  if (request.method !== 'GET') {
    return json({ success: false, message: 'Method not allowed.' }, 405, { allow: 'GET, OPTIONS' });
  }

  const cacheSeconds = parsePositiveInteger(
    getEnv(env, 'GOOGLE_REVIEWS_CACHE_SECONDS'),
    DEFAULT_CACHE_SECONDS,
    60,
    60 * 60 * 24
  );

  try {
    const result = await fetchGoogleReviews(env);
    return json(
      {
        success: true,
        configured: result.configured,
        ...result.place
      },
      200,
      {
        'cache-control': result.configured
          ? `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`
          : 'no-store'
      }
    );
  } catch (error) {
    console.error('Failed to fetch Google reviews:', error);
    return json(
      {
        success: false,
        message: 'Google reviews are temporarily unavailable.'
      },
      502,
      { 'cache-control': 'no-store' }
    );
  }
}

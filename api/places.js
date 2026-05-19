// /api/places.js — Vercel Serverless Function
// Proxy Google Places API (New) — v101
//
// Variables d'environnement Vercel :
//   GOOGLE_PLACES_API_KEY  → clé Google Cloud avec Places API (New) activée
//   ALBERTO_SECRET         → (optionnel) secret partagé
//
// Endpoints :
//   ?op=nearby      → commerces dans un rayon (lat, lng, radius)
//   ?op=textsearch  → recherche textuelle ("pizzeria proche", "bar sympa") biaisée par GPS
//   ?op=photo       → URL de photo (photoRef)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-alberto-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const requiredSecret = process.env.ALBERTO_SECRET;
  if (requiredSecret) {
    const providedSecret = req.headers['x-alberto-secret'];
    if (providedSecret !== requiredSecret) return res.status(401).json({ error: 'Unauthorized' });
  }

  const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY missing' });

  const op = req.query.op || 'nearby';

  try {
    // ============ NEARBY SEARCH ============
    if (op === 'nearby') {
      const { lat, lng, radius = 30 } = req.query;
      if (!lat || !lng) return res.status(400).json({ error: 'Missing lat or lng' });

      const url = 'https://places.googleapis.com/v1/places:searchNearby';
      const body = {
        includedTypes: [
          'restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway',
          'store', 'clothing_store', 'grocery_store', 'supermarket',
          'tourist_attraction', 'museum', 'art_gallery', 'church',
          'park', 'hotel', 'lodging', 'pharmacy', 'book_store',
          'shopping_mall', 'department_store'
        ],
        maxResultCount: 15,
        locationRestriction: {
          circle: {
            center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
            radius: Math.min(parseFloat(radius), 100)
          }
        },
        languageCode: 'fr'
      };

      const apiResp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.shortFormattedAddress,places.photos'
        },
        body: JSON.stringify(body)
      });

      const data = await apiResp.json();
      if (!apiResp.ok) {
        console.error('Google Places (nearby) error:', apiResp.status, data);
        return res.status(apiResp.status).json({ error: data?.error?.message || 'Places API error', details: data });
      }

      const places = (data.places || []).map(p => ({
        id: p.id,
        name: p.displayName?.text || '',
        type: p.primaryTypeDisplayName?.text || p.primaryType || '',
        types: p.types || [],
        address: p.shortFormattedAddress || p.formattedAddress || '',
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        rating: p.rating || null,
        ratingCount: p.userRatingCount || 0,
        photoRef: p.photos && p.photos[0] ? p.photos[0].name : null
      }));

      return res.status(200).json({ places });
    }

    // ============ TEXT SEARCH ============
    // Pour "trouve une pizzeria", "bar à cocktails sympa", etc.
    if (op === 'textsearch') {
      const { query, lat, lng, radius = 1000 } = req.query;
      if (!query) return res.status(400).json({ error: 'Missing query' });

      const url = 'https://places.googleapis.com/v1/places:searchText';
      const body = {
        textQuery: query,
        maxResultCount: 10,
        languageCode: 'fr',
        ...(lat && lng ? {
          locationBias: {
            circle: {
              center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
              radius: Math.min(parseFloat(radius), 5000)
            }
          }
        } : {})
      };

      const apiResp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.shortFormattedAddress,places.photos,places.currentOpeningHours,places.priceLevel,places.editorialSummary'
        },
        body: JSON.stringify(body)
      });

      const data = await apiResp.json();
      if (!apiResp.ok) {
        console.error('Google Places (textsearch) error:', apiResp.status, data);
        return res.status(apiResp.status).json({ error: data?.error?.message || 'Places API error', details: data });
      }

      const places = (data.places || []).map(p => ({
        id: p.id,
        name: p.displayName?.text || '',
        type: p.primaryTypeDisplayName?.text || p.primaryType || '',
        types: p.types || [],
        address: p.shortFormattedAddress || p.formattedAddress || '',
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        rating: p.rating || null,
        ratingCount: p.userRatingCount || 0,
        photoRef: p.photos && p.photos[0] ? p.photos[0].name : null,
        openNow: p.currentOpeningHours?.openNow ?? null,
        priceLevel: p.priceLevel || null,
        summary: p.editorialSummary?.text || null
      }));

      return res.status(200).json({ places });
    }

    // ============ PHOTO PROXY ============
    if (op === 'photo') {
      const { photoRef, maxSize = 400 } = req.query;
      if (!photoRef) return res.status(400).json({ error: 'Missing photoRef' });

      const url = `https://places.googleapis.com/v1/${photoRef}/media?key=${API_KEY}&maxWidthPx=${maxSize}&maxHeightPx=${maxSize}&skipHttpRedirect=true`;
      const photoResp = await fetch(url);

      if (!photoResp.ok) {
        const errData = await photoResp.json().catch(() => ({}));
        return res.status(photoResp.status).json({ error: 'Photo fetch error', details: errData });
      }

      const photoData = await photoResp.json();
      return res.status(200).json({ photoUri: photoData.photoUri });
    }

    return res.status(400).json({ error: 'Unknown op. Use op=nearby, op=textsearch or op=photo' });

  } catch (err) {
    console.error('Places proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

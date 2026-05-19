// /api/route.js — Vercel Serverless Function
// Proxy OpenRouteService pour calcul d'itinéraire piéton.
//
// Variables d'environnement Vercel :
//   OPENROUTE_API_KEY  → clé openrouteservice.org (gratuit, 2000 req/jour)
//   ALBERTO_SECRET     → (optionnel) secret partagé
//
// Usage :
//   GET /api/route?fromLat=...&fromLng=...&toLat=...&toLng=...&profile=foot-walking
//
// Réponse :
//   { distanceMeters, durationSeconds, geometry: [[lng,lat], [lng,lat], ...] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-alberto-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const requiredSecret = process.env.ALBERTO_SECRET;
  if (requiredSecret) {
    const providedSecret = req.headers['x-alberto-secret'];
    if (providedSecret !== requiredSecret) return res.status(401).json({ error: 'Unauthorized' });
  }

  const API_KEY = process.env.OPENROUTE_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'OPENROUTE_API_KEY missing' });

  const { fromLat, fromLng, toLat, toLng, profile = 'foot-walking' } = req.query;
  if (!fromLat || !fromLng || !toLat || !toLng) {
    return res.status(400).json({ error: 'Missing coordinates (fromLat, fromLng, toLat, toLng)' });
  }

  // Profiles supportés : foot-walking, foot-hiking, cycling-regular, driving-car
  const validProfiles = ['foot-walking', 'foot-hiking', 'cycling-regular', 'driving-car'];
  const safeProfile = validProfiles.includes(profile) ? profile : 'foot-walking';

  try {
    const url = `https://api.openrouteservice.org/v2/directions/${safeProfile}/geojson`;
    const body = {
      coordinates: [
        [parseFloat(fromLng), parseFloat(fromLat)],
        [parseFloat(toLng), parseFloat(toLat)]
      ],
      instructions: false, // pas besoin des instructions étape par étape (Google Maps fait ça)
      preference: 'recommended',
      units: 'm',
      language: 'fr'
    };

    const apiResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/geo+json'
      },
      body: JSON.stringify(body)
    });

    const data = await apiResp.json();
    if (!apiResp.ok) {
      console.error('OpenRouteService error:', apiResp.status, data);
      return res.status(apiResp.status).json({ error: data?.error?.message || 'Route API error', details: data });
    }

    const feature = data.features && data.features[0];
    if (!feature) return res.status(404).json({ error: 'No route found' });

    const summary = feature.properties?.summary || {};
    const geometry = feature.geometry?.coordinates || []; // [[lng,lat], ...]

    return res.status(200).json({
      distanceMeters: Math.round(summary.distance || 0),
      durationSeconds: Math.round(summary.duration || 0),
      geometry: geometry,
      profile: safeProfile
    });

  } catch (err) {
    console.error('Route proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

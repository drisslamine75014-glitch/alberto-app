// /api/wiki.js — Vercel Serverless Function
// Proxy Wikipedia geosearch — trouve les articles dans un rayon GPS.
// Gratuit, illimité, pas de clé.
//
// Usage :
//   GET /api/wiki?lat=...&lng=...&radius=1000&limit=10&lang=fr
//
// Réponse :
//   { articles: [{title, distance, lat, lng, pageId, extract, thumbnail, url}, ...] }

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

  const { lat, lng, radius = 1000, limit = 10, lang = 'fr' } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'Missing lat or lng' });

  const safeLang = ['fr', 'en', 'es', 'it', 'de', 'pt', 'el'].includes(lang) ? lang : 'fr';
  const safeRadius = Math.min(parseInt(radius), 10000);
  const safeLimit = Math.min(parseInt(limit), 50);

  try {
    // 1. Geosearch : articles dans le rayon
    const geoUrl = `https://${safeLang}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=${safeRadius}&gslimit=${safeLimit}&format=json&origin=*`;
    const geoResp = await fetch(geoUrl);
    if (!geoResp.ok) return res.status(geoResp.status).json({ error: 'Wikipedia geosearch error' });
    const geoData = await geoResp.json();
    const geoResults = geoData.query?.geosearch || [];

    if (geoResults.length === 0) {
      return res.status(200).json({ articles: [] });
    }

    // 2. Récupère extraits + thumbnails en batch
    const pageIds = geoResults.map(r => r.pageid).join('|');
    // V104 : extraits 4 phrases au lieu de 2 (plus de contexte pour Claude)
    const detailUrl = `https://${safeLang}.wikipedia.org/w/api.php?action=query&pageids=${pageIds}&prop=extracts|pageimages|info&exintro=1&explaintext=1&exsentences=4&piprop=thumbnail&pithumbsize=300&inprop=url&format=json&origin=*`;
    const detailResp = await fetch(detailUrl);
    const detailData = detailResp.ok ? await detailResp.json() : { query: { pages: {} } };
    const pages = detailData.query?.pages || {};

    const articles = geoResults.map(r => {
      const page = pages[r.pageid] || {};
      return {
        title: r.title,
        distance: r.dist,
        lat: r.lat,
        lng: r.lon,
        pageId: r.pageid,
        extract: page.extract || '',
        thumbnail: page.thumbnail?.source || null,
        url: page.fullurl || `https://${safeLang}.wikipedia.org/?curid=${r.pageid}`
      };
    });

    return res.status(200).json({ articles });

  } catch (err) {
    console.error('Wiki proxy error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

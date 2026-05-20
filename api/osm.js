// /api/osm.js — Vercel Serverless Function
// Proxy OpenStreetMap Overpass — récupère le patrimoine, monuments, sites historiques,
// transports publics, points de vue, équipements publics autour d'un point.
// Gratuit, illimité, pas de clé.
//
// Usage :
//   GET /api/osm?lat=...&lng=...&radius=200
//
// Réponse :
//   { features: [{name, type, category, distance, lat, lng, tags, ...}] }

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
];

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

  const { lat, lng, radius = 200 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'Missing lat or lng' });

  const safeRadius = Math.min(parseInt(radius), 1000);
  const lt = parseFloat(lat);
  const lg = parseFloat(lng);

  const query = `
    [out:json][timeout:15];
    (
      node(around:${safeRadius},${lt},${lg})["historic"];
      way(around:${safeRadius},${lt},${lg})["historic"];
      relation(around:${safeRadius},${lt},${lg})["historic"];
      node(around:${safeRadius},${lt},${lg})["tourism"~"attraction|museum|artwork|viewpoint|gallery|monument|theme_park|zoo|aquarium"];
      way(around:${safeRadius},${lt},${lg})["tourism"~"attraction|museum|artwork|viewpoint|gallery|monument|theme_park|zoo|aquarium"];
      node(around:${safeRadius},${lt},${lg})["railway"~"station|halt|tram_stop|subway_entrance"];
      node(around:${safeRadius},${lt},${lg})["station"];
      node(around:${safeRadius},${lt},${lg})["public_transport"="station"];
      way(around:${safeRadius},${lt},${lg})["public_transport"="station"];
      node(around:${safeRadius},${lt},${lg})["amenity"~"place_of_worship|fountain|townhall|library|university|college|school|theatre|cinema|arts_centre|community_centre|nightclub|conference_centre|exhibition_centre|courthouse|post_office|police|fire_station|hospital|clinic|marketplace|prison|bus_station|ferry_terminal"];
      way(around:${safeRadius},${lt},${lg})["amenity"~"place_of_worship|fountain|townhall|library|university|college|school|theatre|cinema|arts_centre|community_centre|nightclub|conference_centre|exhibition_centre|courthouse|post_office|police|fire_station|hospital|clinic|marketplace|prison|bus_station|ferry_terminal"];
      way(around:${safeRadius},${lt},${lg})["leisure"~"park|garden|nature_reserve|stadium|sports_centre|swimming_pool|playground|water_park|marina"];
      node(around:${safeRadius},${lt},${lg})["natural"~"peak|beach|spring|cave_entrance|tree|rock"];
      way(around:${safeRadius},${lt},${lg})["natural"~"beach|water|wood|coastline|cliff|wetland"];
      way(around:${safeRadius},${lt},${lg})["building"~"church|cathedral|chapel|castle|temple|mosque|synagogue|monastery|tower|public|cinema|theatre|university|hospital|train_station|stadium|government|civic|kindergarten|school|college"];
      way(around:${safeRadius},${lt},${lg})["man_made"~"tower|bridge|pier|lighthouse|water_tower|windmill|chimney|obelisk"];
      node(around:${safeRadius},${lt},${lg})["man_made"~"tower|lighthouse|obelisk|chimney|windmill"];
      node(around:${safeRadius},${lt},${lg})["bridge"="yes"];
      way(around:${safeRadius},${lt},${lg})["bridge"="yes"];
    );
    out center tags 80;
  `;

  let data = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      });
      if (resp.ok) {
        data = await resp.json();
        break;
      }
    } catch (err) {
      console.warn('OSM endpoint failed:', endpoint, err.message);
    }
  }

  if (!data) return res.status(503).json({ error: 'All Overpass endpoints failed' });

  const elements = data.elements || [];

  const distance = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng/2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
  };

  const categorize = (tags) => {
    if (tags.historic) {
      const h = tags.historic;
      if (['castle', 'fort', 'tower'].includes(h)) return 'castle';
      if (['memorial', 'monument', 'memorial_plaque'].includes(h)) return 'memorial';
      if (['ruins', 'archaeological_site', 'wayside_cross', 'wayside_shrine'].includes(h)) return 'historic';
      return 'historic';
    }
    if (tags.tourism === 'museum' || tags.tourism === 'gallery') return 'museum';
    if (tags.tourism === 'artwork') return 'artwork';
    if (tags.tourism === 'viewpoint') return 'viewpoint';
    if (tags.tourism === 'attraction') return 'attraction';
    if (tags.railway === 'station' || tags.station === 'subway' || tags.railway === 'tram_stop') return 'transport';
    if (tags.amenity === 'place_of_worship') return 'worship';
    if (tags.amenity === 'townhall') return 'public';
    if (tags.amenity === 'theatre' || tags.amenity === 'arts_centre') return 'culture';
    if (tags.amenity === 'library' || tags.amenity === 'university') return 'education';
    if (tags.amenity === 'fountain') return 'fountain';
    if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'nature_reserve') return 'park';
    if (tags.natural === 'beach') return 'beach';
    if (tags.natural === 'peak') return 'peak';
    if (tags.natural === 'water') return 'water';
    if (tags.building === 'church' || tags.building === 'cathedral' || tags.building === 'chapel') return 'worship';
    if (tags.building === 'castle') return 'castle';
    return 'other';
  };

  const labelize = (cat) => {
    const map = {
      castle: 'Château / fort',
      memorial: 'Monument commémoratif',
      historic: 'Site historique',
      museum: 'Musée',
      artwork: "Œuvre d'art (statue, fresque)",
      viewpoint: 'Point de vue',
      attraction: 'Attraction touristique',
      transport: 'Gare / station de transport',
      worship: 'Lieu de culte',
      public: 'Bâtiment public',
      culture: 'Lieu culturel',
      education: 'Lieu éducatif',
      fountain: 'Fontaine',
      park: 'Parc / jardin',
      beach: 'Plage',
      peak: 'Sommet',
      water: "Plan d'eau"
    };
    return map[cat] || 'Site';
  };

  const features = elements
    .map(el => {
      const tags = el.tags || {};
      const itemLat = el.lat || el.center?.lat;
      const itemLng = el.lon || el.center?.lon;
      if (!itemLat || !itemLng) return null;

      const cat = categorize(tags);
      const name = tags.name || tags['name:fr'] || tags.ref || null;
      if (!name && !['fountain', 'artwork', 'historic', 'memorial'].includes(cat)) return null;

      return {
        id: el.id,
        type: el.type,
        name: name,
        category: cat,
        categoryLabel: labelize(cat),
        distance: distance(lt, lg, itemLat, itemLng),
        lat: itemLat,
        lng: itemLng,
        wikipedia: tags.wikipedia || null,
        wikidata: tags.wikidata || null,
        description: tags.description || tags['description:fr'] || null,
        heritageLabel: tags.heritage || tags['ref:mhs'] || null,
        operator: tags.operator || null,
        startDate: tags.start_date || null,
        historicType: tags.historic || null,
        buildingType: tags.building || null
      };
    })
    .filter(f => f !== null)
    .sort((a, b) => a.distance - b.distance);

  return res.status(200).json({ features: features.slice(0, 30) });
}

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const LOCAL_LANDMARKS = [
  { name: 'Shillong Command HQ (Police Bazar)', lat: 25.5788, lng: 91.8933, nodeId: 'N1' },
  { name: 'Upper Shillong Depot', lat: 25.5450, lng: 91.8600, nodeId: 'N2' },
  { name: 'Mylliem Junction', lat: 25.5140, lng: 91.8540, nodeId: 'N3' },
  { name: 'Mawphlang Heritage Sacred Grove', lat: 25.4450, lng: 91.7580, nodeId: 'N4' },
  { name: 'Weiloi Gorge Crossing', lat: 25.3520, lng: 91.6850, nodeId: 'N5' },
  { name: 'Mawsynram Station', lat: 25.2970, lng: 91.5820, nodeId: 'N6' },
  { name: 'Cherrapunji (Sohra) Base', lat: 25.2815, lng: 91.7166, nodeId: 'N7' },
  { name: 'Laitlyngkot Ridge', lat: 25.4370, lng: 91.8340, nodeId: 'N8' },
  { name: 'Smit Relief Hub', lat: 25.5310, lng: 91.9280, nodeId: 'N9' },
  { name: 'Pynursla Pass', lat: 25.3050, lng: 91.8940, nodeId: 'N10' },
  { name: 'Pongtung Village', lat: 25.2500, lng: 91.9500, nodeId: 'N11' },
  { name: 'Dawki Border Post (Umngot River)', lat: 25.1850, lng: 92.0150, nodeId: 'N12' },
];

/**
 * GET /api/v1/geocode?q=...
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = (req.query.q as string || '').trim().toLowerCase();
    if (!q || q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const localMatches = LOCAL_LANDMARKS.filter((l) =>
      l.name.toLowerCase().includes(q)
    ).map((l) => ({
      place_id: `node-${l.nodeId}`,
      name: l.name,
      display_name: `${l.name}, Meghalaya, India`,
      lat: l.lat,
      lng: l.lng,
      node_id: l.nodeId,
      source: 'local_network',
    }));

    if (localMatches.length > 0) {
      res.json({ results: localMatches });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=in&viewbox=91.0,26.0,92.5,25.0&bounded=0&limit=5`;

      const osmRes = await fetch(url, {
        headers: { 'User-Agent': 'RoadSafe-AI-PublicDriverApp/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (osmRes.ok) {
        const osmData: any = await osmRes.json();
        const osmResults = osmData.map((item: any) => ({
          place_id: `osm-${item.place_id}`,
          name: item.display_name.split(',')[0],
          display_name: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          source: 'osm',
        }));
        res.json({ results: [...localMatches, ...osmResults] });
        return;
      }
    } catch {
      // ignore
    }

    res.json({ results: localMatches });
  } catch (err: any) {
    res.status(500).json({ error: 'GEOCODE_ERROR', message: err.message });
  }
});

/**
 * GET /api/v1/geocode/nearest-node?lat=&lng=
 */
router.get('/nearest-node', async (req: Request, res: Response): Promise<void> => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'lat and lng must be valid numbers.' });
      return;
    }

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, name, lat, lng, "elevationM", "isHub",
             round(ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::numeric, 1) as "distanceMeters"
      FROM "RoadNode"
      ORDER BY ST_SetSRID(ST_MakePoint(lng, lat), 4326) <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 1;
    `, lng, lat);

    if (rows && rows.length > 0) {
      res.json({
        node: rows[0],
        distanceMeters: Number(rows[0].distanceMeters),
      });
      return;
    }

    res.status(404).json({ error: 'NOT_FOUND', message: 'No road node found nearby.' });
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;

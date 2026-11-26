import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

const GEOCODE_USER_AGENT = process.env.GEOCODE_USER_AGENT || 'RoadSafe-AI-PublicDriverApp/2.0';

function classifyCoverageZone(lat: number, lng: number): 'local_hazard_aware' | 'regional_hazards' | 'global_ordinary' {
  if (lat >= 25.14 && lat <= 25.66 && lng >= 91.50 && lng <= 92.10) {
    return 'local_hazard_aware';
  }
  // Rajasthan, Uttarakhand, Himachal Pradesh
  if (
    (lat >= 23.0 && lat <= 30.2 && lng >= 69.5 && lng <= 78.3) ||
    (lat >= 28.7 && lat <= 33.3 && lng >= 75.5 && lng <= 81.1)
  ) {
    return 'regional_hazards';
  }
  return 'global_ordinary';
}

/**
 * GET /api/v1/geocode?q=...
 * Global place search via OpenStreetMap Nominatim + supplementary local RoadNode hubs.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = ((req.query.q as string) || '').trim();
    if (!q || q.length < 2) {
      res.json({ results: [], source: 'none' });
      return;
    }

    const dbPromise = prisma.roadNode
      .findMany({
        where: {
          isHub: true,
          name: { contains: q, mode: 'insensitive' },
        },
        take: 4,
      })
      .catch(() => []);

    let nominatimFailed = false;
    let nominatimError: string | undefined;

    const nominatimPromise = (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6`;

        const osmRes = await fetch(url, {
          headers: { 'User-Agent': GEOCODE_USER_AGENT },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!osmRes.ok) {
          nominatimFailed = true;
          nominatimError =
            osmRes.status === 429
              ? 'Geocoder rate limit reached. Please wait a moment and retry.'
              : `Geocoder returned HTTP ${osmRes.status}`;
          return [];
        }
        return ((await osmRes.json()) as any[]) || [];
      } catch (err: any) {
        nominatimFailed = true;
        nominatimError = err?.name === 'AbortError' ? 'Geocoder request timed out' : 'Geocoder unreachable';
        return [];
      }
    })();

    const [dbNodes, osmData] = await Promise.all([dbPromise, nominatimPromise]);

    const results: Array<{
      place_id: string;
      name: string;
      display_name: string;
      lat: number;
      lng: number;
      node_id?: string;
      in_coverage: boolean;
      coverage_zone: 'local_hazard_aware' | 'regional_hazards' | 'global_ordinary';
      source: string;
    }> = [];

    for (const item of osmData) {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      const zone = classifyCoverageZone(lat, lng);
      results.push({
        place_id: `osm-${item.place_id}`,
        name: String(item.display_name || '').split(',')[0] || q,
        display_name: item.display_name,
        lat,
        lng,
        in_coverage: zone === 'local_hazard_aware',
        coverage_zone: zone,
        source: 'osm_nominatim',
      });
    }

    for (const n of dbNodes) {
      const dup = results.some(
        (r) => Math.abs(r.lat - n.lat) < 0.003 && Math.abs(r.lng - n.lng) < 0.003
      );
      if (!dup) {
        const zone = classifyCoverageZone(n.lat, n.lng);
        results.unshift({
          place_id: `db-node-${n.id}`,
          name: n.name,
          display_name: `${n.name}, ${n.district}`,
          lat: n.lat,
          lng: n.lng,
          node_id: n.id,
          in_coverage: zone === 'local_hazard_aware',
          coverage_zone: zone,
          source: 'road_network_db',
        });
      }
    }

    res.json({
      results,
      degraded: nominatimFailed,
      ...(nominatimError ? { error: nominatimError } : {}),
    });
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

    const rows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT id, name, lat, lng, "elevationM", "isHub",
             round(ST_Distance(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::numeric, 1) as "distanceMeters"
      FROM "RoadNode"
      ORDER BY ST_SetSRID(ST_MakePoint(lng, lat), 4326) <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 1;
    `,
      lng,
      lat
    );

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

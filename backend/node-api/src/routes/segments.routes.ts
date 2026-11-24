import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { callPythonPassability } from '../integrations/pythonRouting';
import { getActiveHazards } from '../services/hazard.service';

const router = Router();
const prisma = new PrismaClient();

// GeoJSON endpoint for MapLibre / Leaflet rendering
router.get('/roads/geojson', async (req: Request, res: Response): Promise<void> => {
  try {
    const segments = await prisma.roadSegment.findMany({
      where: {
        roadClass: { in: ['trunk', 'primary', 'secondary'] },
      },
      take: 600,
    });
    const nodes = await prisma.roadNode.findMany({
      where: { isHub: true },
      take: 100,
    });
    const activeHazards = await getActiveHazards();

    const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const hazardsByEdge = new Map<string, any[]>();
    activeHazards.forEach((h) => {
      if (h.edgeId) {
        const arr = hazardsByEdge.get(h.edgeId) || [];
        arr.push(h);
        hazardsByEdge.set(h.edgeId, arr);
      }
    });

    const features = segments.map((seg) => {
      let coords: number[][] = [];
      try {
        coords = JSON.parse(seg.coordinatesJson);
      } catch {
        const u = nodeMap[seg.fromNodeId];
        const v = nodeMap[seg.toNodeId];
        if (u && v) coords = [[u.lng, u.lat], [v.lng, v.lat]];
      }

      const edgeHazards = hazardsByEdge.get(seg.id) || [];
      const hasConfirmedHazard = edgeHazards.some((h) => h.status === 'confirmed');
      const hasUnverifiedHazard = edgeHazards.some((h) => h.status === 'unverified');

      // Determine risk band
      let riskBand = 'Green';
      if (seg.status === 'closed' || seg.status === 'blocked' || hasConfirmedHazard) {
        riskBand = 'Red';
      } else if (seg.landslideRisk > 0.4 || seg.rainfallNorm > 0.5 || seg.status === 'caution' || hasUnverifiedHazard) {
        riskBand = 'Yellow';
      }

      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
        properties: {
          id: seg.id,
          name: seg.name,
          from_node: seg.fromNodeId,
          to_node: seg.toNodeId,
          from_node_name: nodeMap[seg.fromNodeId]?.name || seg.fromNodeId,
          to_node_name: nodeMap[seg.toNodeId]?.name || seg.toNodeId,
          distance_km: seg.distanceKm,
          travel_time_min: seg.baseTravelTimeMin,
          road_class: seg.roadClass,
          width_m: seg.widthM,
          max_weight_kg: seg.maxWeightKg,
          max_clearance_m: seg.maxClearanceM,
          is_bridge: seg.isBridge,
          status: seg.status,
          risk_band: riskBand,
          rainfall_norm: seg.rainfallNorm,
          slope_norm: seg.slopeNorm,
          landslide_risk: seg.landslideRisk,
          surface_damage: seg.surfaceDamage,
          waterlogging_norm: seg.waterloggingNorm,
          narrowness_norm: seg.narrownessNorm,
          active_hazards: edgeHazards.map((h) => ({
            id: h.id,
            type: h.type,
            severity: h.severity,
            status: h.status,
            confirmCount: h.confirmCount,
          })),
        },
      };
    });

    res.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

router.get('/nodes', async (req: Request, res: Response): Promise<void> => {
  try {
    const nodes = await prisma.roadNode.findMany({
      where: { isHub: true },
      take: 50,
      orderBy: { name: 'asc' },
    });
    res.json({ status: 'success', data: nodes });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

router.get('/:id/passability', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const vehicleProfileId = (req.query.vehicle as string) || 'car';

    const segment = await prisma.roadSegment.findUnique({ where: { id } });
    if (!segment) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Road segment not found.' });
      return;
    }

    const payload = {
      segment_id: segment.id,
      vehicle_profile_id: vehicleProfileId,
      features: {
        rainfall_current_mm: segment.rainfallNorm * 100.0,
        rainfall_24h_mm: segment.rainfallNorm * 150.0,
        slope_deg: segment.slopeNorm * 30.0,
        landslide_susceptibility: segment.landslideRisk,
        surface_damage: segment.surfaceDamage,
        waterlogging_depth_cm: segment.waterloggingNorm * 50.0,
        road_narrowness_m: segment.widthM,
      },
    };

    const passabilityResult = await callPythonPassability(payload);
    res.json({
      segment: {
        id: segment.id,
        name: segment.name,
        roadClass: segment.roadClass,
        distanceKm: segment.distanceKm,
        status: segment.status,
      },
      passability: passabilityResult,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

export default router;

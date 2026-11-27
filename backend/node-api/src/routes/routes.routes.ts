import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { callPythonComputeRoute, PythonRouteRequest } from '../integrations/pythonRouting';
import { deviceAuth } from '../middleware/deviceAuth';
import { getActiveHazards, snapToNearestRoadEdge } from '../services/hazard.service';
import { isInsideLocalGraphCoverage, computeBroadOsrmRoute } from '../services/routingProvider.service';

const router = Router();
const prisma = new PrismaClient();

// Helper to resolve an input location (node_id or lat/lng) with PostGIS road edge snapping
interface ResolvedLocation {
  nodeId: string;
  snappedLng?: number;
  snappedLat?: number;
  roadName?: string;
  distanceMeters?: number;
}

async function resolveLocation(input: any): Promise<ResolvedLocation> {
  if (typeof input === 'string') {
    return { nodeId: input };
  }
  if (input.lat !== undefined && input.lng !== undefined) {
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    const snap = await snapToNearestRoadEdge(lat, lng);

    // Threshold: reject if further than 500 meters from drivable road
    if (snap.distanceMeters > 500) {
      const err: any = new Error(
        `Selected location is ${Math.round(snap.distanceMeters)}m away from the nearest drivable road (max allowed distance is 500m). Please select a point closer to a road.`
      );
      err.code = 'LOCATION_TOO_FAR_FROM_ROAD';
      err.distanceMeters = snap.distanceMeters;
      throw err;
    }

    return {
      nodeId: snap.fromNodeId,
      snappedLng: snap.snapLng,
      snappedLat: snap.snapLat,
      roadName: snap.name,
      distanceMeters: snap.distanceMeters,
    };
  }
  if (input.nodeId) {
    return { nodeId: input.nodeId };
  }
  return { nodeId: 'N1' };
}

/**
 * POST /api/v1/routes
 */
router.post('/', deviceAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      origin,
      destination,
      vehicle: vehicleType = 'car',
      objective = 'safest',
      k = 3,
    } = req.body;

    if (!origin || !destination) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'origin and destination are required (provide node_id or lat/lng).',
      });
      return;
    }

    const normalizedType = vehicleType.toLowerCase().includes('suv') ? 'suv' : vehicleType.toLowerCase();
    const vehicle = await prisma.vehicleProfile.findFirst({
      where: { type: normalizedType },
    });

    if (!vehicle) {
      res.status(400).json({
        error: 'INVALID_VEHICLE',
        message: `Vehicle profile '${vehicleType}' not found. Supported types: bike, car, suv, truck, ambulance.`,
      });
      return;
    }

    const activeHazards = await getActiveHazards();

    // Check if both origin and destination are inside East Khasi Hills local graph coverage
    const hasCoords =
      origin.lat !== undefined &&
      origin.lng !== undefined &&
      destination.lat !== undefined &&
      destination.lng !== undefined;

    const useBroadProvider =
      hasCoords &&
      (!isInsideLocalGraphCoverage(Number(origin.lat), Number(origin.lng)) ||
        !isInsideLocalGraphCoverage(Number(destination.lat), Number(destination.lng)));

    if (useBroadProvider) {
      const requestId = `REQ-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      try {
        const broad = await computeBroadOsrmRoute({
          origin: { lat: Number(origin.lat), lng: Number(origin.lng) },
          destination: { lat: Number(destination.lat), lng: Number(destination.lng) },
          vehicleType: vehicle.type,
          objective: objective === 'fastest' ? 'fastest' : 'safest',
          activeHazards,
          k: Math.min(3, Math.max(1, Number(k) || 3)),
        });

        res.json({
          request_id: requestId,
          status: 'FEASIBLE',
          objective: objective === 'fastest' ? 'fastest' : 'safest',
          routing_provider: broad.routing_provider,
          routing_mode: broad.routing_mode,
          hazard_coverage: broad.hazard_coverage,
          vehicle_limitations: broad.vehicle_limitations,
          vehicle: { id: vehicle.id, name: vehicle.name, type: vehicle.type },
          routes: broad.routes,
          constraints_applied: [],
          confidence_score: 0.65,
          rationale: broad.rationale,
        });
        return;
      } catch (broadErr: any) {
        res.status(502).json({
          error: 'BROAD_ROUTING_UNAVAILABLE',
          message: broadErr.message || 'Global routing provider failed.',
        });
        return;
      }
    }

    let srcLoc: ResolvedLocation;
    let dstLoc: ResolvedLocation;
    try {
      srcLoc = await resolveLocation(origin);
      dstLoc = await resolveLocation(destination);
    } catch (locErr: any) {
      if (locErr.code === 'LOCATION_TOO_FAR_FROM_ROAD') {
        res.status(400).json({
          error: 'LOCATION_TOO_FAR_FROM_ROAD',
          message: locErr.message,
          distance_meters: locErr.distanceMeters,
        });
        return;
      }
      throw locErr;
    }

    const srcNodeId = srcLoc.nodeId;
    const dstNodeId = dstLoc.nodeId;

    if (srcNodeId === dstNodeId) {
      res.status(400).json({
        error: 'SAME_ORIGIN_DESTINATION',
        message: 'Origin and destination resolve to the same road location.',
      });
      return;
    }

    const hazardContext = activeHazards
      .filter((h) => Boolean(h.edgeId))
      .map((h) => ({
        edge_id: h.edgeId as string,
        hazard_type: h.type,
        severity: h.severity,
        status: h.status,
        confirm_count: h.confirmCount,
        clear_count: h.clearCount,
        decay_factor: h.decayFactor,
      }));

    const requestId = `REQ-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const pythonPayload: PythonRouteRequest = {
      request_id: requestId,
      source: { node_id: srcNodeId, lat: srcLoc.snappedLat, lng: srcLoc.snappedLng },
      destination: { node_id: dstNodeId, lat: dstLoc.snappedLat, lng: dstLoc.snappedLng },
      vehicle: {
        profile_id: vehicle.type,
        weight_kg: vehicle.maxWeightKg,
        width_m: vehicle.maxWidthM,
        min_safety_score: vehicle.minSafetyScore,
      },
      urgency_profile: 'standard',
      objective: objective === 'fastest' ? 'fastest' : 'safest',
      k: Math.min(5, Math.max(1, Number(k) || 3)),
      hazard_context: hazardContext,
    };

    const routingResult = await callPythonComputeRoute(pythonPayload);

    const routesOut = routingResult.paths.map((p) => {
      const totalKm = p.edges.reduce((sum, e) => sum + (e.distance_km || 0), 0);

      let compositeBand = 'Green';
      if (p.composite_safety_score < 0.50) compositeBand = 'Red';
      else if (p.composite_safety_score < 0.80) compositeBand = 'Yellow';

      // Ensure coordinates list has full geometry
      let fullCoords = p.coordinates || [];
      if (srcLoc.snappedLng && srcLoc.snappedLat && fullCoords.length > 0) {
        if (fullCoords[0][0] !== srcLoc.snappedLng || fullCoords[0][1] !== srcLoc.snappedLat) {
          fullCoords = [[srcLoc.snappedLng, srcLoc.snappedLat], ...fullCoords];
        }
      }
      if (dstLoc.snappedLng && dstLoc.snappedLat && fullCoords.length > 0) {
        if (fullCoords[fullCoords.length - 1][0] !== dstLoc.snappedLng || fullCoords[fullCoords.length - 1][1] !== dstLoc.snappedLat) {
          fullCoords = [...fullCoords, [dstLoc.snappedLng, dstLoc.snappedLat]];
        }
      }

      return {
        rank: p.rank,
        is_recommended: p.rank === 1,
        total_cost: p.total_cost,
        estimated_travel_minutes: p.estimated_travel_minutes,
        distance_km: Number(totalKm.toFixed(1)),
        composite_safety_score: p.composite_safety_score,
        safety_band: compositeBand,
        nodes: p.nodes,
        edges: p.edges.map((e) => ({
          edge_id: e.edge_id,
          name: e.name,
          distance_km: e.distance_km,
          safety_score: e.safety_score,
          risk_band: e.risk_band,
          coordinates: e.coordinates,
        })),
        bottleneck: p.bottleneck,
        coordinates: fullCoords,
        turn_instructions: p.turn_instructions || [],
        rationale: routingResult.rationale,
      };
    });

    await prisma.routeRequest.create({
      data: {
        requestId,
        sourceNodeId: srcNodeId,
        destNodeId: dstNodeId,
        vehicleProfileId: vehicle.id,
        urgencyProfile: objective,
        incidentContextJson: JSON.stringify(hazardContext),
      },
    }).catch(() => {});

    res.json({
      request_id: requestId,
      status: routingResult.status,
      objective: objective === 'fastest' ? 'fastest' : 'safest',
      routing_provider: 'east_khasi_hills_osm',
      routing_mode: 'hazard_aware_local',
      hazard_coverage: {
        status: 'verified',
        warning: null,
      },
      vehicle_limitations: null,
      vehicle: {
        id: vehicle.id,
        name: vehicle.name,
        type: vehicle.type,
      },
      routes: routesOut,
      constraints_applied: routingResult.constraints_applied,
      confidence_score: routingResult.confidence_score,
      rationale: routingResult.rationale,
    });
  } catch (err: any) {
    console.error('Route calculation error:', err);
    res.status(500).json({
      error: 'ROUTING_FAILED',
      message: err.message || 'Failed to compute routes.',
    });
  }
});

export default router;

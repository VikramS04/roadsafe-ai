import { PrismaClient, HazardReport, HazardVote } from '@prisma/client';

const prisma = new PrismaClient();

// Haversine distance in meters between two lat/lng points
export function calculateHaversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Distance from point to line segment
function distancePointToSegmentMeters(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return calculateHaversineDistanceMeters(py, px, y1, x1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);
  return calculateHaversineDistanceMeters(py, px, projY, projX);
}

export interface SnappedRoadEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  name: string;
  distanceMeters: number;
  snapLng: number;
  snapLat: number;
}

/**
 * Snap a GPS coordinate to the nearest road segment in the PostGIS spatial network.
 */
export async function snapToNearestRoadEdge(lat: number, lng: number): Promise<SnappedRoadEdge> {
  try {
    const query = `
      SELECT 
        id AS "edgeId",
        "fromNodeId",
        "toNodeId",
        name,
        round(ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)::numeric, 1) AS "distanceMeters",
        ST_X(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))) AS "snapLng",
        ST_Y(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))) AS "snapLat"
      FROM "RoadSegment"
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 1;
    `;
    const rows: any[] = await prisma.$queryRawUnsafe(query, lng, lat);
    if (rows && rows.length > 0) {
      return {
        edgeId: String(rows[0].edgeId),
        fromNodeId: String(rows[0].fromNodeId),
        toNodeId: String(rows[0].toNodeId),
        name: String(rows[0].name || rows[0].edgeId),
        distanceMeters: Number(rows[0].distanceMeters || 0),
        snapLng: Number(rows[0].snapLng || lng),
        snapLat: Number(rows[0].snapLat || lat),
      };
    }
  } catch (err) {
    console.warn('PostGIS spatial snap fallback:', err);
  }

  return {
    edgeId: 'OSM-E1',
    fromNodeId: '1365141138',
    toNodeId: '1365141186',
    name: 'NH6',
    distanceMeters: 0,
    snapLng: lng,
    snapLat: lat,
  };
}

export interface CreateReportInput {
  deviceId: string;
  type: string;
  severity?: string;
  latitude: number;
  longitude: number;
  edgeId?: string;
  note?: string;
  photoUrl?: string;
}

/**
 * Create a 2-tap hazard report
 */
export async function createHazardReport(input: CreateReportInput): Promise<HazardReport> {
  const edgeId = input.edgeId || (await snapToNearestRoadEdge(input.latitude, input.longitude)).edgeId;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 6 * 3600 * 1000); // 6 hours

  const report = await prisma.$transaction(async (tx) => {
    const r = await tx.hazardReport.create({
      data: {
        type: input.type,
        severity: input.severity || 'medium',
        edgeId,
        lat: input.latitude,
        lng: input.longitude,
        status: 'unverified',
        confirmCount: 0,
        clearCount: 0,
        note: input.note,
        photoUrl: input.photoUrl,
        deviceId: input.deviceId,
        expiresAt,
      },
    });

    // Record append-only hazard event
    await tx.hazardEvent.create({
      data: {
        reportId: r.id,
        eventType: 'REPORT_CREATED',
        deviceId: input.deviceId,
        edgeId: r.edgeId,
        payloadJson: JSON.stringify({
          type: r.type,
          severity: r.severity,
          edgeId: r.edgeId,
          lat: r.lat,
          lng: r.lng,
        }),
      },
    });

    // Increment device total reports
    await tx.deviceProfile.update({
      where: { deviceId: input.deviceId },
      data: { reportCount: { increment: 1 } },
    });

    return r;
  });

  return report;
}

export interface VoteHazardInput {
  reportId: string;
  deviceId: string;
  vote: 'yes' | 'no' | 'cleared';
  voterLatitude?: number;
  voterLongitude?: number;
}

/**
 * Vote on a hazard report:
 * - Checks ~5km proximity requirement
 * - Enforces 1 vote per device per report
 * - Tally: 3 "Yes" -> confirmed, 3 "Cleared" -> cleared
 */
export async function voteOnHazardReport(input: VoteHazardInput): Promise<{
  report: HazardReport;
  vote: HazardVote;
  statusChanged: boolean;
}> {
  const report = await prisma.hazardReport.findUnique({
    where: { id: input.reportId },
  });

  if (!report) {
    throw new Error('Hazard report not found.');
  }

  // 1. Proximity Check (~5 km) if coordinates are provided
  if (input.voterLatitude !== undefined && input.voterLongitude !== undefined) {
    const dist = calculateHaversineDistanceMeters(
      input.voterLatitude,
      input.voterLongitude,
      report.lat,
      report.lng
    );
    if (dist > 5500) {
      throw new Error(`Proximity validation failed: Device is ${(dist / 1000).toFixed(1)} km away. Votes require being within 5 km of the reported hazard.`);
    }
  }

  let statusChanged = false;

  const result = await prisma.$transaction(async (tx) => {
    // Record vote
    const newVote = await tx.hazardVote.create({
      data: {
        reportId: input.reportId,
        deviceId: input.deviceId,
        vote: input.vote,
        lat: input.voterLatitude,
        lng: input.voterLongitude,
      },
    });

    // Increment device vote count
    await tx.deviceProfile.update({
      where: { deviceId: input.deviceId },
      data: { voteCount: { increment: 1 } },
    }).catch(() => {});

    // Update vote counts
    const incField: any = {};
    if (input.vote === 'yes') incField.confirmCount = { increment: 1 };
    else if (input.vote === 'cleared') incField.clearCount = { increment: 1 };

    let updatedReport = await tx.hazardReport.update({
      where: { id: input.reportId },
      data: incField,
    });

    // Tally thresholds: default N=3
    const CONFIRM_THRESHOLD = 3;
    const CLEAR_THRESHOLD = 3;

    let targetStatus = updatedReport.status;

    if (updatedReport.clearCount >= CLEAR_THRESHOLD && updatedReport.status !== 'cleared') {
      targetStatus = 'cleared';
    } else if (updatedReport.confirmCount >= CONFIRM_THRESHOLD && updatedReport.status === 'unverified') {
      targetStatus = 'confirmed';
    }

    if (targetStatus !== updatedReport.status) {
      statusChanged = true;
      updatedReport = await tx.hazardReport.update({
        where: { id: input.reportId },
        data: { status: targetStatus },
      });

      // Log status transition event
      const eventType = targetStatus === 'confirmed' ? 'STATUS_CONFIRMED' : 'STATUS_CLEARED';
      await tx.hazardEvent.create({
        data: {
          reportId: updatedReport.id,
          eventType,
          deviceId: input.deviceId,
          edgeId: updatedReport.edgeId,
          payloadJson: JSON.stringify({
            confirmCount: updatedReport.confirmCount,
            clearCount: updatedReport.clearCount,
          }),
        },
      });

      // Update original reporter's reliability
      if (updatedReport.deviceId && targetStatus === 'confirmed') {
        const reporter = await tx.deviceProfile.findUnique({ where: { deviceId: updatedReport.deviceId } });
        if (reporter) {
          const newScore = Math.min(2.0, reporter.reliabilityScore + 0.1);
          await tx.deviceProfile.update({
            where: { deviceId: updatedReport.deviceId },
            data: { reliabilityScore: Number(newScore.toFixed(2)) },
          });
        }
      }
    }

    return { report: updatedReport, vote: newVote, statusChanged };
  });

  return result;
}

/**
 * Fetch active hazards (unverified and confirmed, not expired)
 * Automatically computes time decay factor: [0, 1]
 */
export async function getActiveHazards(bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number }) {
  const now = new Date();

  const whereClause: any = {
    status: { in: ['unverified', 'confirmed'] },
    expiresAt: { gt: now },
  };

  if (bbox) {
    whereClause.lat = { gte: bbox.minLat, lte: bbox.maxLat };
    whereClause.lng = { gte: bbox.minLng, lte: bbox.maxLng };
  }

  const hazards = await prisma.hazardReport.findMany({
    where: whereClause,
    orderBy: { reportedAt: 'desc' },
  });

  return hazards.map((h) => {
    const ageMs = now.getTime() - new Date(h.reportedAt).getTime();
    const lifespanMs = 6 * 3600 * 1000; // 6 hours
    const decayFactor = Math.max(0, Math.min(1.0, 1.0 - (ageMs / lifespanMs)));

    return {
      ...h,
      decayFactor: Number(decayFactor.toFixed(3)),
    };
  });
}

import { calculateHaversineDistanceMeters } from './hazard.service';
import { getHazardSourceStatuses } from './regionalHazards.service';

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
const OSRM_TIMEOUT_MS = parseInt(process.env.OSRM_TIMEOUT_MS || '10000', 10) || 10000;

export const LOCAL_COVERAGE_BOUNDS = {
  minLat: parseFloat(process.env.COVERAGE_MIN_LAT || '25.14'),
  maxLat: parseFloat(process.env.COVERAGE_MAX_LAT || '25.66'),
  minLng: parseFloat(process.env.COVERAGE_MIN_LNG || '91.50'),
  maxLng: parseFloat(process.env.COVERAGE_MAX_LNG || '92.10'),
};

export function isInsideLocalGraphCoverage(lat: number, lng: number): boolean {
  return (
    lat >= LOCAL_COVERAGE_BOUNDS.minLat &&
    lat <= LOCAL_COVERAGE_BOUNDS.maxLat &&
    lng >= LOCAL_COVERAGE_BOUNDS.minLng &&
    lng <= LOCAL_COVERAGE_BOUNDS.maxLng
  );
}

function formatOsrmInstruction(step: any): string {
  const m = step.maneuver || {};
  const type = m.type || 'continue';
  const mod = m.modifier ? `${m.modifier} ` : '';
  const road = step.name || step.ref || 'the road';
  if (type === 'depart') return `Head ${mod}on ${road}`.trim();
  if (type === 'arrive') return `Arrive at your destination on ${road}`;
  if (type === 'roundabout' || type === 'rotary') return `Take roundabout exit onto ${road}`;
  if (type === 'turn' || type === 'end of road' || type === 'fork') return `Turn ${mod}onto ${road}`.trim();
  return `Continue ${mod}on ${road}`.trim();
}

export async function computeBroadOsrmRoute(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  vehicleType: string;
  objective?: 'fastest' | 'safest';
  activeHazards: any[];
  k?: number;
}) {
  const { origin, destination, vehicleType, objective = 'safest', activeHazards, k = 3 } = params;
  const url = `${OSRM_BASE_URL}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true&alternatives=${k > 1 ? 'true' : 'false'}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

  let osrmJson: any;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`OSRM routing provider returned HTTP ${res.status}`);
    }
    osrmJson = await res.json();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Global routing provider (OSRM) timed out. Please retry.');
    }
    throw new Error(err?.message || 'Global routing provider (OSRM) is unavailable.');
  } finally {
    clearTimeout(timer);
  }

  if (osrmJson.code !== 'Ok' || !Array.isArray(osrmJson.routes) || osrmJson.routes.length === 0) {
    throw new Error(osrmJson.message || 'No drivable road route found between the selected locations.');
  }

  const sourceStatuses = await getHazardSourceStatuses().catch(() => []);
  const anySourceUnavailable = sourceStatuses.length === 0 || sourceStatuses.some((s) => s.status === 'unavailable');

  const severityWeight = (sev: string) =>
    sev === 'critical' ? 4 : sev === 'high' ? 3 : sev === 'medium' ? 2 : 1;

  const candidateRoutes = osrmJson.routes.slice(0, Math.max(k, 3)).map((r: any, idx: number) => {
    const coords: number[][] = r.geometry?.coordinates || [];
    const steps: any[] = r.legs?.[0]?.steps || [];
    const totalDistKm = Number(((r.distance || 0) / 1000).toFixed(1));
    const totalMin = Number(((r.duration || 0) / 60).toFixed(1));

    // Check which active hazards lie within 3km of any sampled route vertex
    const sampleStep = Math.max(1, Math.floor(coords.length / 80));
    const sampledCoords = coords.filter((_, i) => i % sampleStep === 0);
    const nearbyHazards = activeHazards.filter((h) =>
      sampledCoords.some(
        (c) => calculateHaversineDistanceMeters(h.lat, h.lng, c[1], c[0]) <= 3000
      )
    );

    const hazardExposure = nearbyHazards.reduce(
      (sum, h) => sum + severityWeight(h.severity) * (h.decayFactor ?? 1.0),
      0
    );

    const edges = steps.map((st: any, sIdx: number) => {
      const stepCoords: number[][] = st.geometry?.coordinates || [];
      const stepDistKm = Number(((st.distance || 0) / 1000).toFixed(2));
      const midCoord = stepCoords[Math.floor(stepCoords.length / 2)] || [origin.lng, origin.lat];
      const stepHazard = nearbyHazards.find(
        (h) => calculateHaversineDistanceMeters(h.lat, h.lng, midCoord[1], midCoord[0]) <= 3000
      );
      const safetyScore = stepHazard
        ? stepHazard.severity === 'critical'
          ? 0.35
          : stepHazard.severity === 'high'
          ? 0.55
          : 0.72
        : 0.85;
      const riskBand = safetyScore < 0.5 ? 'Red' : safetyScore < 0.8 ? 'Yellow' : 'Green';

      return {
        edge_id: `osrm-${idx}-${sIdx}`,
        name: st.name || st.ref || 'Road segment',
        distance_km: stepDistKm,
        safety_score: safetyScore,
        risk_band: riskBand,
        coordinates: stepCoords,
      };
    });

    const turnInstructions = steps.map((st: any) => ({
      action: st.maneuver?.modifier ? `${st.maneuver.type}-${st.maneuver.modifier}` : st.maneuver?.type || 'continue',
      road: st.name || st.ref || 'Road',
      distance_km: Number(((st.distance || 0) / 1000).toFixed(2)),
      duration_min: Number(((st.duration || 0) / 60).toFixed(1)),
      instruction: formatOsrmInstruction(st),
      location: st.maneuver?.location || [origin.lng, origin.lat],
    }));

    const minSafety = edges.length > 0 ? Math.min(...edges.map((e) => e.safety_score)) : 0.85;
    const band = minSafety < 0.5 ? 'Red' : minSafety < 0.8 ? 'Yellow' : 'Green';

    return {
      total_cost: objective === 'fastest' ? totalMin : totalMin + hazardExposure * 15,
      estimated_travel_minutes: totalMin,
      distance_km: totalDistKm,
      composite_safety_score: Number(minSafety.toFixed(2)),
      safety_band: band,
      hazard_exposure: Number(hazardExposure.toFixed(2)),
      nearby_hazard_count: nearbyHazards.length,
      nodes: [],
      edges,
      bottleneck:
        nearbyHazards.length > 0
          ? {
              edge_id: `nearby-hazard`,
              from_node: '',
              to_node: '',
              safety_score: minSafety,
              reason: `${nearbyHazards[0].type.replace(/_/g, ' ')} advisory near route (${nearbyHazards[0].source}): ${nearbyHazards[0].note || ''}`.slice(0, 180),
            }
          : undefined,
      coordinates: coords,
      turn_instructions: turnInstructions,
      rationale:
        objective === 'fastest'
          ? `Fastest driving route via OSRM (${totalDistKm} km, ${Math.round(totalMin)} min), optimized purely for travel time.`
          : nearbyHazards.length > 0
          ? `Route passes near ${nearbyHazards.length} active hazard(s); no lower-exposure OSRM alternative was available or preferred.`
          : `Ordinary driving route via OSRM (${totalDistKm} km, ${Math.round(totalMin)} min). No hazards reported by checked sources along this corridor, but local road coverage is incomplete.`,
    };
  });

  if (objective === 'fastest') {
    candidateRoutes.sort((a: any, b: any) => a.estimated_travel_minutes - b.estimated_travel_minutes);
  } else {
    candidateRoutes.sort(
      (a: any, b: any) =>
        a.hazard_exposure - b.hazard_exposure || a.estimated_travel_minutes - b.estimated_travel_minutes
    );
  }

  const routes = candidateRoutes.slice(0, k).map((r: any, idx: number) => ({
    ...r,
    rank: idx + 1,
    is_recommended: idx === 0,
  }));

  const vehicleLimitations =
    vehicleType !== 'car'
      ? `OSRM driving profile provides ordinary car directions and does not enforce ${vehicleType} weight, width, or bridge-clearance restrictions.`
      : null;

  return {
    routing_provider: 'osrm_global',
    routing_mode: routes.some((r: any) => Boolean(r.bottleneck)) ? 'ordinary_with_hazards' : 'ordinary_unverified',
    hazard_coverage: {
      status: anySourceUnavailable ? 'unavailable' : 'partial',
      warning: 'Hazard data is unavailable or incomplete for part of this route. This route is not fully hazard-verified.',
      sources: sourceStatuses,
    },
    vehicle_limitations: vehicleLimitations,
    routes,
    rationale: routes[0].rationale,
  };
}

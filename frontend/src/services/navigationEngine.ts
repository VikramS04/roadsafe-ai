import { RouteAlternative, HazardReport } from '../types';

export interface PositionFix {
  lat: number;
  lng: number;
  accuracyM: number;
  speedMps?: number | null;
  headingDeg?: number | null;
  timestamp: number;
}

export interface NavigationStep {
  index: number;
  edgeId: string;
  roadName: string;
  roadRef?: string;
  distanceKm: number;
  distanceM: number;
  startMeters: number;
  endMeters: number;
  safetyScore: number;
  riskBand: 'Green' | 'Yellow' | 'Red';
  maneuver: 'straight' | 'slight-left' | 'left' | 'sharp-left' | 'slight-right' | 'right' | 'sharp-right' | 'u-turn' | 'arrive';
  maneuverIcon: string;
  laneHint: string;
  instruction: string;
  maneuverCoords: [number, number]; // [lng, lat]
  startCoords: [number, number];    // [lng, lat]
  endCoords: [number, number];      // [lng, lat]
  expectedSpeedKmh: number;
}

export interface NavigationSnapshot {
  currentCoords: [number, number]; // [lat, lng] snapped or current
  rawCoords: [number, number];     // [lat, lng] raw GPS
  bearing: number;                 // 0-360
  speedKmh: number;
  accuracyM: number;
  traveledMeters: number;
  totalRouteMeters: number;
  distanceRemainingKm: number;
  timeRemainingMin: number;
  arrivalTimestamp: number;
  stepIndex: number;
  currentStep: NavigationStep | null;
  nextStep: NavigationStep | null;
  currentTurnInstruction: string;
  nextRoadName: string;
  laneHint: string;
  distanceToTurnM: number;
  upcomingHazard: { hazard: HazardReport; distanceAheadM: number } | null;
  isOffRoute: boolean;
  offRouteDistanceM: number;
  hasArrived: boolean;
  shouldReroute: boolean;
  rerouteOrigin: { lat: number; lng: number } | null;
  announcements: string[];
  ignoredReason?: 'poor_accuracy' | 'implausible_jump' | 'paused';
}

export interface NavigationEngineConfig {
  maxAccuracyM: number;
  maxPlausibleSpeedMps: number;
  offRouteThresholdM: number;
  offRouteConsecutiveFixes: number;
  rerouteDebounceMs: number;
  arrivalRadiusM: number;
  hazardLookAheadM: number;
}

export const DEFAULT_NAV_CONFIG: NavigationEngineConfig = {
  maxAccuracyM: 50,
  maxPlausibleSpeedMps: 65, // ~234 km/h
  offRouteThresholdM: 40,
  offRouteConsecutiveFixes: 3,
  rerouteDebounceMs: 10000,
  arrivalRadiusM: 30,
  hazardLookAheadM: 800,
};

export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lon2 - lon1) * Math.PI) / 180);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

export function angleDifference(target: number, current: number): number {
  const diff = ((target - current + 180) % 360) - 180;
  return diff < -180 ? diff + 360 : diff;
}

function classifyManeuver(action: string): { maneuver: NavigationStep['maneuver']; icon: string; laneHint: string } {
  const a = (action || '').toLowerCase();
  if (a.includes('arrive')) return { maneuver: 'arrive', icon: '🏁', laneHint: 'Destination ahead' };
  if (a.includes('u-turn') || a.includes('uturn')) return { maneuver: 'u-turn', icon: '🔄', laneHint: 'Make a U-turn when safe' };
  if (a.includes('sharp') && a.includes('left')) return { maneuver: 'sharp-left', icon: '↙️', laneHint: 'Keep left for sharp turn' };
  if (a.includes('slight') && a.includes('left')) return { maneuver: 'slight-left', icon: '↖️', laneHint: 'Keep left' };
  if (a.includes('left')) return { maneuver: 'left', icon: '⬅️', laneHint: 'Use left lane' };
  if (a.includes('sharp') && a.includes('right')) return { maneuver: 'sharp-right', icon: '↘️', laneHint: 'Keep right for sharp turn' };
  if (a.includes('slight') && a.includes('right')) return { maneuver: 'slight-right', icon: '↗️', laneHint: 'Keep right' };
  if (a.includes('right')) return { maneuver: 'right', icon: '➡️', laneHint: 'Use right lane' };
  return { maneuver: 'straight', icon: '⬆️', laneHint: 'Continue straight' };
}

export function projectPointOntoPolyline(
  lat: number,
  lng: number,
  coords: number[][],
  cumulativeDistancesM: number[]
): {
  snappedLat: number;
  snappedLng: number;
  perpDistM: number;
  traveledMeters: number;
  tangentBearing: number;
  segmentIndex: number;
} {
  if (coords.length === 0) {
    return { snappedLat: lat, snappedLng: lng, perpDistM: Infinity, traveledMeters: 0, tangentBearing: 0, segmentIndex: 0 };
  }
  if (coords.length === 1) {
    return {
      snappedLat: coords[0][1],
      snappedLng: coords[0][0],
      perpDistM: getDistanceMeters(lat, lng, coords[0][1], coords[0][0]),
      traveledMeters: 0,
      tangentBearing: 0,
      segmentIndex: 0,
    };
  }

  const cosLat = Math.cos((lat * Math.PI) / 180);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * cosLat;

  let minPerpDist = Infinity;
  let snappedLat = coords[0][1];
  let snappedLng = coords[0][0];
  let traveledMeters = 0;
  let tangentBearing = 0;
  let segmentIndex = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];

    const ax = (p1[0] - lng) * metersPerDegLng;
    const ay = (p1[1] - lat) * metersPerDegLat;
    const bx = (p2[0] - lng) * metersPerDegLng;
    const by = (p2[1] - lat) * metersPerDegLat;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
    }

    const projLat = p1[1] + t * (p2[1] - p1[1]);
    const projLng = p1[0] + t * (p2[0] - p1[0]);
    const perpDist = getDistanceMeters(lat, lng, projLat, projLng);

    if (perpDist < minPerpDist) {
      minPerpDist = perpDist;
      snappedLat = projLat;
      snappedLng = projLng;
      const segStartDist = cumulativeDistancesM[i] ?? 0;
      const segEndDist = cumulativeDistancesM[i + 1] ?? segStartDist;
      traveledMeters = segStartDist + t * (segEndDist - segStartDist);
      tangentBearing = getBearing(p1[1], p1[0], p2[1], p2[0]);
      segmentIndex = i;
    }
  }

  return { snappedLat, snappedLng, perpDistM: minPerpDist, traveledMeters, tangentBearing, segmentIndex };
}

export function computeCumulativeDistances(coords: number[][]): number[] {
  const dists = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += getDistanceMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    dists.push(total);
  }
  return dists;
}

export function buildNavigationSteps(
  route: RouteAlternative,
  cumulativeDistancesM: number[],
  totalRouteMeters: number
): NavigationStep[] {
  const coords = route.coordinates || [];
  const edges = route.edges || [];
  const turnInstructions = route.turn_instructions || [];

  const avgRouteSpeedKmh =
    route.estimated_travel_minutes > 0 && route.distance_km > 0
      ? Math.max(15, Math.min(80, (route.distance_km / route.estimated_travel_minutes) * 60))
      : 35;

  if (turnInstructions.length > 0) {
    const steps: NavigationStep[] = [];
    let cursorMeters = 0;

    for (let i = 0; i < turnInstructions.length; i++) {
      const inst = turnInstructions[i];
      const stepDistM = Math.max(1, (inst.distance_km || 0) * 1000);
      const startMeters = cursorMeters;
      const endMeters = i === turnInstructions.length - 1
        ? totalRouteMeters
        : Math.min(totalRouteMeters, cursorMeters + stepDistM);
      cursorMeters = endMeters;

      const proj = projectPointOntoPolyline(inst.location[1], inst.location[0], coords, cumulativeDistancesM);
      const matchingEdge = edges.find((e) => (e.name || '') === inst.road) || edges[Math.min(i, Math.max(0, edges.length - 1))];
      const meta = classifyManeuver(inst.action);
      const expectedSpeed =
        inst.duration_min > 0 && inst.distance_km > 0
          ? Math.max(15, Math.min(80, (inst.distance_km / inst.duration_min) * 60))
          : avgRouteSpeedKmh;

      steps.push({
        index: i,
        edgeId: matchingEdge?.edge_id || `step-${i}`,
        roadName: inst.road || matchingEdge?.name || 'Road',
        distanceKm: Number((stepDistM / 1000).toFixed(2)),
        distanceM: Math.round(endMeters - startMeters),
        startMeters,
        endMeters,
        safetyScore: matchingEdge?.safety_score ?? route.composite_safety_score ?? 0.8,
        riskBand: matchingEdge?.risk_band ?? route.safety_band ?? 'Green',
        maneuver: meta.maneuver,
        maneuverIcon: meta.icon,
        laneHint: meta.laneHint,
        instruction: inst.instruction,
        maneuverCoords: inst.location,
        startCoords: [proj.snappedLng, proj.snappedLat],
        endCoords: inst.location,
        expectedSpeedKmh: expectedSpeed,
      });
    }
    return steps;
  }

  // Fallback to edges if turn_instructions absent
  const steps: NavigationStep[] = [];
  let cursorMeters = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const startCoord = (e.coordinates && e.coordinates[0]) || coords[0] || [0, 0];
    const endCoord = (e.coordinates && e.coordinates[e.coordinates.length - 1]) || coords[coords.length - 1] || [0, 0];
    const stepDistM = Math.max(1, (e.distance_km || 0) * 1000);
    const startMeters = cursorMeters;
    const endMeters = i === edges.length - 1 ? totalRouteMeters : Math.min(totalRouteMeters, cursorMeters + stepDistM);
    cursorMeters = endMeters;

    let action = 'straight';
    if (i === edges.length - 1) {
      action = 'arrive';
    } else {
      const nextEdge = edges[i + 1];
      const nextStart = (nextEdge.coordinates && nextEdge.coordinates[0]) || endCoord;
      const nextEnd = (nextEdge.coordinates && nextEdge.coordinates[nextEdge.coordinates.length - 1]) || endCoord;
      const b1 = getBearing(startCoord[1], startCoord[0], endCoord[1], endCoord[0]);
      const b2 = getBearing(nextStart[1], nextStart[0], nextEnd[1], nextEnd[0]);
      const diff = angleDifference(b2, b1);
      if (diff < -35) action = 'left';
      else if (diff > 35) action = 'right';
    }

    const meta = classifyManeuver(action);
    const roadName = e.name || e.edge_id;
    const instruction =
      meta.maneuver === 'arrive'
        ? `Arrive at your destination on ${roadName}`
        : meta.maneuver === 'straight'
        ? `Continue on ${roadName}`
        : `Turn ${meta.maneuver.replace('-', ' ')} onto ${roadName}`;

    steps.push({
      index: i,
      edgeId: e.edge_id,
      roadName,
      distanceKm: e.distance_km,
      distanceM: Math.round(endMeters - startMeters),
      startMeters,
      endMeters,
      safetyScore: e.safety_score,
      riskBand: e.risk_band,
      maneuver: meta.maneuver,
      maneuverIcon: meta.icon,
      laneHint: meta.laneHint,
      instruction,
      maneuverCoords: [endCoord[0], endCoord[1]],
      startCoords: [startCoord[0], startCoord[1]],
      endCoords: [endCoord[0], endCoord[1]],
      expectedSpeedKmh: avgRouteSpeedKmh,
    });
  }
  return steps;
}

interface MatchedHazard {
  hazard: HazardReport;
  routeMeters: number;
  perpDistM: number;
}

export class NavigationEngine {
  private route: RouteAlternative;
  private config: NavigationEngineConfig;
  private cumulativeDistancesM: number[];
  private totalRouteMeters: number;
  private steps: NavigationStep[];
  private matchedHazards: MatchedHazard[] = [];

  private lastAcceptedFix: PositionFix | null = null;
  private smoothedBearing: number = 0;
  private smoothedSpeedKmh: number = 0;
  private currentStepIndex: number = 0;
  private highestTraveledMeters: number = 0;
  private consecutiveOffRouteCount: number = 0;
  private lastRerouteTimestamp: number = 0;
  private hasArrived: boolean = false;
  private isPaused: boolean = false;
  private announcedMilestones: Set<string> = new Set();
  private warnedHazardIds: Set<string> = new Set();

  constructor(
    route: RouteAlternative,
    hazards: HazardReport[] = [],
    config: Partial<NavigationEngineConfig> = {}
  ) {
    this.route = route;
    this.config = { ...DEFAULT_NAV_CONFIG, ...config };
    const coords = route.coordinates || [];
    this.cumulativeDistancesM = computeCumulativeDistances(coords);
    this.totalRouteMeters = this.cumulativeDistancesM[this.cumulativeDistancesM.length - 1] || (route.distance_km * 1000);
    this.steps = buildNavigationSteps(route, this.cumulativeDistancesM, this.totalRouteMeters);

    if (coords.length >= 2) {
      this.smoothedBearing = getBearing(coords[0][1], coords[0][0], coords[1][1], coords[1][0]);
    }

    this.updateHazards(hazards);
  }

  public updateHazards(hazards: HazardReport[]): void {
    const coords = this.route.coordinates || [];
    this.matchedHazards = hazards
      .filter((h) => !['cleared', 'expired', 'rejected'].includes(h.status))
      .map((h) => {
        const proj = projectPointOntoPolyline(h.lat, h.lng, coords, this.cumulativeDistancesM);
        return { hazard: h, routeMeters: proj.traveledMeters, perpDistM: proj.perpDistM };
      })
      .filter((mh) => mh.perpDistM <= 60)
      .sort((a, b) => a.routeMeters - b.routeMeters);
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  public getInitialSnapshot(now = Date.now()): NavigationSnapshot {
    const coords = this.route.coordinates || [];
    const startLat = coords[0]?.[1] ?? 25.5788;
    const startLng = coords[0]?.[0] ?? 91.8933;
    const firstStep = this.steps[0] || null;
    const nextStep = this.steps[1] || null;
    const distToTurn = firstStep ? Math.max(0, Math.round(firstStep.endMeters)) : Math.round(this.totalRouteMeters);
    const totalMin = Math.max(1, Math.round(this.route.estimated_travel_minutes || (this.totalRouteMeters / 1000 / 35) * 60));

    return {
      currentCoords: [startLat, startLng],
      rawCoords: [startLat, startLng],
      bearing: Math.round(this.smoothedBearing),
      speedKmh: 0,
      accuracyM: 5,
      traveledMeters: 0,
      totalRouteMeters: this.totalRouteMeters,
      distanceRemainingKm: Number((this.totalRouteMeters / 1000).toFixed(1)),
      timeRemainingMin: totalMin,
      arrivalTimestamp: now + totalMin * 60_000,
      stepIndex: 0,
      currentStep: firstStep,
      nextStep,
      currentTurnInstruction: firstStep?.instruction || 'Head towards your destination',
      nextRoadName: nextStep?.roadName || firstStep?.roadName || '',
      laneHint: firstStep?.laneHint || 'Continue straight',
      distanceToTurnM: distToTurn,
      upcomingHazard: null,
      isOffRoute: false,
      offRouteDistanceM: 0,
      hasArrived: false,
      shouldReroute: false,
      rerouteOrigin: null,
      announcements: firstStep ? [`Starting RoadSafe navigation. ${firstStep.instruction}`] : [],
    };
  }

  public processPositionFix(fix: PositionFix): NavigationSnapshot {
    const announcements: string[] = [];

    if (this.isPaused) {
      return {
        ...this.buildCurrentSnapshot(fix, 0, false, false, null, []),
        ignoredReason: 'paused',
      };
    }

    // 1. Accuracy filter
    if (fix.accuracyM > this.config.maxAccuracyM) {
      return {
        ...this.buildCurrentSnapshot(fix, 0, false, false, null, []),
        ignoredReason: 'poor_accuracy',
      };
    }

    // 2. Implausible jump filter
    if (this.lastAcceptedFix) {
      const dtSec = (fix.timestamp - this.lastAcceptedFix.timestamp) / 1000;
      const jumpDistM = getDistanceMeters(this.lastAcceptedFix.lat, this.lastAcceptedFix.lng, fix.lat, fix.lng);
      if (dtSec > 0 && jumpDistM > 150 && jumpDistM / dtSec > this.config.maxPlausibleSpeedMps) {
        return {
          ...this.buildCurrentSnapshot(fix, 0, false, false, null, []),
          ignoredReason: 'implausible_jump',
        };
      }
    }

    // 3. Speed & heading smoothing
    let rawSpeedKmh = fix.speedMps !== undefined && fix.speedMps !== null && fix.speedMps >= 0
      ? fix.speedMps * 3.6
      : null;
    let derivedHeading: number | null = fix.headingDeg !== undefined && fix.headingDeg !== null ? fix.headingDeg : null;

    if (this.lastAcceptedFix) {
      const dtSec = Math.max(0.5, (fix.timestamp - this.lastAcceptedFix.timestamp) / 1000);
      const movedM = getDistanceMeters(this.lastAcceptedFix.lat, this.lastAcceptedFix.lng, fix.lat, fix.lng);
      if (rawSpeedKmh === null) {
        rawSpeedKmh = movedM > 1.0 ? (movedM / dtSec) * 3.6 : 0;
      }
      if (derivedHeading === null && movedM > 2.0) {
        derivedHeading = getBearing(this.lastAcceptedFix.lat, this.lastAcceptedFix.lng, fix.lat, fix.lng);
      }
    }

    if (rawSpeedKmh !== null) {
      this.smoothedSpeedKmh =
        this.lastAcceptedFix === null
          ? Math.round(rawSpeedKmh)
          : Math.round(0.45 * rawSpeedKmh + 0.55 * this.smoothedSpeedKmh);
    }

    this.lastAcceptedFix = fix;

    // 4. Map-matching onto route polyline
    const coords = this.route.coordinates || [];
    const proj = projectPointOntoPolyline(fix.lat, fix.lng, coords, this.cumulativeDistancesM);

    const targetBearing = derivedHeading !== null ? derivedHeading : proj.tangentBearing;
    const bearingDiff = angleDifference(targetBearing, this.smoothedBearing);
    this.smoothedBearing = (this.smoothedBearing + bearingDiff * 0.3 + 360) % 360;

    // 5. Off-route handling & debounce
    let isOffRoute = false;
    let shouldReroute = false;
    let rerouteOrigin: { lat: number; lng: number } | null = null;

    if (proj.perpDistM > this.config.offRouteThresholdM) {
      this.consecutiveOffRouteCount += 1;
      if (this.consecutiveOffRouteCount >= this.config.offRouteConsecutiveFixes) {
        isOffRoute = true;
        if (fix.timestamp - this.lastRerouteTimestamp >= this.config.rerouteDebounceMs) {
          this.lastRerouteTimestamp = fix.timestamp;
          shouldReroute = true;
          rerouteOrigin = { lat: fix.lat, lng: fix.lng };
          announcements.push('Off route. Rerouting.');
        }
      }
    } else {
      this.consecutiveOffRouteCount = 0;
    }

    // 6. Arrival detection
    const finalCoord = coords[coords.length - 1];
    const distToDestM = finalCoord
      ? getDistanceMeters(fix.lat, fix.lng, finalCoord[1], finalCoord[0])
      : Math.max(0, this.totalRouteMeters - proj.traveledMeters);

    if (!this.hasArrived && (distToDestM <= this.config.arrivalRadiusM || proj.traveledMeters >= this.totalRouteMeters - 20)) {
      this.hasArrived = true;
      this.highestTraveledMeters = this.totalRouteMeters;
      this.currentStepIndex = Math.max(0, this.steps.length - 1);
      announcements.push('You have arrived at your destination.');
      return this.buildCurrentSnapshot(fix, proj.perpDistM, isOffRoute, false, null, announcements, proj.snappedLat, proj.snappedLng);
    }

    // 7. Monotonic step progression (advance only when passing maneuver point, never skip/repeat)
    if (!isOffRoute) {
      this.highestTraveledMeters = Math.max(this.highestTraveledMeters, proj.traveledMeters);
    }

    while (
      this.currentStepIndex < this.steps.length - 1 &&
      this.highestTraveledMeters >= this.steps[this.currentStepIndex].endMeters - 12
    ) {
      this.currentStepIndex += 1;
    }

    const activeStep = this.steps[this.currentStepIndex] || null;
    const distToTurnM = activeStep
      ? Math.max(0, Math.round(activeStep.endMeters - this.highestTraveledMeters))
      : Math.max(0, Math.round(this.totalRouteMeters - this.highestTraveledMeters));

    // 8. Speed-scaled maneuver voice announcements (500m, 200m, at-turn)
    if (activeStep && !isOffRoute && !this.hasArrived) {
      const speedMps = Math.max(5, this.smoothedSpeedKmh / 3.6);
      const atTurnThreshold = Math.max(30, Math.min(80, speedMps * 2.5));
      const nearThreshold = Math.max(180, Math.min(280, speedMps * 12));
      const farThreshold = Math.max(450, Math.min(650, speedMps * 25));

      const kFar = `step-${activeStep.index}-far`;
      const kNear = `step-${activeStep.index}-near`;
      const kTurn = `step-${activeStep.index}-turn`;

      if (distToTurnM <= atTurnThreshold && !this.announcedMilestones.has(kTurn)) {
        this.announcedMilestones.add(kTurn);
        this.announcedMilestones.add(kNear);
        this.announcedMilestones.add(kFar);
        announcements.push(activeStep.instruction);
      } else if (distToTurnM <= nearThreshold && distToTurnM > atTurnThreshold && !this.announcedMilestones.has(kNear)) {
        this.announcedMilestones.add(kNear);
        this.announcedMilestones.add(kFar);
        announcements.push(`In 200 meters, ${activeStep.instruction}`);
      } else if (distToTurnM <= farThreshold && distToTurnM > nearThreshold && !this.announcedMilestones.has(kFar)) {
        this.announcedMilestones.add(kFar);
        announcements.push(`In 500 meters, ${activeStep.instruction}`);
      }
    }

    // 9. Remaining-route hazard look-ahead (warn once per hazard ID)
    let upcomingHazard: { hazard: HazardReport; distanceAheadM: number } | null = null;
    for (const mh of this.matchedHazards) {
      const aheadM = mh.routeMeters - this.highestTraveledMeters;
      if (aheadM > 0 && aheadM <= this.config.hazardLookAheadM) {
        upcomingHazard = { hazard: mh.hazard, distanceAheadM: Math.round(aheadM) };
        if (!this.warnedHazardIds.has(mh.hazard.id)) {
          this.warnedHazardIds.add(mh.hazard.id);
          announcements.push(
            `Caution: ${mh.hazard.type.replace(/_/g, ' ')} reported ${Math.round(aheadM)} meters ahead.`
          );
        }
        break;
      }
    }

    return this.buildCurrentSnapshot(
      fix,
      proj.perpDistM,
      isOffRoute,
      shouldReroute,
      rerouteOrigin,
      announcements,
      isOffRoute ? fix.lat : proj.snappedLat,
      isOffRoute ? fix.lng : proj.snappedLng,
      upcomingHazard
    );
  }

  private buildCurrentSnapshot(
    fix: PositionFix,
    perpDistM: number,
    isOffRoute: boolean,
    shouldReroute: boolean,
    rerouteOrigin: { lat: number; lng: number } | null,
    announcements: string[],
    displayLat?: number,
    displayLng?: number,
    upcomingHazard: { hazard: HazardReport; distanceAheadM: number } | null = null
  ): NavigationSnapshot {
    const activeStep = this.steps[this.currentStepIndex] || null;
    const nextStep = this.steps[this.currentStepIndex + 1] || null;
    const remMeters = Math.max(0, this.totalRouteMeters - this.highestTraveledMeters);
    const remKm = Number((remMeters / 1000).toFixed(1));
    const distToTurnM = activeStep
      ? Math.max(0, Math.round(activeStep.endMeters - this.highestTraveledMeters))
      : Math.round(remMeters);

    // Blend current speed with expected step/edge speed limit
    const expectedSpeed = activeStep?.expectedSpeedKmh || 35;
    const blendedSpeedKmh =
      this.smoothedSpeedKmh >= 5
        ? Math.max(10, 0.4 * this.smoothedSpeedKmh + 0.6 * expectedSpeed)
        : expectedSpeed;
    const timeRemainingMin = this.hasArrived
      ? 0
      : Math.max(1, Math.round(((remMeters / 1000) / blendedSpeedKmh) * 60));

    return {
      currentCoords: [displayLat ?? fix.lat, displayLng ?? fix.lng],
      rawCoords: [fix.lat, fix.lng],
      bearing: Math.round(this.smoothedBearing),
      speedKmh: this.hasArrived ? 0 : this.smoothedSpeedKmh,
      accuracyM: Math.round(fix.accuracyM),
      traveledMeters: Math.round(this.highestTraveledMeters),
      totalRouteMeters: Math.round(this.totalRouteMeters),
      distanceRemainingKm: this.hasArrived ? 0 : remKm,
      timeRemainingMin,
      arrivalTimestamp: fix.timestamp + timeRemainingMin * 60_000,
      stepIndex: this.currentStepIndex,
      currentStep: activeStep,
      nextStep,
      currentTurnInstruction: activeStep?.instruction || 'Continue along route',
      nextRoadName: nextStep?.roadName || activeStep?.roadName || '',
      laneHint: activeStep?.laneHint || 'Continue straight',
      distanceToTurnM: this.hasArrived ? 0 : distToTurnM,
      upcomingHazard,
      isOffRoute,
      offRouteDistanceM: Math.round(perpDistM),
      hasArrived: this.hasArrived,
      shouldReroute,
      rerouteOrigin,
      announcements,
    };
  }
}

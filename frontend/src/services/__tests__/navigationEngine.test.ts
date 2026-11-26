import { describe, it, expect } from 'vitest';
import { NavigationEngine, projectPointOntoPolyline, computeCumulativeDistances } from '../navigationEngine';
import { RouteAlternative, HazardReport } from '../../types';

const SAMPLE_ROUTE: RouteAlternative = {
  rank: 1,
  is_recommended: true,
  total_cost: 10,
  estimated_travel_minutes: 4,
  distance_km: 2.0,
  composite_safety_score: 0.9,
  safety_band: 'Green',
  nodes: ['N1', 'N2', 'N3'],
  edges: [
    {
      edge_id: 'E1',
      name: 'GS Road',
      distance_km: 1.0,
      safety_score: 0.92,
      risk_band: 'Green',
      coordinates: [
        [91.8900, 25.5700],
        [91.8900, 25.5790],
      ],
    },
    {
      edge_id: 'E2',
      name: 'NH-106',
      distance_km: 1.0,
      safety_score: 0.88,
      risk_band: 'Green',
      coordinates: [
        [91.8900, 25.5790],
        [91.9000, 25.5790],
      ],
    },
  ],
  coordinates: [
    [91.8900, 25.5700],
    [91.8900, 25.5790], // ~1000m north
    [91.9000, 25.5790], // ~1000m east
  ],
  turn_instructions: [
    {
      action: 'straight',
      road: 'GS Road',
      distance_km: 1.0,
      duration_min: 2.0,
      instruction: 'Continue north on GS Road',
      location: [91.8900, 25.5790],
    },
    {
      action: 'right',
      road: 'NH-106',
      distance_km: 1.0,
      duration_min: 2.0,
      instruction: 'Turn right onto NH-106',
      location: [91.9000, 25.5790],
    },
  ],
  rationale: 'Safest path',
};

describe('NavigationEngine', () => {
  it('projects noisy GPS fixes onto the nearest route segment', () => {
    const cumDists = computeCumulativeDistances(SAMPLE_ROUTE.coordinates);
    // ~15m east of midpoint of GS Road
    const proj = projectPointOntoPolyline(25.5745, 91.89015, SAMPLE_ROUTE.coordinates, cumDists);
    expect(proj.segmentIndex).toBe(0);
    expect(proj.perpDistM).toBeGreaterThan(10);
    expect(proj.perpDistM).toBeLessThan(20);
    expect(proj.snappedLng).toBeCloseTo(91.8900, 4);
    expect(proj.traveledMeters).toBeGreaterThan(450);
    expect(proj.traveledMeters).toBeLessThan(550);
  });

  it('filters out poor accuracy (>50m) and implausible jumps', () => {
    const engine = new NavigationEngine(SAMPLE_ROUTE);
    const t0 = 1000000;

    // Good fix
    const s1 = engine.processPositionFix({ lat: 25.5710, lng: 91.8900, accuracyM: 10, timestamp: t0 });
    expect(s1.ignoredReason).toBeUndefined();

    // Poor accuracy fix
    const s2 = engine.processPositionFix({ lat: 25.5720, lng: 91.8900, accuracyM: 85, timestamp: t0 + 2000 });
    expect(s2.ignoredReason).toBe('poor_accuracy');

    // Implausible jump (20km in 1 second)
    const s3 = engine.processPositionFix({ lat: 25.7700, lng: 91.8900, accuracyM: 10, timestamp: t0 + 3000 });
    expect(s3.ignoredReason).toBe('implausible_jump');
  });

  it('advances steps monotonically without skipping or repeating', () => {
    const engine = new NavigationEngine(SAMPLE_ROUTE);
    const t0 = 1000000;

    // Along first leg (GS Road)
    const s1 = engine.processPositionFix({ lat: 25.5730, lng: 91.8900, accuracyM: 8, speedMps: 10, timestamp: t0 });
    expect(s1.stepIndex).toBe(0);
    expect(s1.currentStep?.roadName).toBe('GS Road');

    // Approach turn (<200m) -> triggers 200m voice announcement once (500m in 50s = 10 m/s)
    const s2 = engine.processPositionFix({ lat: 25.5775, lng: 91.8900, accuracyM: 8, speedMps: 10, timestamp: t0 + 50000 });
    expect(s2.stepIndex).toBe(0);
    expect(s2.announcements.some((a) => a.includes('In 200 meters'))).toBe(true);

    // Same vicinity -> must NOT repeat 200m announcement
    const s2b = engine.processPositionFix({ lat: 25.5776, lng: 91.8900, accuracyM: 8, speedMps: 10, timestamp: t0 + 51000 });
    expect(s2b.announcements.some((a) => a.includes('In 200 meters'))).toBe(false);

    // Pass maneuver point onto NH-106 -> advances to stepIndex 1
    const s3 = engine.processPositionFix({ lat: 25.5790, lng: 91.8915, accuracyM: 8, speedMps: 10, timestamp: t0 + 75000 });
    expect(s3.stepIndex).toBe(1);
    expect(s3.currentStep?.roadName).toBe('NH-106');

    // Brief GPS jitter back near corner -> must NOT regress stepIndex
    const s4 = engine.processPositionFix({ lat: 25.5789, lng: 91.8901, accuracyM: 8, speedMps: 10, timestamp: t0 + 77000 });
    expect(s4.stepIndex).toBe(1);
  });

  it('triggers off-route after 3 consecutive >40m fixes and debounces reroutes', () => {
    const engine = new NavigationEngine(SAMPLE_ROUTE, [], { rerouteDebounceMs: 10000 });
    const t0 = 1000000;

    // 1st off-route (~100m away)
    const r1 = engine.processPositionFix({ lat: 25.5740, lng: 91.8910, accuracyM: 8, timestamp: t0 });
    expect(r1.isOffRoute).toBe(false);
    expect(r1.shouldReroute).toBe(false);

    // 2nd off-route
    const r2 = engine.processPositionFix({ lat: 25.5740, lng: 91.8912, accuracyM: 8, timestamp: t0 + 2000 });
    expect(r2.isOffRoute).toBe(false);

    // 3rd off-route -> triggers reroute!
    const r3 = engine.processPositionFix({ lat: 25.5740, lng: 91.8914, accuracyM: 8, timestamp: t0 + 4000 });
    expect(r3.isOffRoute).toBe(true);
    expect(r3.shouldReroute).toBe(true);
    expect(r3.rerouteOrigin).toEqual({ lat: 25.5740, lng: 91.8914 });
    expect(r3.announcements).toContain('Off route. Rerouting.');

    // 4th off-route within 10s debounce -> debounced (shouldReroute = false)
    const r4 = engine.processPositionFix({ lat: 25.5740, lng: 91.8916, accuracyM: 8, timestamp: t0 + 6000 });
    expect(r4.isOffRoute).toBe(true);
    expect(r4.shouldReroute).toBe(false);
  });

  it('warns about hazards only on the remaining route and never repeats', () => {
    const hazardAhead: HazardReport = {
      id: 'haz-1',
      type: 'landslide',
      severity: 'high',
      lat: 25.5750,
      lng: 91.8900,
      status: 'confirmed',
      confirmCount: 3,
      clearCount: 0,
      deviceId: 'dev-test',
      reportedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const engine = new NavigationEngine(SAMPLE_ROUTE, [hazardAhead]);
    const t0 = 1000000;

    // 300m before hazard -> warns once
    const s1 = engine.processPositionFix({ lat: 25.5720, lng: 91.8900, accuracyM: 8, timestamp: t0 });
    expect(s1.upcomingHazard?.hazard.id).toBe('haz-1');
    expect(s1.announcements.some((a) => a.includes('landslide'))).toBe(true);

    // Next fix still before hazard -> does not repeat warning
    const s2 = engine.processPositionFix({ lat: 25.5730, lng: 91.8900, accuracyM: 8, timestamp: t0 + 3000 });
    expect(s2.announcements.some((a) => a.includes('landslide'))).toBe(false);

    // Past hazard -> no longer upcoming
    const s3 = engine.processPositionFix({ lat: 25.5770, lng: 91.8900, accuracyM: 8, timestamp: t0 + 8000 });
    expect(s3.upcomingHazard).toBeNull();
  });

  it('calculates blended ETA and detects arrival within 30m of destination', () => {
    const engine = new NavigationEngine(SAMPLE_ROUTE);
    const t0 = 1000000;

    const mid = engine.processPositionFix({ lat: 25.5790, lng: 91.8950, accuracyM: 8, speedMps: 10, timestamp: t0 });
    expect(mid.hasArrived).toBe(false);
    expect(mid.distanceRemainingKm).toBeGreaterThan(0.3);
    expect(mid.timeRemainingMin).toBeGreaterThanOrEqual(1);

    const arrived = engine.processPositionFix({ lat: 25.5790, lng: 91.8999, accuracyM: 8, speedMps: 5, timestamp: t0 + 20000 });
    expect(arrived.hasArrived).toBe(true);
    expect(arrived.distanceRemainingKm).toBe(0);
    expect(arrived.timeRemainingMin).toBe(0);
    expect(arrived.announcements).toContain('You have arrived at your destination.');
  });
});

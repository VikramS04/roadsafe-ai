import { useState, useEffect, useRef, useCallback } from 'react';
import { RouteAlternative, HazardReport, TurnInstruction } from '../types';

export interface NavigationStep {
  index: number;
  edgeId: string;
  roadName: string;
  distanceKm: number;
  safetyScore: number;
  riskBand: 'Green' | 'Yellow' | 'Red';
  maneuver: 'straight' | 'left' | 'right' | 'arrive';
  maneuverIcon: string;
  instruction: string;
  startCoords: [number, number]; // [lng, lat]
  endCoords: [number, number];   // [lng, lat]
  hazardAhead?: HazardReport;
}

export interface DrivingState {
  isNavigating: boolean;
  isSimulating: boolean;
  simulationMultiplier: number;
  currentCoords: [number, number] | null; // [lat, lng]
  bearing: number; // 0 - 360 degrees
  speedKmh: number;
  accuracyM: number;
  stepIndex: number;
  currentStep: NavigationStep | null;
  currentTurnInstruction: string;
  distanceToTurnM: number;
  distanceRemainingKm: number;
  timeRemainingMin: number;
  isMuted: boolean;
  hasArrived: boolean;
  isOffRoute: boolean;
  isFollowingCamera: boolean;
}

// Haversine distance in meters between two lat/lng points
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Initial bearing from point 1 to point 2
function getBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(((lon2 - lon1) * Math.PI) / 180);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

// Smallest difference between two bearings in [-180, 180]
function angleDifference(target: number, current: number): number {
  let diff = (target - current + 180) % 360 - 180;
  return diff < -180 ? diff + 360 : diff;
}

export function useDrivingNavigation(onRecalculate?: () => void) {
  const [drivingState, setDrivingState] = useState<DrivingState>({
    isNavigating: false,
    isSimulating: false,
    simulationMultiplier: 2,
    currentCoords: null,
    bearing: 0,
    speedKmh: 0,
    accuracyM: 5,
    stepIndex: 0,
    currentStep: null,
    currentTurnInstruction: '',
    distanceToTurnM: 0,
    distanceRemainingKm: 0,
    timeRemainingMin: 0,
    isMuted: false,
    hasArrived: false,
    isOffRoute: false,
    isFollowingCamera: true,
  });

  const activeRouteRef = useRef<RouteAlternative | null>(null);
  const stepsRef = useRef<NavigationStep[]>([]);
  const turnInstructionsRef = useRef<TurnInstruction[]>([]);
  const hazardsRef = useRef<HazardReport[]>([]);
  const polylineDistancesRef = useRef<number[]>([]); // cumulative distance to each vertex
  const totalRouteMetersRef = useRef<number>(0);
  const currentTraveledMetersRef = useRef<number>(0);
  const currentBearingRef = useRef<number>(0);
  const offRouteCountRef = useRef<number>(0);
  const lastRerouteTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastSpokenInstructionRef = useRef<string>('');
  const lastSpokenTurnKeyRef = useRef<string>('');
  const prevGpsPosRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  // Voice Speech Helper
  const speak = useCallback((text: string, force = false) => {
    if (drivingState.isMuted && !force) return;
    if (!('speechSynthesis' in window)) return;
    if (lastSpokenInstructionRef.current === text) return;

    lastSpokenInstructionRef.current = text;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }, [drivingState.isMuted]);

  // Pre-calculate cumulative distance along the full curved polyline
  const precomputePolylineDistances = (coords: number[][]) => {
    const dists = [0];
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = getDistanceMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
      total += d;
      dists.push(total);
    }
    polylineDistancesRef.current = dists;
    totalRouteMetersRef.current = total;
  };

  // Build steps from Route edges
  const buildSteps = (route: RouteAlternative, hazards: HazardReport[]): NavigationStep[] => {
    const steps: NavigationStep[] = [];
    const edges = route.edges || [];

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const startCoord = (e.coordinates && e.coordinates[0]) || [0, 0];
      const endCoord = (e.coordinates && e.coordinates[e.coordinates.length - 1]) || [0, 0];

      let maneuver: 'straight' | 'left' | 'right' | 'arrive' = 'straight';
      let icon = '⬆️';

      if (i === edges.length - 1) {
        maneuver = 'arrive';
        icon = '🏁';
      } else {
        const nextEdge = edges[i + 1];
        const nextStart = (nextEdge.coordinates && nextEdge.coordinates[0]) || [0, 0];
        const nextEnd = (nextEdge.coordinates && nextEdge.coordinates[nextEdge.coordinates.length - 1]) || [0, 0];

        const b1 = getBearing(startCoord[1], startCoord[0], endCoord[1], endCoord[0]);
        const b2 = getBearing(nextStart[1], nextStart[0], nextEnd[1], nextEnd[0]);
        let diff = (b2 - b1 + 360) % 360;
        if (diff > 180) diff -= 360;

        if (diff < -35) {
          maneuver = 'left';
          icon = '⬅️';
        } else if (diff > 35) {
          maneuver = 'right';
          icon = '➡️';
        }
      }

      const hazard = hazards.find((h) => h.edgeId === e.edge_id && h.status !== 'cleared');

      let instruction = '';
      if (maneuver === 'arrive') {
        instruction = `In ${e.distance_km} km, arrive at your final destination on ${e.name || 'destination road'}`;
      } else if (maneuver === 'left') {
        instruction = `Continue on ${e.name || 'road'}, then in ${e.distance_km} km turn left`;
      } else if (maneuver === 'right') {
        instruction = `Continue on ${e.name || 'road'}, then in ${e.distance_km} km turn right`;
      } else {
        instruction = `Continue on ${e.name || 'road'} for ${e.distance_km} km`;
      }

      if (hazard) {
        instruction += `. Caution: ${hazard.type.replace('_', ' ')} reported ahead`;
      }

      steps.push({
        index: i,
        edgeId: e.edge_id,
        roadName: e.name || e.edge_id,
        distanceKm: e.distance_km,
        safetyScore: e.safety_score,
        riskBand: e.risk_band,
        maneuver,
        maneuverIcon: icon,
        instruction,
        startCoords: [startCoord[0], startCoord[1]],
        endCoords: [endCoord[0], endCoord[1]],
        hazardAhead: hazard,
      });
    }

    return steps;
  };

  // Shared progress calculation for both Live GPS and Simulation
  const updateProgress = useCallback((
    curLat: number,
    curLng: number,
    traveledMeters: number,
    speedKmh: number,
    targetBearing: number,
    accuracyM = 5
  ) => {
    const totalMeters = totalRouteMetersRef.current;
    currentTraveledMetersRef.current = traveledMeters;

    // Check Destination Arrival
    if (traveledMeters >= totalMeters - 25) {
      setDrivingState((prev) => ({
        ...prev,
        hasArrived: true,
        speedKmh: 0,
        distanceToTurnM: 0,
        distanceRemainingKm: 0,
        timeRemainingMin: 0,
        currentCoords: [curLat, curLng],
      }));
      speak('You have safely arrived at your destination! RoadSafe AI navigation complete.', true);
      return;
    }

    // Smooth bearing
    const diff = angleDifference(targetBearing, currentBearingRef.current);
    const smoothedBearing = (currentBearingRef.current + diff * 0.25 + 360) % 360;
    currentBearingRef.current = smoothedBearing;

    // Distance & time remaining
    const remMeters = Math.max(0, totalMeters - traveledMeters);
    const remKm = Number((remMeters / 1000).toFixed(1));
    const effectiveSpeed = Math.max(20, speedKmh || 35);
    const remTimeMin = Math.max(1, Math.round((remKm / effectiveSpeed) * 60));

    // Match upcoming turn instruction
    const turnInstructions = turnInstructionsRef.current;
    let activeTurnText = '';
    let distToTurn = 500;
    let nextTurnAction = 'continue';

    if (turnInstructions && turnInstructions.length > 0) {
      for (let i = 0; i < turnInstructions.length; i++) {
        const tInst = turnInstructions[i];
        const tDist = getDistanceMeters(curLat, curLng, tInst.location[1], tInst.location[0]);
        if (tDist > 25) {
          activeTurnText = tInst.instruction;
          distToTurn = Math.round(tDist);
          nextTurnAction = tInst.action;

          // Voice triggers at 250m and 45m before turn
          const turnKey250 = `${tInst.instruction}-250`;
          const turnKey45 = `${tInst.instruction}-45`;

          if (distToTurn <= 250 && distToTurn > 60 && lastSpokenTurnKeyRef.current !== turnKey250) {
            lastSpokenTurnKeyRef.current = turnKey250;
            speak(`In 250 meters, ${tInst.instruction}`);
          } else if (distToTurn <= 45 && lastSpokenTurnKeyRef.current !== turnKey45) {
            lastSpokenTurnKeyRef.current = turnKey45;
            speak(tInst.instruction);
          }
          break;
        }
      }
    }

    // Step matching
    const steps = stepsRef.current;
    let activeStep = steps[0] || null;
    let stepIdx = 0;
    for (let s = 0; s < steps.length; s++) {
      const step = steps[s];
      const dStart = getDistanceMeters(curLat, curLng, step.startCoords[1], step.startCoords[0]);
      const dEnd = getDistanceMeters(curLat, curLng, step.endCoords[1], step.endCoords[0]);
      if (dStart <= step.distanceKm * 1000 && dEnd > 15) {
        activeStep = step;
        stepIdx = s;
        break;
      }
    }

    setDrivingState((prev) => ({
      ...prev,
      currentCoords: [curLat, curLng],
      bearing: Math.round(smoothedBearing),
      speedKmh,
      accuracyM,
      stepIndex: stepIdx,
      currentStep: activeStep,
      currentTurnInstruction: activeTurnText || prev.currentTurnInstruction || 'Continue straight along corridor',
      distanceToTurnM: distToTurn,
      distanceRemainingKm: remKm,
      timeRemainingMin: remTimeMin,
    }));
  }, [speak]);

  // Handle GPS location update from live hardware / browser
  const handleGpsUpdate = useCallback((
    lat: number,
    lng: number,
    rawSpeed: number | null,
    rawHeading: number | null,
    accuracy = 5
  ) => {
    const route = activeRouteRef.current;
    if (!route || !route.coordinates || route.coordinates.length < 2) return;

    const coords = route.coordinates;
    const dists = polylineDistancesRef.current;

    // Map-matching: find nearest point along active polyline
    let minPerpDist = Infinity;
    let closestTraveledMeters = 0;
    let snappedLat = lat;
    let snappedLng = lng;
    let tangentBearing = rawHeading !== null ? rawHeading : 0;

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const segLen = getDistanceMeters(p1[1], p1[0], p2[1], p2[0]);
      if (segLen === 0) continue;

      const d1 = getDistanceMeters(lat, lng, p1[1], p1[0]);
      const d2 = getDistanceMeters(lat, lng, p2[1], p2[0]);

      // Projection parameter t
      const t = Math.max(0, Math.min(1, (d1 * d1 - d2 * d2 + segLen * segLen) / (2 * segLen * segLen)));
      const projLat = p1[1] + t * (p2[1] - p1[1]);
      const projLng = p1[0] + t * (p2[0] - p1[0]);
      const perpDist = getDistanceMeters(lat, lng, projLat, projLng);

      if (perpDist < minPerpDist) {
        minPerpDist = perpDist;
        snappedLat = projLat;
        snappedLng = projLng;
        closestTraveledMeters = (dists[i] || 0) + t * segLen;
        tangentBearing = getBearing(p1[1], p1[0], p2[1], p2[0]);
      }
    }

    // Map-matching guard: check if device is off-route (> 40m)
    if (minPerpDist > 40.0) {
      offRouteCountRef.current += 1;
      if (offRouteCountRef.current >= 3) {
        const now = Date.now();
        if (now - lastRerouteTimeRef.current > 10000) {
          lastRerouteTimeRef.current = now;
          setDrivingState((prev) => ({ ...prev, isOffRoute: true }));
          speak('You are off route. Recalculating safest route from your current location.');
          onRecalculate?.();
        }
      }
    } else {
      offRouteCountRef.current = 0;
      setDrivingState((prev) => ({ ...prev, isOffRoute: false }));
    }

    // Calculate speed
    const now = Date.now();
    let speedKmh = rawSpeed !== null ? Math.round(rawSpeed * 3.6) : 0;
    if (prevGpsPosRef.current && speedKmh === 0) {
      const prev = prevGpsPosRef.current;
      const dtSec = Math.max(0.5, (now - prev.time) / 1000);
      const movedMeters = getDistanceMeters(lat, lng, prev.lat, prev.lng);
      if (movedMeters > 1.5) {
        speedKmh = Math.round((movedMeters / dtSec) * 3.6);
      }
    }
    prevGpsPosRef.current = { lat, lng, time: now };

    const effectiveBearing = rawHeading !== null ? rawHeading : tangentBearing;
    updateProgress(snappedLat, snappedLng, closestTraveledMeters, speedKmh, effectiveBearing, accuracy);
  }, [speak, onRecalculate, updateProgress]);

  // Start Navigation
  const startNavigation = useCallback((
    route: RouteAlternative,
    hazards: HazardReport[] = [],
    simulate = false // default to live GPS driving mode
  ) => {
    activeRouteRef.current = route;
    hazardsRef.current = hazards;
    turnInstructionsRef.current = route.turn_instructions || [];

    const coords = route.coordinates || [];
    if (!coords.length) return;

    precomputePolylineDistances(coords);
    currentTraveledMetersRef.current = 0;
    offRouteCountRef.current = 0;
    lastSpokenTurnKeyRef.current = '';

    const steps = buildSteps(route, hazards);
    stepsRef.current = steps;

    const initialCoords: [number, number] = [coords[0][1], coords[0][0]];
    const initialBearing = coords.length >= 2
      ? getBearing(coords[0][1], coords[0][0], coords[1][1], coords[1][0])
      : 0;
    currentBearingRef.current = initialBearing;

    const initialInstruction = (route.turn_instructions && route.turn_instructions[0]?.instruction)
      || (steps[0]?.instruction)
      || 'Head towards your destination';

    setDrivingState({
      isNavigating: true,
      isSimulating: simulate,
      simulationMultiplier: 2,
      currentCoords: initialCoords,
      bearing: initialBearing,
      speedKmh: simulate ? 45 : 0,
      accuracyM: 5,
      stepIndex: 0,
      currentStep: steps[0] || null,
      currentTurnInstruction: initialInstruction,
      distanceToTurnM: Math.round((route.turn_instructions && route.turn_instructions[0]?.distance_km || 1) * 1000),
      distanceRemainingKm: route.distance_km,
      timeRemainingMin: Math.round(route.estimated_travel_minutes),
      isMuted: false,
      hasArrived: false,
      isOffRoute: false,
      isFollowingCamera: true,
    });

    speak(`Starting RoadSafe navigation. ${initialInstruction}`);
  }, [speak]);

  // Stop Navigation
  const stopNavigation = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    window.speechSynthesis?.cancel();

    setDrivingState((prev) => ({
      ...prev,
      isNavigating: false,
      isSimulating: false,
      hasArrived: false,
      isOffRoute: false,
    }));
  }, []);

  // Toggle Mute
  const toggleMute = useCallback(() => {
    setDrivingState((prev) => {
      const nextMuted = !prev.isMuted;
      if (nextMuted) window.speechSynthesis?.cancel();
      return { ...prev, isMuted: nextMuted };
    });
  }, []);

  // Toggle Simulation Speed (1x, 2x, 5x)
  const setSimulationMultiplier = useCallback((multiplier: number) => {
    setDrivingState((prev) => ({
      ...prev,
      simulationMultiplier: multiplier,
      speedKmh: Math.round(35 * multiplier),
    }));
  }, []);

  // Toggle Simulation on/off (Live GPS vs Demo Simulation)
  const toggleSimulation = useCallback(() => {
    setDrivingState((prev) => {
      const nextSim = !prev.isSimulating;
      return { ...prev, isSimulating: nextSim, isFollowingCamera: true };
    });
  }, []);

  // Toggle Camera Auto-Follow
  const toggleFollowCamera = useCallback((follow?: boolean) => {
    setDrivingState((prev) => ({
      ...prev,
      isFollowingCamera: follow !== undefined ? follow : !prev.isFollowingCamera,
    }));
  }, []);

  // Watch GPS during live navigation
  useEffect(() => {
    if (!drivingState.isNavigating || drivingState.isSimulating) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!('geolocation' in navigator)) {
      console.warn('Geolocation not supported, falling back to simulation.');
      setDrivingState((prev) => ({ ...prev, isSimulating: true }));
      return;
    }

    const handleSuccess = (pos: GeolocationPosition) => {
      handleGpsUpdate(
        pos.coords.latitude,
        pos.coords.longitude,
        pos.coords.speed,
        pos.coords.heading,
        Math.round(pos.coords.accuracy)
      );
    };

    const handleError = (err: GeolocationPositionError) => {
      console.warn('Live navigation GPS error:', err.message);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    });

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [drivingState.isNavigating, drivingState.isSimulating, handleGpsUpdate]);

  // Simulation Animation Loop following exact polyline curvature
  useEffect(() => {
    if (!drivingState.isNavigating || !drivingState.isSimulating) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    let lastTimestamp = performance.now();

    const animate = (timestamp: number) => {
      const deltaMs = Math.min(100, timestamp - lastTimestamp);
      lastTimestamp = timestamp;

      const route = activeRouteRef.current;
      const coords = route?.coordinates;
      const dists = polylineDistancesRef.current;
      const totalMeters = totalRouteMetersRef.current;

      if (!coords || coords.length < 2 || totalMeters <= 0) return;

      const multiplier = drivingState.simulationMultiplier || 2;
      const speedMps = 12.5 * multiplier; // 45 km/h at 1x
      const traveled = currentTraveledMetersRef.current + (speedMps * deltaMs) / 1000;

      // Binary search segment
      let low = 0;
      let high = dists.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (dists[mid] <= traveled) low = mid + 1;
        else high = mid - 1;
      }
      const segIdx = Math.max(0, Math.min(coords.length - 2, high));
      const segStartDist = dists[segIdx];
      const segEndDist = dists[segIdx + 1];
      const segLen = Math.max(0.1, segEndDist - segStartDist);
      const segT = Math.max(0, Math.min(1, (traveled - segStartDist) / segLen));

      const p1 = coords[segIdx];
      const p2 = coords[segIdx + 1];

      const curLat = p1[1] + segT * (p2[1] - p1[1]);
      const curLng = p1[0] + segT * (p2[0] - p1[0]);
      const segBearing = getBearing(p1[1], p1[0], p2[1], p2[0]);

      updateProgress(curLat, curLng, traveled, Math.round(35 * multiplier), segBearing, 0);

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [drivingState.isNavigating, drivingState.isSimulating, drivingState.simulationMultiplier, updateProgress]);

  return {
    drivingState,
    startNavigation,
    stopNavigation,
    toggleMute,
    toggleSimulation,
    setSimulationMultiplier,
    toggleFollowCamera,
  };
}

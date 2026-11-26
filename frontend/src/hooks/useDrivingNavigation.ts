import { useState, useEffect, useRef, useCallback } from 'react';
import { RouteAlternative, HazardReport } from '../types';
import {
  NavigationEngine,
  NavigationSnapshot,
  NavigationStep,
  PositionFix,
  computeCumulativeDistances,
  getDistanceMeters,
} from '../services/navigationEngine';

export type { NavigationStep };

export interface DrivingState {
  isNavigating: boolean;
  isPaused: boolean;
  isDemoDrive: boolean;
  simulationMultiplier: number;
  currentCoords: [number, number] | null; // [lat, lng]
  bearing: number;
  speedKmh: number;
  accuracyM: number;
  stepIndex: number;
  currentStep: NavigationStep | null;
  nextStep: NavigationStep | null;
  currentTurnInstruction: string;
  nextRoadName: string;
  laneHint: string;
  distanceToTurnM: number;
  distanceRemainingKm: number;
  timeRemainingMin: number;
  arrivalTimestamp: number;
  upcomingHazard: { hazard: HazardReport; distanceAheadM: number } | null;
  isMuted: boolean;
  hasArrived: boolean;
  isOffRoute: boolean;
  isRerouting: boolean;
  isFollowingCamera: boolean;
  wakeLockActive: boolean;
  gpsError: { code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED'; message: string } | null;
}

const INITIAL_DRIVING_STATE: DrivingState = {
  isNavigating: false,
  isPaused: false,
  isDemoDrive: false,
  simulationMultiplier: 2,
  currentCoords: null,
  bearing: 0,
  speedKmh: 0,
  accuracyM: 5,
  stepIndex: 0,
  currentStep: null,
  nextStep: null,
  currentTurnInstruction: '',
  nextRoadName: '',
  laneHint: '',
  distanceToTurnM: 0,
  distanceRemainingKm: 0,
  timeRemainingMin: 0,
  arrivalTimestamp: Date.now(),
  upcomingHazard: null,
  isMuted: false,
  hasArrived: false,
  isOffRoute: false,
  isRerouting: false,
  isFollowingCamera: true,
  wakeLockActive: false,
  gpsError: null,
};

export const IS_DEV_BUILD = import.meta.env.DEV;

export function useDrivingNavigation(
  onOffRouteReroute?: (snappedOrCurrentOrigin: { lat: number; lng: number }) => Promise<RouteAlternative | null>
) {
  const [drivingState, setDrivingState] = useState<DrivingState>(INITIAL_DRIVING_STATE);

  const engineRef = useRef<NavigationEngine | null>(null);
  const activeRouteRef = useRef<RouteAlternative | null>(null);
  const hazardsRef = useRef<HazardReport[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const demoAnimRef = useRef<number | null>(null);
  const demoDistRef = useRef<number>(0);
  const demoCumDistsRef = useRef<number[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isMutedRef = useRef<boolean>(false);
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef<boolean>(false);
  const rerouteInFlightRef = useRef<boolean>(false);
  const [gpsRetryToken, setGpsRetryToken] = useState(0);

  // Web Speech API sequential queue (never overlaps, supports mute and cancel stale)
  const processSpeechQueue = useCallback(() => {
    if (isMutedRef.current || !('speechSynthesis' in window)) {
      speechQueueRef.current = [];
      isSpeakingRef.current = false;
      return;
    }
    if (isSpeakingRef.current || speechQueueRef.current.length === 0) return;

    const text = speechQueueRef.current.shift()!;
    isSpeakingRef.current = true;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => {
      isSpeakingRef.current = false;
      processSpeechQueue();
    };
    utterance.onerror = () => {
      isSpeakingRef.current = false;
      processSpeechQueue();
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  const enqueueAnnouncements = useCallback(
    (messages: string[], cancelStale = false) => {
      if (isMutedRef.current || !('speechSynthesis' in window) || messages.length === 0) return;
      if (cancelStale) {
        window.speechSynthesis.cancel();
        speechQueueRef.current = [];
        isSpeakingRef.current = false;
      }
      for (const msg of messages) {
        if (!speechQueueRef.current.includes(msg)) {
          speechQueueRef.current.push(msg);
        }
      }
      processSpeechQueue();
    },
    [processSpeechQueue]
  );

  // Screen Wake Lock management
  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        const sentinel = await navigator.wakeLock.request('screen');
        wakeLockRef.current = sentinel;
        setDrivingState((prev) => ({ ...prev, wakeLockActive: true }));
        sentinel.addEventListener('release', () => {
          setDrivingState((prev) => ({ ...prev, wakeLockActive: false }));
        });
      }
    } catch {
      setDrivingState((prev) => ({ ...prev, wakeLockActive: false }));
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // ignore
    }
    setDrivingState((prev) => ({ ...prev, wakeLockActive: false }));
  }, []);

  // Re-acquire Wake Lock when tab becomes visible again
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && drivingState.isNavigating && !drivingState.isPaused) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [drivingState.isNavigating, drivingState.isPaused, acquireWakeLock]);

  // Apply snapshot from pure NavigationEngine to React state + trigger speech/reroute
  const applySnapshot = useCallback(
    (snap: NavigationSnapshot) => {
      if (snap.ignoredReason) return;

      if (snap.announcements.length > 0) {
        const urgent = snap.shouldReroute || snap.hasArrived;
        enqueueAnnouncements(snap.announcements, urgent);
      }

      setDrivingState((prev) => ({
        ...prev,
        currentCoords: snap.currentCoords,
        bearing: snap.bearing,
        speedKmh: snap.speedKmh,
        accuracyM: snap.accuracyM,
        stepIndex: snap.stepIndex,
        currentStep: snap.currentStep,
        nextStep: snap.nextStep,
        currentTurnInstruction: snap.currentTurnInstruction,
        nextRoadName: snap.nextRoadName,
        laneHint: snap.laneHint,
        distanceToTurnM: snap.distanceToTurnM,
        distanceRemainingKm: snap.distanceRemainingKm,
        timeRemainingMin: snap.timeRemainingMin,
        arrivalTimestamp: snap.arrivalTimestamp,
        upcomingHazard: snap.upcomingHazard,
        hasArrived: snap.hasArrived,
        isOffRoute: snap.isOffRoute,
        gpsError: null,
      }));

      // Trigger off-route recalculation (keeping old route visible until new route arrives)
      if (snap.shouldReroute && snap.rerouteOrigin && onOffRouteReroute && !rerouteInFlightRef.current) {
        rerouteInFlightRef.current = true;
        setDrivingState((prev) => ({ ...prev, isRerouting: true }));
        onOffRouteReroute(snap.rerouteOrigin)
          .then((newRoute) => {
            if (newRoute && newRoute.coordinates?.length) {
              activeRouteRef.current = newRoute;
              const newEngine = new NavigationEngine(newRoute, hazardsRef.current);
              engineRef.current = newEngine;
              demoDistRef.current = 0;
              demoCumDistsRef.current = computeCumulativeDistances(newRoute.coordinates);
              const initSnap = newEngine.getInitialSnapshot();
              enqueueAnnouncements(['Route updated. ' + initSnap.currentTurnInstruction], true);
              setDrivingState((prev) => ({
                ...prev,
                isOffRoute: false,
                isRerouting: false,
                stepIndex: initSnap.stepIndex,
                currentStep: initSnap.currentStep,
                nextStep: initSnap.nextStep,
                currentTurnInstruction: initSnap.currentTurnInstruction,
                nextRoadName: initSnap.nextRoadName,
                laneHint: initSnap.laneHint,
                distanceToTurnM: initSnap.distanceToTurnM,
                distanceRemainingKm: initSnap.distanceRemainingKm,
                timeRemainingMin: initSnap.timeRemainingMin,
                arrivalTimestamp: initSnap.arrivalTimestamp,
              }));
            } else {
              setDrivingState((prev) => ({ ...prev, isRerouting: false }));
            }
          })
          .catch(() => {
            setDrivingState((prev) => ({ ...prev, isRerouting: false }));
          })
          .finally(() => {
            rerouteInFlightRef.current = false;
          });
      }
    },
    [enqueueAnnouncements, onOffRouteReroute]
  );

  // Inject any PositionFix (shared by real GPS watchPosition AND dev-only Demo Drive)
  const injectPositionFix = useCallback(
    (fix: PositionFix) => {
      if (!engineRef.current) return;
      const snap = engineRef.current.processPositionFix(fix);
      applySnapshot(snap);
    },
    [applySnapshot]
  );

  const startNavigation = useCallback(
    (route: RouteAlternative, hazards: HazardReport[] = [], demoDrive = false) => {
      if (!route.coordinates || route.coordinates.length === 0) return;
      // Production builds never auto-simulate
      const useDemo = IS_DEV_BUILD && demoDrive;

      activeRouteRef.current = route;
      hazardsRef.current = hazards;
      const engine = new NavigationEngine(route, hazards);
      engineRef.current = engine;
      demoDistRef.current = 0;
      demoCumDistsRef.current = computeCumulativeDistances(route.coordinates);
      rerouteInFlightRef.current = false;

      const initSnap = engine.getInitialSnapshot();
      isMutedRef.current = false;

      setDrivingState({
        ...INITIAL_DRIVING_STATE,
        isNavigating: true,
        isPaused: false,
        isDemoDrive: useDemo,
        simulationMultiplier: 2,
        currentCoords: initSnap.currentCoords,
        bearing: initSnap.bearing,
        speedKmh: 0,
        accuracyM: initSnap.accuracyM,
        stepIndex: initSnap.stepIndex,
        currentStep: initSnap.currentStep,
        nextStep: initSnap.nextStep,
        currentTurnInstruction: initSnap.currentTurnInstruction,
        nextRoadName: initSnap.nextRoadName,
        laneHint: initSnap.laneHint,
        distanceToTurnM: initSnap.distanceToTurnM,
        distanceRemainingKm: initSnap.distanceRemainingKm,
        timeRemainingMin: initSnap.timeRemainingMin,
        arrivalTimestamp: initSnap.arrivalTimestamp,
        isFollowingCamera: true,
      });

      enqueueAnnouncements(initSnap.announcements, true);
      acquireWakeLock();
    },
    [acquireWakeLock, enqueueAnnouncements]
  );

  const stopNavigation = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (demoAnimRef.current !== null) {
      cancelAnimationFrame(demoAnimRef.current);
      demoAnimRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    speechQueueRef.current = [];
    isSpeakingRef.current = false;
    engineRef.current = null;
    releaseWakeLock();

    setDrivingState(INITIAL_DRIVING_STATE);
  }, [releaseWakeLock]);

  const pauseNavigation = useCallback(() => {
    engineRef.current?.setPaused(true);
    releaseWakeLock();
    setDrivingState((prev) => ({ ...prev, isPaused: true, speedKmh: 0 }));
  }, [releaseWakeLock]);

  const resumeNavigation = useCallback(() => {
    engineRef.current?.setPaused(false);
    acquireWakeLock();
    setDrivingState((prev) => ({ ...prev, isPaused: false }));
  }, [acquireWakeLock]);

  const toggleMute = useCallback(() => {
    setDrivingState((prev) => {
      const nextMuted = !prev.isMuted;
      isMutedRef.current = nextMuted;
      if (nextMuted && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        speechQueueRef.current = [];
        isSpeakingRef.current = false;
      }
      return { ...prev, isMuted: nextMuted };
    });
  }, []);

  const toggleDemoDrive = useCallback(() => {
    if (!IS_DEV_BUILD) return;
    setDrivingState((prev) => ({
      ...prev,
      isDemoDrive: !prev.isDemoDrive,
      isFollowingCamera: true,
      gpsError: null,
    }));
  }, []);

  const setSimulationMultiplier = useCallback((multiplier: number) => {
    setDrivingState((prev) => ({
      ...prev,
      simulationMultiplier: multiplier,
    }));
  }, []);

  const toggleFollowCamera = useCallback((follow?: boolean) => {
    setDrivingState((prev) => ({
      ...prev,
      isFollowingCamera: follow !== undefined ? follow : !prev.isFollowingCamera,
    }));
  }, []);

  const retryGps = useCallback(() => {
    setDrivingState((prev) => ({ ...prev, gpsError: null }));
    setGpsRetryToken((t) => t + 1);
  }, []);

  // Real GPS position source via navigator.geolocation.watchPosition
  useEffect(() => {
    if (!drivingState.isNavigating || drivingState.isDemoDrive || drivingState.isPaused) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!('geolocation' in navigator)) {
      setDrivingState((prev) => ({
        ...prev,
        gpsError: {
          code: 'UNSUPPORTED',
          message: 'Geolocation is not supported by your browser.',
        },
      }));
      return;
    }

    const handleSuccess = (pos: GeolocationPosition) => {
      injectPositionFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        speedMps: pos.coords.speed,
        headingDeg: pos.coords.heading,
        timestamp: pos.timestamp || Date.now(),
      });
    };

    const handleError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        setDrivingState((prev) => ({
          ...prev,
          gpsError: {
            code: 'PERMISSION_DENIED',
            message: 'Location permission denied. Enable GPS access in browser settings and tap Retry.',
          },
        }));
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        setDrivingState((prev) => ({
          ...prev,
          gpsError: {
            code: 'POSITION_UNAVAILABLE',
            message: 'GPS signal unavailable. Move to an open area or check device location services.',
          },
        }));
      } else if (err.code === err.TIMEOUT) {
        setDrivingState((prev) => ({
          ...prev,
          gpsError: {
            code: 'TIMEOUT',
            message: 'GPS fix timed out. Tap Retry to reacquire location.',
          },
        }));
      }
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
  }, [drivingState.isNavigating, drivingState.isDemoDrive, drivingState.isPaused, gpsRetryToken, injectPositionFix]);

  // Dev-only Demo Drive: injects synthetic GPS fixes into the SAME NavigationEngine
  useEffect(() => {
    if (!IS_DEV_BUILD || !drivingState.isNavigating || !drivingState.isDemoDrive || drivingState.isPaused) {
      if (demoAnimRef.current !== null) {
        cancelAnimationFrame(demoAnimRef.current);
        demoAnimRef.current = null;
      }
      return;
    }

    let lastTimestamp = performance.now();
    let lastEmitTime = 0;

    const tick = (now: number) => {
      const deltaMs = Math.min(100, now - lastTimestamp);
      lastTimestamp = now;

      const coords = activeRouteRef.current?.coordinates;
      const dists = demoCumDistsRef.current;
      const totalMeters = dists[dists.length - 1] || 0;

      if (!coords || coords.length < 2 || totalMeters <= 0) return;

      const speedMps = 12.5 * (drivingState.simulationMultiplier || 2);
      demoDistRef.current = Math.min(totalMeters, demoDistRef.current + (speedMps * deltaMs) / 1000);

      // Emit synthetic fix ~10 times per second to the real NavigationEngine
      if (now - lastEmitTime >= 100 || demoDistRef.current >= totalMeters) {
        lastEmitTime = now;
        let segIdx = 0;
        for (let i = 0; i < dists.length - 1; i++) {
          if (dists[i + 1] >= demoDistRef.current) {
            segIdx = i;
            break;
          }
          segIdx = i;
        }
        const segStart = dists[segIdx] ?? 0;
        const segEnd = dists[segIdx + 1] ?? segStart;
        const segLen = Math.max(0.1, segEnd - segStart);
        const t = Math.max(0, Math.min(1, (demoDistRef.current - segStart) / segLen));
        const p1 = coords[segIdx];
        const p2 = coords[segIdx + 1] || p1;

        const lat = p1[1] + t * (p2[1] - p1[1]);
        const lng = p1[0] + t * (p2[0] - p1[0]);
        const segDist = getDistanceMeters(p1[1], p1[0], p2[1], p2[0]);

        injectPositionFix({
          lat,
          lng,
          accuracyM: 5,
          speedMps: segDist > 0 ? speedMps : 0,
          headingDeg: null,
          timestamp: Date.now(),
        });
      }

      if (demoDistRef.current < totalMeters) {
        demoAnimRef.current = requestAnimationFrame(tick);
      }
    };

    demoAnimRef.current = requestAnimationFrame(tick);
    return () => {
      if (demoAnimRef.current !== null) cancelAnimationFrame(demoAnimRef.current);
    };
  }, [drivingState.isNavigating, drivingState.isDemoDrive, drivingState.isPaused, drivingState.simulationMultiplier, injectPositionFix]);

  return {
    drivingState,
    startNavigation,
    stopNavigation,
    pauseNavigation,
    resumeNavigation,
    toggleMute,
    toggleDemoDrive,
    setSimulationMultiplier,
    toggleFollowCamera,
    retryGps,
  };
}

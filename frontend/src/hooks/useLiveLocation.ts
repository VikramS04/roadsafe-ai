import { useState, useEffect, useRef, useCallback } from 'react';

export interface LiveLocationState {
  coords: { lat: number; lng: number } | null;
  heading: number | null; // 0 - 360 degrees
  speedKmh: number | null; // km/h
  accuracyM: number | null; // accuracy radius in meters
  timestamp: number | null;
  isTracking: boolean;
  isFollowing: boolean; // whether map camera auto-follows this location
  error: string | null;
}

export function useLiveLocation() {
  const [state, setState] = useState<LiveLocationState>({
    coords: null,
    heading: null,
    speedKmh: null,
    accuracyM: null,
    timestamp: null,
    isTracking: false,
    isFollowing: true,
    error: null,
  });

  const watchIdRef = useRef<number | null>(null);
  const prevPositionRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  // Start continuous watchPosition
  const startTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState((prev) => ({
        ...prev,
        error: 'Geolocation is not supported by your browser.',
        isTracking: false,
      }));
      return;
    }

    if (watchIdRef.current !== null) return; // already watching

    setState((prev) => ({ ...prev, isTracking: true, error: null }));

    const handleSuccess = (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const rawSpeed = pos.coords.speed; // m/s or null
      const rawHeading = pos.coords.heading; // degrees or null
      const accuracy = pos.coords.accuracy; // meters
      const now = pos.timestamp || Date.now();

      let calcSpeedKmh: number | null = rawSpeed !== null ? Math.round(rawSpeed * 3.6) : null;
      let calcHeading = rawHeading;

      // If browser doesn't provide speed or heading, compute from previous GPS fix
      if (prevPositionRef.current) {
        const prev = prevPositionRef.current;
        const dtSec = Math.max(0.5, (now - prev.time) / 1000);

        // Approximate distance in meters
        const dLat = (lat - prev.lat) * 111320;
        const dLng = (lng - prev.lng) * (111320 * Math.cos((lat * Math.PI) / 180));
        const distM = Math.sqrt(dLat * dLat + dLng * dLng);

        if (calcSpeedKmh === null && distM > 1.5) {
          calcSpeedKmh = Math.round((distM / dtSec) * 3.6);
        }

        if (calcHeading === null && distM > 3.0) {
          const θ = Math.atan2(dLng, dLat);
          calcHeading = ((θ * 180) / Math.PI + 360) % 360;
        }
      }

      prevPositionRef.current = { lat, lng, time: now };

      setState((prev) => ({
        ...prev,
        coords: { lat, lng },
        heading: calcHeading,
        speedKmh: calcSpeedKmh,
        accuracyM: Math.round(accuracy),
        timestamp: now,
        isTracking: true,
        error: null,
      }));
    };

    const handleError = (err: GeolocationPositionError) => {
      let msg = 'Unable to retrieve your location.';
      if (err.code === err.PERMISSION_DENIED) {
        msg = 'Location permission was denied. Please allow location access in your browser settings.';
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        msg = 'Location position unavailable. Waiting for GPS fix...';
      } else if (err.code === err.TIMEOUT) {
        msg = 'Location request timed out. Retrying...';
      }
      setState((prev) => ({ ...prev, error: msg }));
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    });
  }, []);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState((prev) => ({ ...prev, isTracking: false }));
  }, []);

  const setFollowing = useCallback((isFollowing: boolean) => {
    setState((prev) => ({ ...prev, isFollowing }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return {
    locationState: state,
    startTracking,
    stopTracking,
    setFollowing,
  };
}

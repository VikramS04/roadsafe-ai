interface CachedWeather {
  timestamp: number;
  data: WeatherConditions;
}

export interface WeatherConditions {
  latitude: number;
  longitude: number;
  currentPrecipitationMm: number | null;
  currentRainMm: number | null;
  weatherCode: number | null;
  conditionDescription: string;
  source: 'open-meteo' | 'unavailable';
  isStale: boolean;
  unavailable: boolean;
  fetchedAt: string | null;
  error?: string;
}

const weatherCache = new Map<string, CachedWeather>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch live weather from Open-Meteo (free, no API key required).
 * Caches responses per rounded lat/lng grid cell (~0.1 deg) for 30 minutes.
 * Never fabricates weather or timestamps on failure: serves stale cache if available,
 * otherwise returns unavailable: true with fetchedAt: null.
 */
export async function getLiveWeather(lat: number = 25.4, lng: number = 91.8): Promise<WeatherConditions> {
  const roundedLat = Math.round(lat * 10) / 10;
  const roundedLng = Math.round(lng * 10) / 10;
  const cacheKey = `${roundedLat},${roundedLng}`;

  const cached = weatherCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLng}&current=precipitation,rain,weather_code&hourly=precipitation&forecast_days=1`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Open-Meteo responded with status ${res.status}`);
    }

    const json: any = await res.json();
    const current = json.current || {};

    const precipitation = typeof current.precipitation === 'number' ? current.precipitation : 0.0;
    const rain = typeof current.rain === 'number' ? current.rain : 0.0;
    const code = typeof current.weather_code === 'number' ? current.weather_code : 0;

    let desc = 'Clear';
    if (code >= 80) desc = 'Rain Showers';
    else if (code >= 60) desc = 'Rain';
    else if (code >= 51) desc = 'Drizzle';
    else if (code >= 45) desc = 'Fog';
    else if (code >= 1) desc = 'Partly Cloudy';

    const result: WeatherConditions = {
      latitude: roundedLat,
      longitude: roundedLng,
      currentPrecipitationMm: precipitation,
      currentRainMm: rain,
      weatherCode: code,
      conditionDescription: desc,
      source: 'open-meteo',
      isStale: false,
      unavailable: false,
      fetchedAt: new Date().toISOString(),
    };

    weatherCache.set(cacheKey, { timestamp: now, data: result });
    return result;
  } catch (error: any) {
    console.warn(`Weather fetch failed for ${cacheKey}:`, error?.message || error);
    if (cached) {
      return {
        ...cached.data,
        isStale: true,
        unavailable: false,
        error: 'Live weather refresh failed; showing last known cached observation.',
      };
    }

    return {
      latitude: roundedLat,
      longitude: roundedLng,
      currentPrecipitationMm: null,
      currentRainMm: null,
      weatherCode: null,
      conditionDescription: 'Weather data unavailable',
      source: 'unavailable',
      isStale: true,
      unavailable: true,
      fetchedAt: null,
      error: 'Unable to reach Open-Meteo weather provider.',
    };
  }
}

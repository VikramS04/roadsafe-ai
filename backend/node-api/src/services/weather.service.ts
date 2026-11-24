interface CachedWeather {
  timestamp: number;
  data: WeatherConditions;
}

export interface WeatherConditions {
  latitude: number;
  longitude: number;
  currentPrecipitationMm: number;
  currentRainMm: number;
  weatherCode: number;
  conditionDescription: string;
  isStale: boolean;
  fetchedAt: string;
}

const weatherCache = new Map<string, CachedWeather>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch live weather from Open-Meteo (free, no API key required)
 * Caches responses per rounded lat/lng grid cell (~0.1 deg ~11km) for 30 minutes.
 * Fallback to safe defaults on network error with isStale: true.
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

    const precipitation = current.precipitation || 0.0;
    const rain = current.rain || 0.0;
    const code = current.weather_code || 0;

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
      isStale: false,
      fetchedAt: new Date().toISOString(),
    };

    weatherCache.set(cacheKey, { timestamp: now, data: result });
    return result;
  } catch (error) {
    console.warn(`Weather fetch failed for ${cacheKey}, serving cached or default conditions:`, error);
    if (cached) {
      return { ...cached.data, isStale: true };
    }

    // Default safe baseline for Meghalaya region
    return {
      latitude: roundedLat,
      longitude: roundedLng,
      currentPrecipitationMm: 0.0,
      currentRainMm: 0.0,
      weatherCode: 0,
      conditionDescription: 'Normal (Offline Cache)',
      isStale: true,
      fetchedAt: new Date().toISOString(),
    };
  }
}

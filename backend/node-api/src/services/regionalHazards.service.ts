import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REFRESH_INTERVAL_MS = (parseInt(process.env.HAZARD_FEED_REFRESH_MIN || '15', 10) || 15) * 60 * 1000;
const FEED_TIMEOUT_MS = parseInt(process.env.HAZARD_FEED_TIMEOUT_MS || '6000', 10) || 6000;

export interface RegionalFeedConfig {
  id: string;
  providerName: string;
  stateRegion: string;
  rssUrl: string;
}

const DEFAULT_NDMA_FEEDS: RegionalFeedConfig[] = [
  {
    id: 'ndma_rajasthan',
    providerName: 'NDMA SACHET (IMD Jaipur / Rajasthan SDMA)',
    stateRegion: 'Rajasthan',
    rssUrl: process.env.NDMA_RAJASTHAN_RSS || 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_rajasthan.xml',
  },
  {
    id: 'ndma_uttarakhand',
    providerName: 'NDMA SACHET (IMD Dehradun / Uttarakhand SDMA)',
    stateRegion: 'Uttarakhand',
    rssUrl: process.env.NDMA_UTTARAKHAND_RSS || 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_uttarakhand.xml',
  },
  {
    id: 'ndma_himachal',
    providerName: 'NDMA SACHET (IMD Shimla / Himachal SDMA)',
    stateRegion: 'Himachal Pradesh',
    rssUrl: process.env.NDMA_HIMACHAL_RSS || 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_himachal.xml',
  },
];

const USGS_URL =
  process.env.USGS_EARTHQUAKE_URL ||
  'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=23&maxlatitude=34&minlongitude=69&maxlongitude=82&minmagnitude=3.5&limit=10';

let lastRefreshStartedAt = 0;
let refreshInFlight: Promise<void> | null = null;

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<(?:cap:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:cap:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function mapEventToHazardType(eventText: string): string {
  const e = eventText.toLowerCase();
  if (e.includes('landslide') || e.includes('avalanche')) return 'landslide';
  if (e.includes('flood') || e.includes('rain') || e.includes('thunderstorm') || e.includes('cloudburst')) return 'flooded_road';
  if (e.includes('fog') || e.includes('visibility')) return 'fog_visibility';
  if (e.includes('cold wave') || e.includes('frost') || e.includes('snow')) return 'cold_wave';
  if (e.includes('fire')) return 'forest_fire';
  if (e.includes('earthquake')) return 'earthquake';
  return 'other';
}

function mapCapSeverity(sev: string): 'low' | 'medium' | 'high' | 'critical' {
  const s = sev.toLowerCase();
  if (s === 'extreme') return 'critical';
  if (s === 'severe') return 'high';
  if (s === 'moderate') return 'medium';
  return 'low';
}

function inferStateFromCoords(lat: number, lng: number): string {
  if (lat >= 23.0 && lat <= 30.2 && lng >= 69.5 && lng <= 78.3) return 'Rajasthan';
  if (lat >= 28.7 && lat <= 31.5 && lng >= 77.5 && lng <= 81.1) return 'Uttarakhand';
  if (lat >= 30.3 && lat <= 33.3 && lng >= 75.5 && lng <= 79.1) return 'Himachal Pradesh';
  if (lat >= 25.0 && lat <= 26.2 && lng >= 89.8 && lng <= 92.8) return 'Meghalaya';
  return 'Northern/Western India';
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RoadSafe-AI/2.0)',
        Accept: 'application/xml, text/xml, application/json, */*',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function ensureSystemDevice(deviceId: string): Promise<void> {
  await prisma.deviceProfile.upsert({
    where: { deviceId },
    update: { lastActiveAt: new Date() },
    create: { deviceId, reliabilityScore: 2.0 },
  });
}

async function ingestNdmaFeed(feed: RegionalFeedConfig): Promise<void> {
  const now = new Date();
  try {
    const res = await fetchWithTimeout(feed.rssUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${feed.rssUrl}`);
    }
    const rssXml = await res.text();
    const itemBlocks = rssXml.match(/<item>[\s\S]*?<\/item>/gi) || [];

    await ensureSystemDevice('system-ndma-sachet');

    let activeCount = 0;
    // Process up to 6 most recent items per state feed to keep refresh fast & polite
    for (const item of itemBlocks.slice(0, 6)) {
      const guid = extractTag(item, 'guid');
      const link = extractTag(item, 'link');
      const pubDateStr = extractTag(item, 'pubDate');
      if (!link || !guid) continue;

      try {
        const capRes = await fetchWithTimeout(link);
        if (!capRes.ok) continue;
        const capXml = await capRes.text();

        const capId = extractTag(capXml, 'identifier') || guid;
        const sender = extractTag(capXml, 'sender') || feed.providerName;
        const infoBlocks = capXml.match(/<cap:info>[\s\S]*?<\/cap:info>/gi) || [];
        const enInfo =
          infoBlocks.find((b) => /<cap:language>\s*en/i.test(b)) || infoBlocks[0] || capXml;

        const eventName = extractTag(enInfo, 'event') || 'Weather Advisory';
        const severity = mapCapSeverity(extractTag(enInfo, 'severity'));
        const headline = extractTag(enInfo, 'headline') || extractTag(item, 'title') || eventName;
        const areaDesc = extractTag(enInfo, 'areaDesc') || feed.stateRegion;
        const effectiveStr = extractTag(enInfo, 'effective') || pubDateStr;
        const expiresStr = extractTag(enInfo, 'expires');

        const reportedAt = effectiveStr ? new Date(effectiveStr) : now;
        const expiresAt = expiresStr ? new Date(expiresStr) : new Date(reportedAt.getTime() + 24 * 3600 * 1000);
        const isExpired = expiresAt <= now;
        if (!isExpired) activeCount += 1;

        // Fetch polygon coordinates if available
        let lat = feed.stateRegion === 'Rajasthan' ? 26.9124 : feed.stateRegion === 'Uttarakhand' ? 30.3165 : 31.1048;
        let lng = feed.stateRegion === 'Rajasthan' ? 75.7873 : feed.stateRegion === 'Uttarakhand' ? 78.0322 : 77.1734;
        let geometryJson: string | null = null;

        const polyUrlMatch = capXml.match(/https?:\/\/[^<\s]+FetchPolygonXMLFile\?identifier=[^<\s]+/i);
        if (polyUrlMatch) {
          try {
            const polyRes = await fetchWithTimeout(polyUrlMatch[0]);
            if (polyRes.ok) {
              const polyXml = await polyRes.text();
              const polyStr = extractTag(polyXml, 'polygon');
              if (polyStr) {
                const rawPairs = polyStr
                  .split(/\s+/)
                  .map((p) => p.split(',').map(Number))
                  .filter((pair) => pair.length === 2 && !isNaN(pair[0]) && !isNaN(pair[1]));
                if (rawPairs.length > 0) {
                  lat = rawPairs.reduce((s, p) => s + p[0], 0) / rawPairs.length;
                  lng = rawPairs.reduce((s, p) => s + p[1], 0) / rawPairs.length;
                  // Downsample polygon to <= 40 vertices for lightweight map rendering
                  const step = Math.max(1, Math.floor(rawPairs.length / 40));
                  const ring = rawPairs.filter((_, idx) => idx % step === 0).map((p) => [p[1], p[0]]);
                  if (ring.length >= 3) {
                    ring.push(ring[0]);
                    geometryJson = JSON.stringify({ type: 'Polygon', coordinates: [ring] });
                  }
                }
              }
            }
          } catch {
            // Keep state centroid if polygon fetch fails
          }
        }

        const sourceRecordId = `ndma:${capId}`;
        await prisma.hazardReport.upsert({
          where: { sourceRecordId },
          update: {
            type: mapEventToHazardType(eventName),
            severity,
            lat,
            lng,
            status: isExpired ? 'expired' : 'confirmed',
            note: `${headline} (${sender})`,
            areaDesc,
            geometryJson,
            lastCheckedAt: now,
            expiresAt,
          },
          create: {
            type: mapEventToHazardType(eventName),
            severity,
            lat,
            lng,
            status: isExpired ? 'expired' : 'confirmed',
            source: 'ndma_sachet',
            sourceRecordId,
            isImported: true,
            stateRegion: feed.stateRegion,
            areaDesc,
            geometryJson,
            lastCheckedAt: now,
            confirmCount: 1,
            clearCount: 0,
            note: `${headline} (${sender})`,
            deviceId: 'system-ndma-sachet',
            reportedAt,
            expiresAt,
          },
        });
      } catch {
        // Skip malformed item cleanly without failing the whole feed
      }
    }

    await prisma.hazardSourceStatus.upsert({
      where: { id: feed.id },
      update: {
        providerName: feed.providerName,
        stateRegion: feed.stateRegion,
        status: activeCount > 0 ? 'hazards_reported' : 'no_records',
        recordCount: activeCount,
        lastCheckedAt: now,
        lastSuccessAt: now,
        errorMessage: null,
      },
      create: {
        id: feed.id,
        providerName: feed.providerName,
        stateRegion: feed.stateRegion,
        status: activeCount > 0 ? 'hazards_reported' : 'no_records',
        recordCount: activeCount,
        lastCheckedAt: now,
        lastSuccessAt: now,
      },
    });
  } catch (err: any) {
    await prisma.hazardSourceStatus.upsert({
      where: { id: feed.id },
      update: {
        status: 'unavailable',
        lastCheckedAt: now,
        errorMessage: err?.message || 'Feed unavailable',
      },
      create: {
        id: feed.id,
        providerName: feed.providerName,
        stateRegion: feed.stateRegion,
        status: 'unavailable',
        recordCount: 0,
        lastCheckedAt: now,
        errorMessage: err?.message || 'Feed unavailable',
      },
    });
  }
}

async function ingestUsgsEarthquakes(): Promise<void> {
  const now = new Date();
  const id = 'usgs_india';
  const providerName = 'USGS Earthquake Hazards Program (M>=3.5, N/W India)';
  try {
    const res = await fetchWithTimeout(USGS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} from USGS`);
    const data: any = await res.json();
    const features: any[] = data?.features || [];

    await ensureSystemDevice('system-usgs');

    let activeCount = 0;
    for (const f of features) {
      const coords = f?.geometry?.coordinates;
      const props = f?.properties;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      const mag = Number(props?.mag || 0);
      const timeMs = Number(props?.time || now.getTime());
      const reportedAt = new Date(timeMs);
      const expiresAt = new Date(timeMs + 48 * 3600 * 1000);
      const isExpired = expiresAt <= now;
      if (!isExpired) activeCount += 1;

      const severity = mag >= 5.5 ? 'critical' : mag >= 4.5 ? 'high' : 'medium';
      const sourceRecordId = `usgs:${f.id}`;
      const stateRegion = inferStateFromCoords(lat, lng);

      await prisma.hazardReport.upsert({
        where: { sourceRecordId },
        update: {
          severity,
          status: isExpired ? 'expired' : 'confirmed',
          lastCheckedAt: now,
          expiresAt,
        },
        create: {
          type: 'earthquake',
          severity,
          lat,
          lng,
          status: isExpired ? 'expired' : 'confirmed',
          source: 'usgs',
          sourceRecordId,
          isImported: true,
          stateRegion,
          areaDesc: props?.place || stateRegion,
          lastCheckedAt: now,
          confirmCount: 1,
          clearCount: 0,
          note: `M${mag.toFixed(1)} Earthquake — ${props?.place || 'Northern/Western India'}`,
          deviceId: 'system-usgs',
          reportedAt,
          expiresAt,
        },
      });
    }

    await prisma.hazardSourceStatus.upsert({
      where: { id },
      update: {
        providerName,
        stateRegion: 'Rajasthan, Uttarakhand, Himachal Pradesh',
        status: activeCount > 0 ? 'hazards_reported' : 'no_records',
        recordCount: activeCount,
        lastCheckedAt: now,
        lastSuccessAt: now,
        errorMessage: null,
      },
      create: {
        id,
        providerName,
        stateRegion: 'Rajasthan, Uttarakhand, Himachal Pradesh',
        status: activeCount > 0 ? 'hazards_reported' : 'no_records',
        recordCount: activeCount,
        lastCheckedAt: now,
        lastSuccessAt: now,
      },
    });
  } catch (err: any) {
    await prisma.hazardSourceStatus.upsert({
      where: { id },
      update: {
        status: 'unavailable',
        lastCheckedAt: now,
        errorMessage: err?.message || 'USGS unavailable',
      },
      create: {
        id,
        providerName,
        stateRegion: 'Rajasthan, Uttarakhand, Himachal Pradesh',
        status: 'unavailable',
        recordCount: 0,
        lastCheckedAt: now,
        errorMessage: err?.message || 'USGS unavailable',
      },
    });
  }
}

export async function refreshRegionalHazards(force = false): Promise<void> {
  const nowMs = Date.now();
  if (!force && nowMs - lastRefreshStartedAt < REFRESH_INTERVAL_MS) {
    return;
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }

  lastRefreshStartedAt = nowMs;
  refreshInFlight = (async () => {
    await Promise.allSettled([
      ...DEFAULT_NDMA_FEEDS.map((f) => ingestNdmaFeed(f)),
      ingestUsgsEarthquakes(),
    ]);
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function getHazardSourceStatuses() {
  const rows = await prisma.hazardSourceStatus.findMany({ orderBy: { id: 'asc' } });
  const nowMs = Date.now();
  const staleThresholdMs = REFRESH_INTERVAL_MS * 2;

  return rows.map((r) => {
    const isStale = r.lastSuccessAt ? nowMs - r.lastSuccessAt.getTime() > staleThresholdMs : true;
    const effectiveStatus = r.status === 'unavailable' ? 'unavailable' : isStale ? 'stale' : r.status;
    return {
      ...r,
      status: effectiveStatus,
      isStale,
    };
  });
}

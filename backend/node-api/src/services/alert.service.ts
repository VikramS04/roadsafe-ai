export interface OfficialAlert {
  id: string;
  source: 'IMD' | 'SDMA' | 'LOCAL_AUTHORITY' | 'MANUAL';
  headline: string;
  severity: 'low' | 'moderate' | 'severe' | 'extreme';
  urgency: 'immediate' | 'expected' | 'past';
  affectedRegion: string;
  description: string;
  effectiveFrom: string;
  expiresAt: string;
}

// Optional external feed cache (configured via OFFICIAL_ALERTS_FEED_URL)
const alertsStore: OfficialAlert[] = [];
let cachedFeedAlerts: OfficialAlert[] = [];
let lastFeedFetchMs = 0;
const FEED_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Fetch active official alerts from an optional configured feed (OFFICIAL_ALERTS_FEED_URL)
 * and any manually ingested alerts. Never invents static/demo alerts when no feed exists.
 */
export async function getActiveOfficialAlerts(): Promise<{
  alerts: OfficialAlert[];
  configured: boolean;
  isStale: boolean;
  fetchedAt: string | null;
}> {
  const now = new Date();
  const feedUrl = process.env.OFFICIAL_ALERTS_FEED_URL;
  let isStale = false;

  if (feedUrl) {
    if (Date.now() - lastFeedFetchMs > FEED_CACHE_TTL_MS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(feedUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const json: any = await res.json();
          cachedFeedAlerts = Array.isArray(json?.alerts) ? json.alerts : Array.isArray(json) ? json : [];
          lastFeedFetchMs = Date.now();
        } else {
          isStale = true;
        }
      } catch {
        isStale = true;
      }
    }
  }

  const combined = [...alertsStore, ...cachedFeedAlerts].filter(
    (alert) => new Date(alert.expiresAt) > now
  );

  return {
    alerts: combined,
    configured: Boolean(feedUrl || alertsStore.length > 0),
    isStale,
    fetchedAt: lastFeedFetchMs > 0 ? new Date(lastFeedFetchMs).toISOString() : null,
  };
}

/**
 * Ingest alert from manual JSON/CSV or webhook adapter
 */
export function ingestOfficialAlert(alert: OfficialAlert): void {
  alertsStore.unshift(alert);
}

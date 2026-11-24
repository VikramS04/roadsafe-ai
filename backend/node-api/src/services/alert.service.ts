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

// In-memory / manual feed store for official IMD/SDMA alerts
const alertsStore: OfficialAlert[] = [
  {
    id: 'ALT-MEGH-2026-01',
    source: 'SDMA',
    headline: 'High Rain & Landslide Alert for East Khasi Hills',
    severity: 'severe',
    urgency: 'expected',
    affectedRegion: 'Shillong - Pynursla - Dawki corridor',
    description: 'Heavy precipitation forecast along NH-06 and Sohra mountain corridors. Travellers advised to check route passability ratings before departure.',
    effectiveFrom: new Date(Date.now() - 3600 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  },
];

/**
 * Fetch active official alerts
 * Gracefully returns available alerts without blocking routing if external feeds are unavailable.
 */
export async function getActiveOfficialAlerts(region?: string): Promise<OfficialAlert[]> {
  const now = new Date();
  return alertsStore.filter((alert) => new Date(alert.expiresAt) > now);
}

/**
 * Ingest alert from manual JSON/CSV or webhook adapter
 */
export function ingestOfficialAlert(alert: OfficialAlert): void {
  alertsStore.unshift(alert);
}

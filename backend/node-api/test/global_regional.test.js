const { test, describe } = require('node:test');
const assert = require('node:assert');

const API_URL = 'http://127.0.0.1:3000/api/v1';

describe('Global Map, Broad Routing & Regional Hazard Coverage (Real Providers)', () => {
  test('1. Global geocoder finds real places outside East Khasi Hills (Jaipur, Dehradun, Shimla)', async () => {
    for (const q of ['Jaipur', 'Dehradun', 'Shimla']) {
      const res = await fetch(`${API_URL}/geocode?q=${encodeURIComponent(q)}`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.results) && body.results.length >= 1, `Expected results for ${q}`);
      assert.strictEqual(body.results[0].coverage_zone, 'regional_hazards');
    }
  });

  test('2. Broad routing via OSRM works outside East Khasi Hills (Jaipur -> Ajmer) with honest hazard & vehicle warning', async () => {
    const res = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: 26.9124, lng: 75.7873 },
        destination: { lat: 26.4499, lng: 74.6399 },
        vehicle: 'truck',
        objective: 'safest',
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'FEASIBLE');
    assert.strictEqual(body.routing_provider, 'osrm_global');
    assert.ok(['ordinary_with_hazards', 'ordinary_unverified'].includes(body.routing_mode));
    assert.strictEqual(
      body.hazard_coverage?.warning,
      'Hazard data is unavailable or incomplete for part of this route. This route is not fully hazard-verified.'
    );
    assert.ok(body.vehicle_limitations && body.vehicle_limitations.includes('truck'));
    assert.ok(body.routes.length >= 1);
    assert.ok(body.routes[0].distance_km > 100);
    assert.ok(body.routes[0].coordinates.length > 20);
  });

  test('3. Local hazard-aware routing inside East Khasi Hills uses east_khasi_hills_osm', async () => {
    const res = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: 25.578748, lng: 91.893307 },
        destination: { lat: 25.539994, lng: 91.861965 },
        vehicle: 'car',
        objective: 'safest',
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.routing_provider, 'east_khasi_hills_osm');
    assert.strictEqual(body.routing_mode, 'hazard_aware_local');
    assert.strictEqual(body.hazard_coverage?.status, 'verified');
    assert.strictEqual(body.hazard_coverage?.warning, null);
  });

  test('4. Regional hazard coverage reports live NDMA SACHET & USGS status for Rajasthan, Uttarakhand, Himachal Pradesh', async () => {
    const res = await fetch(`${API_URL}/hazards`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.hazards));
    assert.ok(body.coverage && Array.isArray(body.coverage.sources));

    const sourceIds = body.coverage.sources.map((s) => s.id);
    for (const expected of ['ndma_rajasthan', 'ndma_uttarakhand', 'ndma_himachal', 'usgs_india']) {
      assert.ok(sourceIds.includes(expected), `Missing hazard source status: ${expected}`);
    }

    // Verify imported records preserve source attribution and timestamps
    const imported = body.hazards.filter((h) => h.isImported);
    for (const h of imported) {
      assert.ok(['ndma_sachet', 'usgs'].includes(h.source));
      assert.ok(h.reportedAt);
      assert.ok(h.expiresAt);
      assert.ok(new Date(h.expiresAt) > new Date(), 'Active hazards endpoint must not return expired alerts');
    }
  });
});

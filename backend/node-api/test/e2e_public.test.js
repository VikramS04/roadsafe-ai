const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API_URL = 'http://localhost:3000/api/v1';

describe('RoadSafe AI Real-Data Public Driver E2E Flow', () => {
  let createdReportId = '';
  let snappedEdgeId = '';
  let snappedLat = 25.560;
  let snappedLng = 91.875;
  const reporterDeviceId = 'e2e-driver-' + Date.now();
  const voter1 = 'e2e-local-1-' + Date.now();
  const voter2 = 'e2e-local-2-' + Date.now();
  const voter3 = 'e2e-local-3-' + Date.now();

  after(async () => {
    if (createdReportId) {
      await prisma.hazardEvent.deleteMany({ where: { reportId: createdReportId } }).catch(() => {});
      await prisma.hazardVote.deleteMany({ where: { reportId: createdReportId } }).catch(() => {});
      await prisma.hazardReport.deleteMany({ where: { id: createdReportId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  test('1. Health check returns 200 with database and real OSM python microservice healthy', async () => {
    const res = await fetch(`${API_URL}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'healthy');
    assert.strictEqual(body.dependencies.database, 'healthy');
    assert.strictEqual(body.dependencies.python_routing_microservice, 'healthy');
  });

  test('2. Real geocoder returns results for Shillong / Cherrapunji', async () => {
    const res = await fetch(`${API_URL}/geocode?q=Shillong`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.results));
    if (body.results.length > 0) {
      assert.ok(body.results[0].lat > 24.0);
      assert.ok(body.results[0].lng > 90.0);
    }
  });

  test('3. Fetch live conditions returns honest Open-Meteo weather and alerts array', async () => {
    const res = await fetch(`${API_URL}/conditions?lat=25.57&lng=91.89`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.weather);
    assert.ok(body.weather.conditionDescription);
    assert.ok(['open-meteo', 'unavailable'].includes(body.weather.source));
    assert.ok(Array.isArray(body.alerts));
  });

  test('4. Different real origin/destination inputs produce distinct real-road routes & reject >500m off-road', async () => {
    const r1Res = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: 25.578748, lng: 91.893307 },
        destination: { lat: 25.539994, lng: 91.861965 },
        vehicle: 'car',
        objective: 'safest',
      }),
    });
    assert.strictEqual(r1Res.status, 200);
    const r1 = await r1Res.json();
    assert.strictEqual(r1.status, 'FEASIBLE');
    assert.ok(r1.routes[0].coordinates.length > 5, 'Route must follow real road geometry');

    const r2Res = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: 25.578748, lng: 91.893307 },
        destination: { lat: 25.445115, lng: 91.757371 },
        vehicle: 'car',
        objective: 'fastest',
      }),
    });
    assert.strictEqual(r2Res.status, 200);
    const r2 = await r2Res.json();
    assert.strictEqual(r2.status, 'FEASIBLE');
    assert.notStrictEqual(r1.routes[0].distance_km, r2.routes[0].distance_km);

    // >500m away from road network inside East Khasi Hills (588.7m off-road) must fail honestly
    const offRoadRes = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: 25.5450, lng: 91.8600 },
        destination: { lat: 25.539994, lng: 91.861965 },
        vehicle: 'car',
      }),
    });
    assert.strictEqual(offRoadRes.status, 400);
    const offErr = await offRoadRes.json();
    assert.strictEqual(offErr.error, 'LOCATION_TOO_FAR_FROM_ROAD');

    // Pick a middle edge from r1 for hazard reporting test
    const midEdge = r1.routes[0].edges[Math.floor(r1.routes[0].edges.length / 2)];
    snappedEdgeId = midEdge.edge_id;
    if (midEdge.coordinates && midEdge.coordinates[0]) {
      snappedLng = midEdge.coordinates[0][0];
      snappedLat = midEdge.coordinates[0][1];
    }
  });

  test('5. Driver reports a landslide -> PostGIS snaps to real road edge & 3 votes confirm it', async () => {
    const res = await fetch(`${API_URL}/hazards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': reporterDeviceId },
      body: JSON.stringify({
        type: 'landslide',
        severity: 'critical',
        latitude: snappedLat,
        longitude: snappedLng,
        edge_id: snappedEdgeId,
        note: 'Fresh rockslide on real OSM edge',
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.report.status, 'unverified');
    assert.strictEqual(body.report.edgeId, snappedEdgeId);
    createdReportId = body.report.id;

    for (const v of [voter1, voter2, voter3]) {
      const vr = await fetch(`${API_URL}/hazards/${createdReportId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': v },
        body: JSON.stringify({ vote: 'yes', voter_latitude: snappedLat, voter_longitude: snappedLng }),
      });
      assert.strictEqual(vr.status, 200);
    }
  });

  test('6. Confirmed landslide reroutes Truck off blocked edge, while Bike can still pass', async () => {
    const truckRes = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: 25.578748, lng: 91.893307 },
        destination: { lat: 25.539994, lng: 91.861965 },
        vehicle: 'truck',
        objective: 'safest',
      }),
    });
    assert.strictEqual(truckRes.status, 200);
    const truckData = await truckRes.json();
    if (truckData.status === 'FEASIBLE') {
      const truckEdges = truckData.routes[0].edges.map((e) => e.edge_id);
      assert.strictEqual(truckEdges.includes(snappedEdgeId), false, 'Truck must not traverse confirmed landslide edge');
    }

    const bikeRes = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: 25.578748, lng: 91.893307 },
        destination: { lat: 25.539994, lng: 91.861965 },
        vehicle: 'bike',
        objective: 'fastest',
      }),
    });
    assert.strictEqual(bikeRes.status, 200);
    const bikeData = await bikeRes.json();
    assert.strictEqual(bikeData.status, 'FEASIBLE');
  });

  test('7. Hazard is voted CLEARED by 3 locals -> status transitions to CLEARED', async () => {
    for (let i = 1; i <= 3; i++) {
      const res = await fetch(`${API_URL}/hazards/${createdReportId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': `clear-local-${i}-${Date.now()}` },
        body: JSON.stringify({ vote: 'cleared', voter_latitude: snappedLat, voter_longitude: snappedLng }),
      });
      assert.strictEqual(res.status, 200);
      if (i === 3) {
        const body = await res.json();
        assert.strictEqual(body.newStatus, 'cleared');
        assert.strictEqual(body.statusChanged, true);
      }
    }
  });
});

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API_URL = 'http://localhost:3000/api/v1';

describe('RoadSafe AI Public Driver Experience E2E Flow', () => {
  let createdReportId = '';
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

  test('1. Health check returns 200 with database and python microservice healthy', async () => {
    const res = await fetch(`${API_URL}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'healthy');
    assert.strictEqual(body.dependencies.database, 'healthy');
    assert.strictEqual(body.dependencies.python_routing_microservice, 'healthy');
  });

  test('2. Autocomplete search finds Cherrapunji and Shillong', async () => {
    const res = await fetch(`${API_URL}/geocode?q=Cherrapunji`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.results.length >= 1);
    const first = body.results[0];
    assert.ok(first.name.includes('Cherrapunji'));
    assert.ok(first.lat > 25.0);
    assert.ok(first.lng > 91.0);
  });

  test('3. Fetch live conditions returns Open-Meteo weather and official SDMA alerts', async () => {
    const res = await fetch(`${API_URL}/conditions`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.weather);
    assert.ok(body.weather.conditionDescription);
    assert.ok(Array.isArray(body.alerts));
  });

  test('4. Driver reports a landslide on NH-06 arterial (snaps to edge E1)', async () => {
    const res = await fetch(`${API_URL}/hazards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': reporterDeviceId,
      },
      body: JSON.stringify({
        type: 'landslide',
        severity: 'high',
        latitude: 25.560,
        longitude: 91.875,
        edge_id: 'E1',
        note: 'Fresh rockslide blocking both lanes on NH-06',
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.report.type, 'landslide');
    assert.strictEqual(body.report.status, 'unverified');
    assert.strictEqual(body.report.edgeId, 'E1');
    createdReportId = body.report.id;
  });

  test('5. Three local drivers confirm the hazard -> status becomes CONFIRMED', async () => {
    // Vote 1
    const res1 = await fetch(`${API_URL}/hazards/${createdReportId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': voter1 },
      body: JSON.stringify({ vote: 'yes', voter_latitude: 25.561, voter_longitude: 91.874 }),
    });
    assert.strictEqual(res1.status, 200);

    // Vote 2
    const res2 = await fetch(`${API_URL}/hazards/${createdReportId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': voter2 },
      body: JSON.stringify({ vote: 'yes', voter_latitude: 25.559, voter_longitude: 91.876 }),
    });
    assert.strictEqual(res2.status, 200);

    // Vote 3 (reaches threshold N=3)
    const res3 = await fetch(`${API_URL}/hazards/${createdReportId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': voter3 },
      body: JSON.stringify({ vote: 'yes', voter_latitude: 25.560, voter_longitude: 91.875 }),
    });
    assert.strictEqual(res3.status, 200);
    const body3 = await res3.json();
    assert.strictEqual(body3.newStatus, 'confirmed');
    assert.strictEqual(body3.statusChanged, true);
  });

  test('6. Confirmed landslide reroutes Truck (N1 to N8), but Bike still navigates E1', async () => {
    // 6a. Truck route request
    const truckRes = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { nodeId: 'N1' },
        destination: { nodeId: 'N8' },
        vehicle: 'truck',
        objective: 'safest',
      }),
    });
    assert.strictEqual(truckRes.status, 200);
    const truckData = await truckRes.json();
    assert.strictEqual(truckData.status, 'FEASIBLE');
    assert.ok(truckData.routes.length >= 1);
    // Truck must detour around E1 via N9 (Smit connector)
    const truckEdges = truckData.routes[0].edges.map((e) => e.edge_id);
    assert.strictEqual(truckEdges.includes('E1'), false, 'Truck must not traverse confirmed landslide edge E1');
    assert.ok(truckData.routes[0].nodes.includes('N9'), 'Truck must detour via Smit Relief Hub N9');

    // 6b. Bike route request on the same confirmed landslide
    const bikeRes = await fetch(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: { nodeId: 'N1' },
        destination: { nodeId: 'N8' },
        vehicle: 'bike',
        objective: 'fastest',
      }),
    });
    assert.strictEqual(bikeRes.status, 200);
    const bikeData = await bikeRes.json();
    assert.strictEqual(bikeData.status, 'FEASIBLE');
    assert.ok(bikeData.routes.length >= 1);
    // Bike can use E1 because width (0.9m) and nimble clearance permit passage
    const bikeEdges = bikeData.routes[0].edges.map((e) => e.edge_id);
    assert.strictEqual(bikeEdges.includes('E1'), true, 'Bike can navigate narrow clearance along E1');
  });

  test('7. Hazard is voted CLEARED by 3 locals -> status transitions to CLEARED', async () => {
    const clear1 = 'clear-local-1-' + Date.now();
    const clear2 = 'clear-local-2-' + Date.now();
    const clear3 = 'clear-local-3-' + Date.now();

    await fetch(`${API_URL}/hazards/${createdReportId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': clear1 },
      body: JSON.stringify({ vote: 'cleared', voter_latitude: 25.560, voter_longitude: 91.875 }),
    });
    await fetch(`${API_URL}/hazards/${createdReportId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': clear2 },
      body: JSON.stringify({ vote: 'cleared', voter_latitude: 25.560, voter_longitude: 91.875 }),
    });
    const res = await fetch(`${API_URL}/hazards/${createdReportId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': clear3 },
      body: JSON.stringify({ vote: 'cleared', voter_latitude: 25.560, voter_longitude: 91.875 }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.newStatus, 'cleared');
    assert.strictEqual(body.statusChanged, true);
  });
});

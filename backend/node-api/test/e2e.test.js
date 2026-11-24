const { test, describe } = require('node:test');
const assert = require('node:assert');

const BASE_URL = 'http://localhost:3000/api/v1';

describe('RoadSafe AI Node API & Python Microservice End-to-End Suite', () => {
  let dispatcherToken = '';
  let adminToken = '';

  test('1. Health check returns healthy dependencies', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'healthy');
    assert.strictEqual(body.dependencies.database, 'healthy');
    assert.strictEqual(body.dependencies.python_routing_microservice, 'healthy');
  });

  test('2. Authentication with valid dispatcher credentials', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dispatcher@roadsafe.ai', password: 'dispatch123' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.access_token);
    assert.strictEqual(body.user.role, 'dispatcher');
    dispatcherToken = body.access_token;
  });

  test('3. Authentication with admin credentials', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@roadsafe.ai', password: 'admin123' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    adminToken = body.access_token;
  });

  test('4. Rejection of invalid credentials with 401', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dispatcher@roadsafe.ai', password: 'wrongpassword' }),
    });
    assert.strictEqual(res.status, 401);
  });

  test('5. Fetch Dashboard Summary with risk distribution', async () => {
    const res = await fetch(`${BASE_URL}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.ok(body.data.risk_distribution.total_segments >= 15);
  });

  test('6. Fetch Road GeoJSON for MapLibre rendering', async () => {
    const res = await fetch(`${BASE_URL}/roads/geojson`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.type, 'FeatureCollection');
    assert.ok(body.features.length >= 15);
    const first = body.features[0];
    assert.ok(first.geometry.coordinates);
    assert.ok(first.properties.name);
    assert.ok(first.properties.risk_band);
  });

  test('7. Plan Route for Ambulance (N1 to N12)', async () => {
    const res = await fetch(`${BASE_URL}/routes/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({
        source_node_id: 'N1',
        dest_node_id: 'N12',
        vehicle_profile_id: 'ambulance',
        urgency_profile: 'emergency',
        k: 3,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'FEASIBLE');
    assert.ok(body.data.paths.length >= 1);
    assert.ok(body.data.confidence_score > 0);
    assert.ok(body.data.rationale.includes('Recommended primary route'));
    const rank1 = body.data.paths[0];
    assert.ok(rank1.total_cost > 0);
    assert.ok(rank1.estimated_travel_minutes > 0);
    assert.ok(rank1.coordinates.length > 0);
  });

  test('8. Heavy Truck planning verifies Suspension Bridge is pruned', async () => {
    const res = await fetch(`${BASE_URL}/routes/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({
        source_node_id: 'N1',
        dest_node_id: 'N12',
        vehicle_profile_id: 'truck',
        urgency_profile: 'standard',
        k: 3,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const constraints = body.data.constraints_applied;
    const bridgePruning = constraints.find((c) => c.edge_id === 'E16');
    assert.ok(bridgePruning, 'Edge E16 must be pruned for heavy truck due to bridge load limit');
  });

  test('9. Create and Verify an Incident', async () => {
    const createRes = await fetch(`${BASE_URL}/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
      },
      body: JSON.stringify({
        incidentType: 'falling_rocks',
        severity: 'high',
        description: 'Rockslide warning near Mawphlang corridor',
        lat: 25.4450,
        lng: 91.7580,
        affectedSegmentIds: ['E3'],
      }),
    });

    assert.strictEqual(createRes.status, 201);
    const created = await createRes.json();
    const incId = created.data.id;

    // Verify incident with admin
    const patchRes = await fetch(`${BASE_URL}/incidents/${incId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'verified',
        verificationNotes: 'Ground patrol verified rockfall hazard.',
        roadAction: 'caution',
      }),
    });

    assert.strictEqual(patchRes.status, 200);
    const updated = await patchRes.json();
    assert.strictEqual(updated.data.status, 'verified');
  });

  test('10. Audit log search retrieves append-only history', async () => {
    const res = await fetch(`${BASE_URL}/audit-logs?limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.length >= 3);
    const actions = body.data.map((l) => l.action);
    assert.ok(actions.includes('USER_LOGIN'));
    assert.ok(actions.includes('ROUTE_PLANNED'));
  });
});


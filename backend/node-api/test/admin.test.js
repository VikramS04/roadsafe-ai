const test = require('node:test');
const assert = require('node:assert');

const BASE_URL = 'http://127.0.0.1:3000/api/v1';

async function loginAs(email, password) {
  const res = await fetch(`${BASE_URL}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  const body = await res.json();
  return { status: res.status, body, cookieHeader, csrfToken: body.csrfToken };
}

test('Admin Security, RBAC, CSRF, Rate-Limit, Audit & E2E Hazard Lifecycle', async (t) => {
  let adminCookie = '';
  let adminCsrf = '';
  let modCookie = '';
  let modCsrf = '';
  let createdReportId = '';
  let spamReportId = '';

  await t.test('1. Unauthenticated requests to /api/v1/admin/* are rejected with 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/hazards`);
    assert.strictEqual(res.status, 401);
  });

  await t.test('2. Login rate limiting locks out after 5 failed attempts', async () => {
    const rateEmail = `ratelimit-${Date.now()}@roadsafe.local`;
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${BASE_URL}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: rateEmail, password: 'wrongpassword' }),
      });
      assert.strictEqual(r.status, 401);
    }
    const locked = await fetch(`${BASE_URL}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: rateEmail, password: 'wrongpassword' }),
    });
    assert.strictEqual(locked.status, 429);
  });

  await t.test('3. Admin & Moderator login succeeds with httpOnly cookie & CSRF token', async () => {
    const adminLogin = await loginAs('admin@roadsafe.local', 'StrongAdminPassword!2026');
    assert.strictEqual(adminLogin.status, 200);
    assert.ok(adminLogin.cookieHeader.includes('roadsafe_admin_token='));
    assert.ok(adminLogin.csrfToken);
    adminCookie = adminLogin.cookieHeader;
    adminCsrf = adminLogin.csrfToken;

    const modLogin = await loginAs('mod@roadsafe.local', 'StrongModPassword!2026');
    assert.strictEqual(modLogin.status, 200);
    assert.strictEqual(modLogin.body.admin.role, 'moderator');
    modCookie = modLogin.cookieHeader;
    modCsrf = modLogin.csrfToken;
  });

  await t.test('4. Moderator is rejected from /admin/settings (403 Forbidden)', async () => {
    const res = await fetch(`${BASE_URL}/admin/settings`, {
      headers: { Cookie: modCookie },
    });
    assert.strictEqual(res.status, 403);
  });

  await t.test('5. State-changing admin calls enforce CSRF token (403 without x-csrf-token)', async () => {
    const res = await fetch(`${BASE_URL}/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        confirmThreshold: 3,
        clearThreshold: 3,
        defaultExpiryHours: 6,
        proximityRadiusKm: 5,
        maxReportsPerHour: 10,
      }),
    });
    assert.strictEqual(res.status, 403);
  });

  await t.test('6. Public hazard response does not expose full deviceId', async () => {
    const res = await fetch(`${BASE_URL}/hazards`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    for (const h of data.hazards) {
      assert.strictEqual(h.deviceId, undefined, 'Public hazard must not expose full deviceId');
      assert.ok(h.deviceShortId, 'Public hazard should expose truncated deviceShortId');
    }
  });

  await t.test('7. E2E: User reports landslide -> Admin confirms it -> Truck route changes', async () => {
    // Baseline truck route on real OSM network (Police Bazar -> Upper Shillong)
    const baseRouteRes = await fetch(`${BASE_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': 'dev-test-truck-1' },
      body: JSON.stringify({
        origin: { lat: 25.578748, lng: 91.893307 },
        destination: { lat: 25.539994, lng: 91.861965 },
        vehicle: 'truck',
        objective: 'safest',
      }),
    });
    assert.strictEqual(baseRouteRes.status, 200);
    const baseRouteData = await baseRouteRes.json();
    const midIdx = Math.floor((baseRouteData.routes?.[0]?.edges?.length || 2) / 2);
    const firstEdge = baseRouteData.routes?.[0]?.edges?.[midIdx];
    assert.ok(firstEdge, 'Baseline truck route should have edges');
    const targetCoord = firstEdge.coordinates?.[0] || [91.875, 25.56];

    // User reports a landslide on that edge
    const reportRes = await fetch(`${BASE_URL}/hazards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': 'dev-reporter-e2e' },
      body: JSON.stringify({
        type: 'landslide',
        severity: 'critical',
        latitude: targetCoord[1],
        longitude: targetCoord[0],
        edgeId: firstEdge.edge_id,
        note: 'Massive landslide blocking highway',
      }),
    });
    assert.strictEqual(reportRes.status, 201);
    const reportBody = await reportRes.json();
    createdReportId = reportBody.report.id;

    // Admin confirms the landslide
    const confirmRes = await fetch(`${BASE_URL}/admin/hazards/${createdReportId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'x-csrf-token': adminCsrf,
      },
      body: JSON.stringify({ action: 'confirm' }),
    });
    assert.strictEqual(confirmRes.status, 200);
    const confirmed = await confirmRes.json();
    assert.strictEqual(confirmed.report.status, 'confirmed');
    assert.strictEqual(confirmed.report.source, 'admin');

    // Truck route now either reroutes (different edges/cost) or returns NO_FEASIBLE_ROUTE
    const afterRouteRes = await fetch(`${BASE_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': 'dev-test-truck-1' },
      body: JSON.stringify({
        origin: { lat: 25.578748, lng: 91.893307 },
        destination: { lat: 25.539994, lng: 91.861965 },
        vehicle: 'truck',
        objective: 'safest',
      }),
    });
    const afterRouteData = await afterRouteRes.json();
    const sameEdgeUsed =
      afterRouteData.status !== 'NO_FEASIBLE_ROUTE' &&
      afterRouteData.routes?.[0]?.edges?.some((e) => e.edge_id === firstEdge.edge_id);
    assert.strictEqual(sameEdgeUsed, false, 'Confirmed landslide must prune the blocked edge for trucks');
  });

  await t.test('8. E2E: Admin rejects spam report -> disappears from public map', async () => {
    const spamRes = await fetch(`${BASE_URL}/hazards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': 'dev-spammer-e2e' },
      body: JSON.stringify({
        type: 'other',
        severity: 'low',
        latitude: 25.575,
        longitude: 91.891,
        note: 'Fake spam report',
      }),
    });
    assert.strictEqual(spamRes.status, 201);
    spamReportId = (await spamRes.json()).report.id;

    const rejectRes = await fetch(`${BASE_URL}/admin/hazards/${spamReportId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'x-csrf-token': adminCsrf,
      },
      body: JSON.stringify({ action: 'reject', reason: 'Spam / false report' }),
    });
    assert.strictEqual(rejectRes.status, 200);

    const publicRes = await fetch(`${BASE_URL}/hazards`);
    const publicData = await publicRes.json();
    assert.strictEqual(publicData.hazards.some((h) => h.id === spamReportId), false);
  });

  await t.test('9. E2E: Admin edits report location -> re-snaps to nearest road edge & writes audit log', async () => {
    const editRes = await fetch(`${BASE_URL}/admin/hazards/${createdReportId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
        'x-csrf-token': adminCsrf,
      },
      body: JSON.stringify({
        latitude: 25.5788,
        longitude: 91.8933,
        note: 'Re-snapped to Shillong central edge',
      }),
    });
    assert.strictEqual(editRes.status, 200);
    const edited = await editRes.json();
    assert.ok(edited.report.edgeId, 'Re-snapped report must have an edgeId');

    // Verify audit log contains our actions
    const auditRes = await fetch(`${BASE_URL}/admin/audit?limit=10`, {
      headers: { Cookie: adminCookie },
    });
    assert.strictEqual(auditRes.status, 200);
    const auditData = await auditRes.json();
    assert.ok(auditData.items.some((a) => a.action === 'HAZARD_CONFIRM' && a.targetId === createdReportId));
    assert.ok(auditData.items.some((a) => a.action === 'HAZARD_REJECT' && a.targetId === spamReportId));
    assert.ok(auditData.items.some((a) => a.action === 'HAZARD_EDIT' && a.targetId === createdReportId));
  });

  await t.test('10. Cleanup test reports via Admin DELETE', async () => {
    for (const id of [createdReportId, spamReportId].filter(Boolean)) {
      const del = await fetch(`${BASE_URL}/admin/hazards/${id}`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie, 'x-csrf-token': adminCsrf },
      });
      assert.strictEqual(del.status, 200);
    }
  });
});

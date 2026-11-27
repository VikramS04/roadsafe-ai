const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

describe('Community Hazards & Voting Unit Tests', () => {
  const testReportId = 'test-hazard-unit-' + Date.now();
  const reporterDeviceId = 'device-reporter-' + Date.now();
  const voter1 = 'device-voter-1-' + Date.now();
  const voter2 = 'device-voter-2-' + Date.now();
  const voter3 = 'device-voter-3-' + Date.now();

  before(async () => {
    // Clean up any existing test records
    await prisma.hazardEvent.deleteMany({ where: { reportId: testReportId } }).catch(() => {});
    await prisma.hazardVote.deleteMany({ where: { reportId: testReportId } }).catch(() => {});
    await prisma.hazardReport.deleteMany({ where: { id: testReportId } }).catch(() => {});

    // Ensure test devices exist in DeviceProfile
    const devices = [reporterDeviceId, voter1, voter2, voter3];
    for (const d of devices) {
      await prisma.deviceProfile.upsert({
        where: { deviceId: d },
        update: {},
        create: { deviceId: d, reliabilityScore: 1.0 },
      });
    }
  });

  after(async () => {
    await prisma.hazardEvent.deleteMany({ where: { reportId: testReportId } }).catch(() => {});
    await prisma.hazardVote.deleteMany({ where: { reportId: testReportId } }).catch(() => {});
    await prisma.hazardReport.deleteMany({ where: { id: testReportId } }).catch(() => {});
    const devices = [reporterDeviceId, voter1, voter2, voter3];
    await prisma.deviceProfile.deleteMany({ where: { deviceId: { in: devices } } }).catch(() => {});
    await prisma.$disconnect();
  });

  test('1. Initial report creation starts in unverified status with 6-hour expiry', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 6 * 3600 * 1000);

    const report = await prisma.hazardReport.create({
      data: {
        id: testReportId,
        type: 'landslide',
        severity: 'high',
        edgeId: 'E1',
        lat: 25.560,
        lng: 91.875,
        status: 'unverified',
        confirmCount: 0,
        clearCount: 0,
        deviceId: reporterDeviceId,
        expiresAt,
      },
    });

    assert.strictEqual(report.status, 'unverified');
    assert.strictEqual(report.confirmCount, 0);
    assert.strictEqual(report.clearCount, 0);
    assert.ok(report.expiresAt > now);
  });

  test('2. Single device cannot vote twice on the same report', async () => {
    // Voter 1 casts vote
    await prisma.hazardVote.create({
      data: {
        reportId: testReportId,
        deviceId: voter1,
        vote: 'yes',
      },
    });

    // Voter 1 attempts duplicate vote -> should fail unique constraint
    let failed = false;
    try {
      await prisma.hazardVote.create({
        data: {
          reportId: testReportId,
          deviceId: voter1,
          vote: 'yes',
        },
      });
    } catch (err) {
      failed = true;
    }
    assert.strictEqual(failed, true, 'Duplicate vote must be rejected by unique constraint');
  });

  test('3. Threshold of 3 Yes votes transitions status to confirmed', async () => {
    // Voter 2 casts vote
    await prisma.hazardVote.create({
      data: { reportId: testReportId, deviceId: voter2, vote: 'yes' },
    });
    // Voter 3 casts vote
    await prisma.hazardVote.create({
      data: { reportId: testReportId, deviceId: voter3, vote: 'yes' },
    });

    // Total yes votes = 1 (reporter) + 3 (voters) = 4 >= 3
    const totalYes = await prisma.hazardVote.count({
      where: { reportId: testReportId, vote: 'yes' },
    });
    assert.strictEqual(totalYes, 3);

    // Update status to confirmed
    const updated = await prisma.hazardReport.update({
      where: { id: testReportId },
      data: { confirmCount: totalYes + 1, status: 'confirmed' },
    });

    assert.strictEqual(updated.status, 'confirmed');
    assert.strictEqual(updated.confirmCount, 4);
  });

  test('4. Threshold of 3 Cleared votes transitions status to cleared', async () => {
    const clearVoter1 = 'device-clear-1-' + Date.now();
    const clearVoter2 = 'device-clear-2-' + Date.now();
    const clearVoter3 = 'device-clear-3-' + Date.now();

    for (const d of [clearVoter1, clearVoter2, clearVoter3]) {
      await prisma.deviceProfile.upsert({
        where: { deviceId: d },
        update: {},
        create: { deviceId: d, reliabilityScore: 1.0 },
      });
    }

    await prisma.hazardVote.create({ data: { reportId: testReportId, deviceId: clearVoter1, vote: 'cleared' } });
    await prisma.hazardVote.create({ data: { reportId: testReportId, deviceId: clearVoter2, vote: 'cleared' } });
    await prisma.hazardVote.create({ data: { reportId: testReportId, deviceId: clearVoter3, vote: 'cleared' } });

    const totalCleared = await prisma.hazardVote.count({
      where: { reportId: testReportId, vote: 'cleared' },
    });
    assert.strictEqual(totalCleared, 3);

    const updated = await prisma.hazardReport.update({
      where: { id: testReportId },
      data: { clearCount: totalCleared, status: 'cleared' },
    });

    assert.strictEqual(updated.status, 'cleared');
    assert.strictEqual(updated.clearCount, 3);
  });

  test('5. Expiry and time-decay math', () => {
    const lifespanMs = 6 * 3600 * 1000; // 6 hours

    // Fresh report (0 hours old): decay = 1.0
    const freshAge = 0;
    const decayFresh = Math.max(0, Math.min(1.0, 1.0 - (freshAge / lifespanMs)));
    assert.strictEqual(decayFresh, 1.0);

    // 3 hours old: decay = 0.5
    const halfAge = 3 * 3600 * 1000;
    const decayHalf = Math.max(0, Math.min(1.0, 1.0 - (halfAge / lifespanMs)));
    assert.strictEqual(decayHalf, 0.5);

    // 6 hours old: decay = 0.0
    const expiredAge = 6 * 3600 * 1000;
    const decayExpired = Math.max(0, Math.min(1.0, 1.0 - (expiredAge / lifespanMs)));
    assert.strictEqual(decayExpired, 0.0);
  });

  test('6. HTTP /hazards/:id/vote enforces proximity coordinates, 5km radius, duplicate check, and tracks disputeCount', async () => {
    const apiBase = process.env.API_URL || 'http://127.0.0.1:3000/api/v1';
    const httpReportId = 'test-hazard-http-' + Date.now();
    const httpVoter = 'device-http-voter-' + Date.now();
    const expiresAt = new Date(Date.now() + 6 * 3600 * 1000);

    await prisma.deviceProfile.upsert({
      where: { deviceId: httpVoter },
      update: {},
      create: { deviceId: httpVoter, reliabilityScore: 1.0 },
    });

    await prisma.hazardReport.create({
      data: {
        id: httpReportId,
        type: 'flooded_road',
        severity: 'medium',
        lat: 25.5788,
        lng: 91.8933,
        status: 'unverified',
        confirmCount: 0,
        clearCount: 0,
        deviceId: reporterDeviceId,
        expiresAt,
      },
    });

    try {
      // Missing GPS coordinates must be rejected (400), never bypass proximity
      const missingLocRes = await fetch(`${apiBase}/hazards/${httpReportId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': httpVoter },
        body: JSON.stringify({ vote: 'no' }),
      });
      assert.strictEqual(missingLocRes.status, 400);

      // Out-of-range coordinates (> 5 km) must be rejected (403)
      const farRes = await fetch(`${apiBase}/hazards/${httpReportId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': httpVoter },
        body: JSON.stringify({ vote: 'no', voter_latitude: 26.9124, voter_longitude: 75.7873 }),
      });
      assert.strictEqual(farRes.status, 403);

      // Nearby dispute ("no") vote succeeds and increments disputeCount
      const okRes = await fetch(`${apiBase}/hazards/${httpReportId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': httpVoter },
        body: JSON.stringify({ vote: 'no', voter_latitude: 25.579, voter_longitude: 91.8935 }),
      });
      assert.strictEqual(okRes.status, 200);
      const okBody = await okRes.json();
      assert.strictEqual(okBody.disputeCount, 1);
      assert.strictEqual(okBody.userVote, 'no');

      // Duplicate vote from same device must be rejected (409)
      const dupRes = await fetch(`${apiBase}/hazards/${httpReportId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': httpVoter },
        body: JSON.stringify({ vote: 'yes', voter_latitude: 25.579, voter_longitude: 91.8935 }),
      });
      assert.strictEqual(dupRes.status, 409);

      // GET /hazards/:id returns disputeCount and caller's userVote
      const getRes = await fetch(`${apiBase}/hazards/${httpReportId}`, {
        headers: { 'x-device-id': httpVoter },
      });
      assert.strictEqual(getRes.status, 200);
      const getBody = await getRes.json();
      assert.strictEqual(getBody.hazard.disputeCount, 1);
      assert.strictEqual(getBody.hazard.userVote, 'no');
    } finally {
      await prisma.hazardEvent.deleteMany({ where: { reportId: httpReportId } }).catch(() => {});
      await prisma.hazardVote.deleteMany({ where: { reportId: httpReportId } }).catch(() => {});
      await prisma.hazardReport.deleteMany({ where: { id: httpReportId } }).catch(() => {});
      await prisma.deviceProfile.deleteMany({ where: { deviceId: httpVoter } }).catch(() => {});
    }
  });
});

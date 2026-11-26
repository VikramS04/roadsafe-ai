import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  ADMIN_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  requireAdminAuth,
  requireRole,
  csrfProtection,
  signAdminToken,
  generateCsrfToken,
  getClientIp,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  logAdminAction,
} from '../middleware/adminAuth';
import {
  calculateHaversineDistanceMeters,
  snapToNearestRoadEdge,
  syncRoadSegmentStatusForEdge,
  getAppSettings,
} from '../services/hazard.service';

const router = Router();
const prisma = new PrismaClient();

// Simple SSE subscriber list for live admin dashboard updates
const sseClients = new Set<Response>();
export function broadcastAdminEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

const isProd = process.env.NODE_ENV === 'production';

// ==========================================
// 1. AUTHENTICATION (Login, Logout, Me)
// ==========================================

router.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ip = getClientIp(req);
    const rateKey = `${ip}:${email}`;

    const rateCheck = checkLoginRateLimit(rateKey);
    if (!rateCheck.allowed) {
      res.status(429).json({
        error: 'TOO_MANY_ATTEMPTS',
        message: `Too many failed login attempts. Try again in ${rateCheck.retryAfterSec}s.`,
        retryAfterSec: rateCheck.retryAfterSec,
      });
      return;
    }

    if (!email || !password) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and password are required.' });
      return;
    }

    const user = await prisma.adminUser.findUnique({ where: { email } });
    if (!user || user.disabled) {
      recordLoginFailure(rateKey);
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      recordLoginFailure(rateKey);
      res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
      return;
    }

    clearLoginFailures(rateKey);

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signAdminToken({
      id: user.id,
      email: user.email,
      role: user.role as 'admin' | 'moderator',
    });
    const csrfToken = generateCsrfToken();

    res.cookie(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 2 * 60 * 60 * 1000,
      path: '/',
    });
    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 2 * 60 * 60 * 1000,
      path: '/',
    });

    await logAdminAction({
      adminId: user.id,
      adminEmail: user.email,
      action: 'ADMIN_LOGIN',
      targetType: 'admin_user',
      targetId: user.id,
      ipAddress: ip,
    });

    res.json({
      admin: { id: user.id, email: user.email, role: user.role },
      csrfToken,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'LOGIN_FAILED', message: err.message });
  }
});

router.post('/auth/logout', (req: Request, res: Response): void => {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
  res.json({ message: 'Logged out.' });
});

router.get('/auth/me', requireAdminAuth, (req: Request, res: Response): void => {
  let csrfToken = req.cookies?.[CSRF_COOKIE_NAME];
  if (!csrfToken) {
    csrfToken = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 2 * 60 * 60 * 1000,
      path: '/',
    });
  }
  res.json({ admin: req.admin, csrfToken });
});

// All remaining /api/v1/admin/* routes require authentication + CSRF on mutations
router.use(requireAdminAuth);
router.use(csrfProtection);

// ==========================================
// 2. DASHBOARD & SSE LIVE FEED
// ==========================================

router.get('/dashboard', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const [allReports, recentReports, topEdges] = await Promise.all([
      prisma.hazardReport.findMany({
        select: { id: true, status: true, type: true, severity: true, reportedAt: true, updatedAt: true, edgeId: true },
      }),
      prisma.hazardReport.findMany({
        take: 15,
        orderBy: { reportedAt: 'desc' },
        select: { id: true, type: true, severity: true, status: true, source: true, edgeId: true, reportedAt: true, note: true },
      }),
      prisma.hazardReport.groupBy({
        by: ['edgeId'],
        _count: { edgeId: true },
        where: { edgeId: { not: null } },
        orderBy: { _count: { edgeId: 'desc' } },
        take: 5,
      }),
    ]);

    const byStatus: Record<string, number> = { unverified: 0, confirmed: 0, cleared: 0, expired: 0, rejected: 0 };
    const byType: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    let confirmedDurationSumMin = 0;
    let confirmedCount = 0;

    for (const r of allReports) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byType[r.type] = (byType[r.type] || 0) + 1;
      const dayKey = new Date(r.reportedAt).toISOString().slice(0, 10);
      byDay[dayKey] = (byDay[dayKey] || 0) + 1;

      if (r.status === 'confirmed') {
        const diffMin = Math.max(0, (new Date(r.updatedAt).getTime() - new Date(r.reportedAt).getTime()) / 60000);
        confirmedDurationSumMin += diffMin;
        confirmedCount += 1;
      }
    }

    const edgeIds = topEdges.map((e) => e.edgeId!).filter(Boolean);
    const segments = edgeIds.length
      ? await prisma.roadSegment.findMany({ where: { id: { in: edgeIds } }, select: { id: true, name: true, ref: true } })
      : [];
    const segMap = new Map(segments.map((s) => [s.id, s]));

    const topRoads = topEdges.map((e) => ({
      edgeId: e.edgeId,
      roadName: segMap.get(e.edgeId!)?.name || e.edgeId,
      ref: segMap.get(e.edgeId!)?.ref || null,
      count: e._count.edgeId,
    }));

    const reportsOverTime = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, count]) => ({ date, count }));

    res.json({
      totalReports: allReports.length,
      byStatus,
      byType,
      avgTimeToConfirmMin: confirmedCount > 0 ? Math.round(confirmedDurationSumMin / confirmedCount) : 0,
      topRoads,
      reportsOverTime,
      recentFeed: recentReports,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'DASHBOARD_FAILED', message: err.message });
  }
});

router.get('/events/stream', requireRole('admin', 'moderator'), (req: Request, res: Response): void => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ==========================================
// 3. HAZARD QUEUE & DETAIL
// ==========================================

router.get('/hazards', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      q,
      status,
      type,
      severity,
      source,
      dateFrom,
      dateTo,
      road,
      flaggedOnly,
      needsReview,
      sortBy = 'reportedAt',
      sortDir = 'desc',
      page = '1',
      limit = '25',
    } = req.query as Record<string, string>;

    const where: any = {};
    if (status && status !== 'all') where.status = status;
    if (type && type !== 'all') where.type = type;
    if (severity && severity !== 'all') where.severity = severity;
    if (source && source !== 'all') where.source = source;
    if (road) where.edgeId = { contains: road, mode: 'insensitive' };
    if (dateFrom || dateTo) {
      where.reportedAt = {};
      if (dateFrom) where.reportedAt.gte = new Date(dateFrom);
      if (dateTo) where.reportedAt.lte = new Date(dateTo);
    }
    if (flaggedOnly === 'true') {
      where.device = { isFlagged: true };
    }
    if (q) {
      where.OR = [
        { note: { contains: q, mode: 'insensitive' } },
        { type: { contains: q, mode: 'insensitive' } },
        { edgeId: { contains: q, mode: 'insensitive' } },
        { deviceId: { contains: q, mode: 'insensitive' } },
      ];
    }

    const allForCounts = await prisma.hazardReport.groupBy({
      by: ['status'],
      _count: { status: true },
    });
    const statusCounts: Record<string, number> = { unverified: 0, confirmed: 0, cleared: 0, expired: 0, rejected: 0 };
    for (const row of allForCounts) {
      statusCounts[row.status] = row._count.status;
    }

    const orderField = ['reportedAt', 'severity', 'status', 'confirmCount', 'expiresAt'].includes(sortBy)
      ? sortBy
      : 'reportedAt';
    const orderDir = sortDir === 'asc' ? 'asc' : 'desc';

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const items = await prisma.hazardReport.findMany({
      where,
      include: {
        device: { select: { deviceId: true, reliabilityScore: true, isFlagged: true, isShadowBanned: true, isBlocked: true } },
        votes: { select: { vote: true } },
      },
      orderBy: { [orderField]: orderDir },
    });

    const filtered = items.filter((item) => {
      if (needsReview === 'true') {
        const noVotes = item.votes.filter((v) => v.vote === 'no').length;
        const isDisputed = noVotes >= 1 || (item.confirmCount > 0 && item.clearCount > 0);
        return isDisputed || item.device?.isFlagged;
      }
      return true;
    });

    const total = filtered.length;
    const paged = filtered.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    // Attach road names
    const edgeIds = [...new Set(paged.map((p) => p.edgeId).filter(Boolean) as string[])];
    const segments = edgeIds.length
      ? await prisma.roadSegment.findMany({ where: { id: { in: edgeIds } }, select: { id: true, name: true, ref: true } })
      : [];
    const segMap = new Map(segments.map((s) => [s.id, s]));

    const enriched = paged.map((p) => ({
      ...p,
      roadName: p.edgeId ? segMap.get(p.edgeId)?.name || p.edgeId : 'Unsnapped',
      roadRef: p.edgeId ? segMap.get(p.edgeId)?.ref || null : null,
      noCount: p.votes.filter((v) => v.vote === 'no').length,
    }));

    res.json({
      items: enriched,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
      statusCounts,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'ADMIN_QUEUE_FAILED', message: err.message });
  }
});

router.get('/hazards/:id', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const report = await prisma.hazardReport.findUnique({
      where: { id },
      include: {
        device: true,
        votes: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!report) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Hazard report not found.' });
      return;
    }

    const [segment, events] = await Promise.all([
      report.edgeId ? prisma.roadSegment.findUnique({ where: { id: report.edgeId } }) : Promise.resolve(null),
      prisma.hazardEvent.findMany({ where: { reportId: id }, orderBy: { createdAt: 'asc' } }),
    ]);

    const votesWithDistance = report.votes.map((v) => ({
      id: v.id,
      deviceShortId: v.deviceId.slice(0, 12),
      deviceId: v.deviceId,
      vote: v.vote,
      distanceMeters:
        v.lat !== null && v.lng !== null
          ? Math.round(calculateHaversineDistanceMeters(v.lat, v.lng, report.lat, report.lng))
          : null,
      createdAt: v.createdAt,
    }));

    res.json({
      report,
      segment: segment
        ? { id: segment.id, name: segment.name, ref: segment.ref, status: segment.status, coordinatesJson: segment.coordinatesJson }
        : null,
      votes: votesWithDistance,
      events,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'ADMIN_DETAIL_FAILED', message: err.message });
  }
});

// ==========================================
// 4. CREATE OFFICIAL HAZARD & MODERATE / EDIT / BULK
// ==========================================

router.post('/hazards', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, severity = 'high', latitude, longitude, note, vehicleClasses, expiresAt } = req.body;
    if (!type || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'type, latitude, and longitude are required.' });
      return;
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const snap = await snapToNearestRoadEdge(lat, lng);
    const settings = await getAppSettings();
    const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + settings.defaultExpiryHours * 3600 * 1000);

    // Ensure admin system device profile exists
    const adminDeviceId = `admin-${req.admin!.id.slice(0, 8)}`;
    await prisma.deviceProfile.upsert({
      where: { deviceId: adminDeviceId },
      update: { lastActiveAt: new Date() },
      create: { deviceId: adminDeviceId, reliabilityScore: 2.0 },
    });

    const report = await prisma.hazardReport.create({
      data: {
        type,
        severity,
        edgeId: snap.edgeId,
        lat: snap.snapLat,
        lng: snap.snapLng,
        status: 'confirmed',
        source: 'admin',
        vehicleClassesJson: Array.isArray(vehicleClasses) ? JSON.stringify(vehicleClasses) : null,
        confirmCount: 1,
        clearCount: 0,
        note: note || `Official ${type.replace(/_/g, ' ')} advisory`,
        deviceId: adminDeviceId,
        expiresAt: expiry,
      },
    });

    await prisma.hazardEvent.create({
      data: {
        reportId: report.id,
        eventType: 'ADMIN_CREATED',
        deviceId: adminDeviceId,
        edgeId: report.edgeId,
        payloadJson: JSON.stringify({ adminEmail: req.admin!.email, type, severity, vehicleClasses }),
      },
    });

    await syncRoadSegmentStatusForEdge(report.edgeId);

    await logAdminAction({
      adminId: req.admin!.id,
      adminEmail: req.admin!.email,
      action: 'CREATE_OFFICIAL_HAZARD',
      targetType: 'hazard_report',
      targetId: report.id,
      after: report,
      ipAddress: getClientIp(req),
    });

    broadcastAdminEvent('hazard_created', { id: report.id, type: report.type, status: report.status, source: 'admin' });
    res.status(201).json({ report, snappedEdge: snap });
  } catch (err: any) {
    res.status(500).json({ error: 'CREATE_OFFICIAL_HAZARD_FAILED', message: err.message });
  }
});

router.patch('/hazards/:id', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const before = await prisma.hazardReport.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Hazard report not found.' });
      return;
    }

    const { action, reason, type, severity, note, latitude, longitude, extendHours, vehicleClasses } = req.body;
    const updates: any = {};

    if (type !== undefined) updates.type = type;
    if (severity !== undefined) updates.severity = severity;
    if (note !== undefined) updates.note = note;
    if (Array.isArray(vehicleClasses)) updates.vehicleClassesJson = JSON.stringify(vehicleClasses);

    if (latitude !== undefined && longitude !== undefined) {
      const snap = await snapToNearestRoadEdge(parseFloat(latitude), parseFloat(longitude));
      updates.lat = snap.snapLat;
      updates.lng = snap.snapLng;
      updates.edgeId = snap.edgeId;
    }

    if (action === 'confirm') {
      updates.status = 'confirmed';
      updates.source = 'admin';
    } else if (action === 'reject') {
      updates.status = 'rejected';
      updates.rejectedReason = reason || 'Rejected by moderator';
      updates.source = 'admin';
    } else if (action === 'clear') {
      updates.status = 'cleared';
      updates.source = 'admin';
    } else if (action === 'expire_now') {
      updates.status = 'expired';
      updates.expiresAt = new Date();
    } else if (action === 'extend_expiry') {
      const hrs = parseFloat(extendHours) || 6;
      updates.expiresAt = new Date(Math.max(Date.now(), before.expiresAt.getTime()) + hrs * 3600 * 1000);
    } else if (action === 'delete_photo') {
      updates.photoUrl = null;
    }

    const after = await prisma.hazardReport.update({
      where: { id },
      data: updates,
    });

    await prisma.hazardEvent.create({
      data: {
        reportId: id,
        eventType: action ? `ADMIN_${action.toUpperCase()}` : 'ADMIN_EDITED',
        edgeId: after.edgeId,
        payloadJson: JSON.stringify({ adminEmail: req.admin!.email, updates }),
      },
    });

    // Re-sync both old and new edges if location changed
    if (before.edgeId && before.edgeId !== after.edgeId) {
      await syncRoadSegmentStatusForEdge(before.edgeId);
    }
    await syncRoadSegmentStatusForEdge(after.edgeId);

    await logAdminAction({
      adminId: req.admin!.id,
      adminEmail: req.admin!.email,
      action: action ? `HAZARD_${action.toUpperCase()}` : 'HAZARD_EDIT',
      targetType: 'hazard_report',
      targetId: id,
      before,
      after,
      ipAddress: getClientIp(req),
    });

    broadcastAdminEvent('hazard_updated', { id: after.id, status: after.status });
    res.json({ report: after });
  } catch (err: any) {
    res.status(500).json({ error: 'UPDATE_HAZARD_FAILED', message: err.message });
  }
});

router.post('/hazards/bulk', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { ids, action, reason } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !action) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ids array and action are required.' });
      return;
    }

    const affectedEdges = new Set<string>();
    const existing = await prisma.hazardReport.findMany({ where: { id: { in: ids } } });
    for (const r of existing) {
      if (r.edgeId) affectedEdges.add(r.edgeId);
    }

    if (action === 'delete') {
      await prisma.hazardReport.deleteMany({ where: { id: { in: ids } } });
    } else {
      const data: any = {};
      if (action === 'confirm') {
        data.status = 'confirmed';
        data.source = 'admin';
      } else if (action === 'reject') {
        data.status = 'rejected';
        data.rejectedReason = reason || 'Bulk rejected';
        data.source = 'admin';
      } else if (action === 'clear') {
        data.status = 'cleared';
        data.source = 'admin';
      } else if (action === 'expire_now') {
        data.status = 'expired';
        data.expiresAt = new Date();
      }
      await prisma.hazardReport.updateMany({ where: { id: { in: ids } }, data });
    }

    for (const edgeId of affectedEdges) {
      await syncRoadSegmentStatusForEdge(edgeId);
    }

    await logAdminAction({
      adminId: req.admin!.id,
      adminEmail: req.admin!.email,
      action: `BULK_${action.toUpperCase()}`,
      targetType: 'hazard_report',
      before: { count: existing.length, ids },
      after: { action, reason },
      ipAddress: getClientIp(req),
    });

    res.json({ updatedCount: existing.length, action });
  } catch (err: any) {
    res.status(500).json({ error: 'BULK_ACTION_FAILED', message: err.message });
  }
});

router.delete('/hazards/:id', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const before = await prisma.hazardReport.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Hazard report not found.' });
      return;
    }

    await prisma.hazardReport.delete({ where: { id } });
    await syncRoadSegmentStatusForEdge(before.edgeId);

    await logAdminAction({
      adminId: req.admin!.id,
      adminEmail: req.admin!.email,
      action: 'HAZARD_DELETE',
      targetType: 'hazard_report',
      targetId: id,
      before,
      ipAddress: getClientIp(req),
    });

    res.json({ deleted: true, id });
  } catch (err: any) {
    res.status(500).json({ error: 'DELETE_HAZARD_FAILED', message: err.message });
  }
});

// ==========================================
// 5. ABUSE & DEVICE MANAGEMENT
// ==========================================

router.get('/devices', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const devices = await prisma.deviceProfile.findMany({
      orderBy: [{ isBlocked: 'desc' }, { isFlagged: 'desc' }, { lastActiveAt: 'desc' }],
      take: 200,
    });
    res.json({ devices });
  } catch (err: any) {
    res.status(500).json({ error: 'FETCH_DEVICES_FAILED', message: err.message });
  }
});

router.patch('/devices/:deviceId', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deviceId } = req.params;
    const { action } = req.body;
    const before = await prisma.deviceProfile.findUnique({ where: { deviceId } });
    if (!before) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Device profile not found.' });
      return;
    }

    const data: any = {};
    if (action === 'flag') data.isFlagged = true;
    else if (action === 'unflag') data.isFlagged = false;
    else if (action === 'shadow_ban') data.isShadowBanned = true;
    else if (action === 'unshadow_ban') data.isShadowBanned = false;
    else if (action === 'block') data.isBlocked = true;
    else if (action === 'unblock') data.isBlocked = false;
    else {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid device action.' });
      return;
    }

    const after = await prisma.deviceProfile.update({ where: { deviceId }, data });

    await logAdminAction({
      adminId: req.admin!.id,
      adminEmail: req.admin!.email,
      action: `DEVICE_${action.toUpperCase()}`,
      targetType: 'device_profile',
      targetId: deviceId,
      before,
      after,
      ipAddress: getClientIp(req),
    });

    res.json({ device: after });
  } catch (err: any) {
    res.status(500).json({ error: 'UPDATE_DEVICE_FAILED', message: err.message });
  }
});

// ==========================================
// 6. SETTINGS (Admin role ONLY)
// ==========================================

const settingsSchema = z.object({
  confirmThreshold: z.number().int().min(1).max(20),
  clearThreshold: z.number().int().min(1).max(20),
  defaultExpiryHours: z.number().int().min(1).max(168),
  proximityRadiusKm: z.number().min(0.5).max(50),
  maxReportsPerHour: z.number().int().min(1).max(100),
});

router.get('/settings', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const settings = await getAppSettings();
    res.json({ settings });
  } catch (err: any) {
    res.status(500).json({ error: 'FETCH_SETTINGS_FAILED', message: err.message });
  }
});

router.put('/settings', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.errors.map((e) => e.message).join(', ') });
      return;
    }

    const before = await getAppSettings();
    const after = await prisma.appSettings.update({
      where: { id: 'global' },
      data: {
        ...parsed.data,
        version: before.version + 1,
        updatedBy: req.admin!.email,
      },
    });

    await logAdminAction({
      adminId: req.admin!.id,
      adminEmail: req.admin!.email,
      action: 'SETTINGS_UPDATED',
      targetType: 'app_settings',
      targetId: 'global',
      before,
      after,
      ipAddress: getClientIp(req),
    });

    res.json({ settings: after });
  } catch (err: any) {
    res.status(500).json({ error: 'UPDATE_SETTINGS_FAILED', message: err.message });
  }
});

// ==========================================
// 7. AUDIT LOG & EXPORT
// ==========================================

router.get('/audit', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '30', 10)));

    const [items, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.adminAuditLog.count(),
    ]);

    res.json({ items, total, page, limit });
  } catch (err: any) {
    res.status(500).json({ error: 'FETCH_AUDIT_FAILED', message: err.message });
  }
});

router.get('/export', requireRole('admin', 'moderator'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { format = 'csv', status, type } = req.query as Record<string, string>;
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    if (type && type !== 'all') where.type = type;

    const reports = await prisma.hazardReport.findMany({
      where,
      orderBy: { reportedAt: 'desc' },
    });

    if (format === 'geojson') {
      res.setHeader('Content-Type', 'application/geo+json');
      res.setHeader('Content-Disposition', 'attachment; filename="roadsafe_hazards.geojson"');
      res.json({
        type: 'FeatureCollection',
        features: reports.map((r) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
          properties: {
            id: r.id,
            type: r.type,
            severity: r.severity,
            status: r.status,
            source: r.source,
            edgeId: r.edgeId,
            confirmCount: r.confirmCount,
            clearCount: r.clearCount,
            note: r.note,
            reportedAt: r.reportedAt,
            expiresAt: r.expiresAt,
          },
        })),
      });
      return;
    }

    // Default CSV
    const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const header = 'id,type,severity,status,source,edgeId,lat,lng,confirmCount,clearCount,note,reportedAt,expiresAt';
    const rows = reports.map((r) =>
      [r.id, r.type, r.severity, r.status, r.source, r.edgeId, r.lat, r.lng, r.confirmCount, r.clearCount, r.note, r.reportedAt.toISOString(), r.expiresAt.toISOString()]
        .map(escapeCsv)
        .join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="roadsafe_hazards.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err: any) {
    res.status(500).json({ error: 'EXPORT_FAILED', message: err.message });
  }
});

export default router;

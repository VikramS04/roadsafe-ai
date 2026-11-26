import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const ADMIN_COOKIE_NAME = 'roadsafe_admin_token';
export const CSRF_COOKIE_NAME = 'roadsafe_csrf';

function getAdminJwtSecret(): string {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'roadsafe_dev_admin_jwt_secret_change_in_prod';
}

export interface AdminTokenPayload {
  id: string;
  email: string;
  role: 'admin' | 'moderator';
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
    }
  }
}

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, getAdminJwtSecret(), { expiresIn: '2h' });
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// Login rate limiter and account lockout (5 failures -> 15 min lockout)
interface LoginAttemptRecord {
  failures: number;
  lockedUntil: number | null;
}

const loginAttempts = new Map<string, LoginAttemptRecord>();
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSec?: number } {
  const rec = loginAttempts.get(key);
  if (!rec) return { allowed: true };
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
    loginAttempts.delete(key);
  }
  return { allowed: true };
}

export function recordLoginFailure(key: string): void {
  const rec = loginAttempts.get(key) || { failures: 0, lockedUntil: null };
  rec.failures += 1;
  if (rec.failures >= MAX_LOGIN_FAILURES) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(key, rec);
}

export function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}

export function resetAllLoginAttemptsForTest(): void {
  loginAttempts.clear();
}

export async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[ADMIN_COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Admin authentication required.' });
      return;
    }

    const decoded = jwt.verify(token, getAdminJwtSecret()) as AdminTokenPayload;
    const user = await prisma.adminUser.findUnique({ where: { id: decoded.id } });

    if (!user || user.disabled) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Admin account disabled or not found.' });
      return;
    }

    req.admin = {
      id: user.id,
      email: user.email,
      role: user.role as 'admin' | 'moderator',
    };
    next();
  } catch {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired admin session.' });
  }
}

export function requireRole(...roles: Array<'admin' | 'moderator'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.admin.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Role "${req.admin.role}" does not have permission for this action.`,
      });
      return;
    }
    next();
  };
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || typeof headerToken !== 'string' || cookieToken !== headerToken) {
    res.status(403).json({ error: 'CSRF_INVALID', message: 'Missing or invalid CSRF token.' });
    return;
  }
  next();
}

export async function logAdminAction(params: {
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      adminEmail: params.adminEmail,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId || null,
      beforeJson: params.before !== undefined ? JSON.stringify(params.before) : null,
      afterJson: params.after !== undefined ? JSON.stringify(params.after) : null,
      ipAddress: params.ipAddress || null,
    },
  });
}

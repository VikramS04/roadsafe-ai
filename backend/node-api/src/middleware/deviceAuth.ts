import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      device?: {
        deviceId: string;
        reliabilityScore: number;
      };
    }
  }
}

/**
 * Anonymous Device Identity Middleware
 * No signup or passwords. Reads x-device-id from header (or generates one).
 * Ensures DeviceProfile exists in PostgreSQL with its reliability score.
 */
export async function deviceAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let deviceId = (req.headers['x-device-id'] as string) || (req.query.device_id as string);

    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length < 8) {
      deviceId = crypto.randomUUID();
    } else {
      deviceId = deviceId.trim();
    }

    res.setHeader('X-Device-Id', deviceId);

    let device = await prisma.deviceProfile.findUnique({
      where: { deviceId },
    });

    if (!device) {
      device = await prisma.deviceProfile.create({
        data: {
          deviceId,
          reliabilityScore: 1.0,
        },
      });
    } else {
      await prisma.deviceProfile.update({
        where: { deviceId },
        data: { lastActiveAt: new Date() },
      });
    }

    req.device = {
      deviceId: device.deviceId,
      reliabilityScore: device.reliabilityScore,
    };

    next();
  } catch (error) {
    console.error('Device auth error:', error);
    req.device = {
      deviceId: 'anon-' + crypto.randomUUID().slice(0, 8),
      reliabilityScore: 1.0,
    };
    next();
  }
}

/**
 * Rate-limit hazard reports per device: max 10 per hour
 */
export async function rateLimitReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  const deviceId = req.device?.deviceId;
  if (!deviceId) {
    res.status(401).json({ error: 'DEVICE_ID_REQUIRED', message: 'Anonymous device identification is required.' });
    return;
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentReportsCount = await prisma.hazardReport.count({
    where: {
      deviceId,
      reportedAt: { gte: oneHourAgo },
    },
  });

  if (recentReportsCount >= 10) {
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Report limit reached (maximum 10 reports per hour per device). Please try again later.',
    });
    return;
  }

  next();
}

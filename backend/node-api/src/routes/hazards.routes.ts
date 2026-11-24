import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  createHazardReport,
  voteOnHazardReport,
  getActiveHazards,
} from '../services/hazard.service';
import { deviceAuth, rateLimitReports } from '../middleware/deviceAuth';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/v1/hazards
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const minLat = req.query.minLat ? parseFloat(req.query.minLat as string) : undefined;
    const minLng = req.query.minLng ? parseFloat(req.query.minLng as string) : undefined;
    const maxLat = req.query.maxLat ? parseFloat(req.query.maxLat as string) : undefined;
    const maxLng = req.query.maxLng ? parseFloat(req.query.maxLng as string) : undefined;

    let bbox = undefined;
    if (minLat !== undefined && minLng !== undefined && maxLat !== undefined && maxLng !== undefined) {
      bbox = { minLat, minLng, maxLat, maxLng };
    }

    const hazards = await getActiveHazards(bbox);
    res.json({ hazards, count: hazards.length });
  } catch (err: any) {
    res.status(500).json({ error: 'FETCH_HAZARDS_FAILED', message: err.message });
  }
});

/**
 * GET /api/v1/hazards/:id
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const hazard = await prisma.hazardReport.findUnique({
      where: { id },
      include: {
        votes: {
          select: { id: true, vote: true, createdAt: true },
        },
      },
    });

    if (!hazard) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Hazard report not found.' });
      return;
    }

    res.json({ hazard });
  } catch (err: any) {
    res.status(500).json({ error: 'FETCH_HAZARD_FAILED', message: err.message });
  }
});

/**
 * POST /api/v1/hazards
 */
router.post('/', deviceAuth, rateLimitReports, async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, severity = 'medium', latitude, longitude, edge_id, edgeId, note, photo_url } = req.body;

    if (!type || latitude === undefined || longitude === undefined) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'type, latitude, and longitude are required.',
      });
      return;
    }

    const deviceId = req.device!.deviceId;

    const report = await createHazardReport({
      deviceId,
      type,
      severity,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      edgeId: edge_id || edgeId,
      note,
      photoUrl: photo_url,
    });

    res.status(201).json({
      message: 'Hazard report submitted successfully.',
      report,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'CREATE_REPORT_FAILED', message: err.message });
  }
});

/**
 * POST /api/v1/hazards/:id/vote
 */
router.post('/:id/vote', deviceAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { vote, voter_latitude, voter_longitude } = req.body;

    if (!vote || !['yes', 'no', 'cleared'].includes(vote)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'vote must be "yes", "no", or "cleared".',
      });
      return;
    }

    const deviceId = req.device!.deviceId;

    const voterLat = voter_latitude !== undefined ? parseFloat(voter_latitude) : undefined;
    const voterLng = voter_longitude !== undefined ? parseFloat(voter_longitude) : undefined;

    const result = await voteOnHazardReport({
      reportId: id,
      deviceId,
      vote,
      voterLatitude: voterLat,
      voterLongitude: voterLng,
    });

    res.json({
      message: 'Vote recorded successfully.',
      statusChanged: result.statusChanged,
      newStatus: result.report.status,
      confirmCount: result.report.confirmCount,
      clearCount: result.report.clearCount,
      report: result.report,
    });
  } catch (err: any) {
    if (err.message && err.message.includes('Unique constraint failed')) {
      res.status(409).json({
        error: 'ALREADY_VOTED',
        message: 'This device has already voted on this hazard report.',
      });
      return;
    }
    if (err.message && err.message.includes('Proximity validation failed')) {
      res.status(403).json({
        error: 'PROXIMITY_ERROR',
        message: err.message,
      });
      return;
    }
    res.status(500).json({ error: 'VOTE_FAILED', message: err.message });
  }
});

export default router;

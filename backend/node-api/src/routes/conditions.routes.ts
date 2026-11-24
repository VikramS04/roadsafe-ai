import { Router, Request, Response } from 'express';
import { getLiveWeather } from '../services/weather.service';
import { getActiveOfficialAlerts } from '../services/alert.service';

const router = Router();

/**
 * GET /api/v1/conditions
 * Returns combined live weather and active official alerts for the region or requested bbox
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : 25.4;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : 91.8;

    const [weather, alerts] = await Promise.all([
      getLiveWeather(lat, lng),
      getActiveOfficialAlerts(),
    ]);

    res.json({
      weather,
      alerts,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'FETCH_CONDITIONS_FAILED', message: err.message });
  }
});

export default router;

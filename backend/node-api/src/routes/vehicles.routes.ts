import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/v1/vehicles
 * Public list of supported vehicles: Bike, Car, SUV/Jeep, Truck, Ambulance
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const vehicles = await prisma.vehicleProfile.findMany({
      orderBy: { id: 'asc' },
    });
    res.json({ status: 'success', data: vehicles });
  } catch (error: any) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

export default router;

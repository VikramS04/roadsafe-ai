import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { checkPythonHealth } from '../integrations/pythonRouting';

const router = Router();
const prisma = new PrismaClient();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (e) {
    dbOk = false;
  }

  const pythonOk = await checkPythonHealth();

  const isHealthy = dbOk && pythonOk;

  res.status(isHealthy ? 200 : 207).json({
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'roadsafe-node-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    dependencies: {
      database: dbOk ? 'healthy' : 'unreachable',
      python_routing_microservice: pythonOk ? 'healthy' : 'unreachable',
    },
  });
});

export default router;


import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import geocodeRoutes from './routes/geocode.routes';
import routesRoutes from './routes/routes.routes';
import hazardRoutes from './routes/hazards.routes';
import conditionsRoutes from './routes/conditions.routes';
import vehicleRoutes from './routes/vehicles.routes';
import segmentRoutes from './routes/segments.routes';
import healthRoutes from './routes/health.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parser Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/api/v1/health') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Mount Public REST APIs under /api/v1
app.use('/api/v1/geocode', geocodeRoutes);
app.use('/api/v1/routes', routesRoutes);
app.use('/api/v1/hazards', hazardRoutes);
app.use('/api/v1/conditions', conditionsRoutes);
app.use('/api/v1/vehicles', vehicleRoutes);
app.use('/api/v1/segments', segmentRoutes);
app.use('/api/v1', segmentRoutes); // mounts /api/v1/roads/geojson and /api/v1/nodes
app.use('/api/v1/health', healthRoutes);

// Root information endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'RoadSafe AI Public Driver API',
    description: 'Public, map-first disaster-aware routing and community hazard API',
    version: '2.0.0',
    public_api_root: '/api/v1',
    endpoints: {
      geocode: 'GET /api/v1/geocode?q=',
      routes: 'POST /api/v1/routes',
      hazards: 'GET /api/v1/hazards, POST /api/v1/hazards, POST /api/v1/hazards/:id/vote',
      conditions: 'GET /api/v1/conditions',
      vehicles: 'GET /api/v1/vehicles',
      segments: 'GET /api/v1/roads/geojson, GET /api/v1/segments/:id/passability',
      health: 'GET /api/v1/health',
    },
  });
});

// Central 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'ENDPOINT_NOT_FOUND',
    message: `Resource ${req.method} ${req.originalUrl} does not exist.`,
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: process.env.NODE_ENV === 'production' ? 'An internal error occurred.' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  RoadSafe AI Public Driver API listening on port ${PORT}`);
  console.log(`  Public API Endpoint: http://localhost:${PORT}/api/v1`);
  console.log(`  Health Check:        http://localhost:${PORT}/api/v1/health`);
  console.log(`=======================================================`);
});

export default app;

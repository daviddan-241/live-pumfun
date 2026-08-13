// @ts-nocheck
import express from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import config from '../config.js';
import { router as apiRouter } from './routes.js';
import { sseManager } from './sse.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DashboardServer');

let serverInstance: http.Server | null = null;
let appInstance: express.Application | null = null;

export function createExpressApp(): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Static directory setup (support both source ts and compiled dist)
  const publicPathSrc = path.resolve(process.cwd(), 'src/dashboard/public');
  const publicPathDist = path.resolve(process.cwd(), 'dist/dashboard/public');

  app.use(express.static(publicPathSrc));
  app.use(express.static(publicPathDist));

  // SSE stream endpoint
  app.get('/api/events', (req, res) => {
    sseManager.addClient(res);
  });

  // Mount API router
  app.use('/api', apiRouter);

  // Fallback route for single-page dashboard app
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'API endpoint not found' });
      return;
    }
    const htmlSrc = path.join(publicPathSrc, 'index.html');
    const htmlDist = path.join(publicPathDist, 'index.html');
    res.sendFile(htmlSrc, (err) => {
      if (err) {
        res.sendFile(htmlDist, (err2) => {
          if (err2) {
            res.status(404).send('Dashboard index.html not found');
          }
        });
      }
    });
  });

  return app;
}

export function startServer(port: number = config.DASHBOARD_PORT || 3000): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    if (serverInstance) {
      logger.info('Dashboard server is already running');
      resolve(serverInstance);
      return;
    }

    appInstance = createExpressApp();
    serverInstance = appInstance.listen(port, () => {
      logger.info(`Dashboard server running on port ${port}`);
      resolve(serverInstance!);
    });

    serverInstance.on('error', (err) => {
      logger.error('Dashboard server failed to start:', err.message);
      reject(err);
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    sseManager.stopHeartbeat();

    if (!serverInstance) {
      resolve();
      return;
    }

    serverInstance.close((err) => {
      if (err) {
        logger.error('Error stopping dashboard server:', err.message);
        reject(err);
        return;
      }
      logger.info('Dashboard server stopped');
      serverInstance = null;
      appInstance = null;
      resolve();
    });
  });
}

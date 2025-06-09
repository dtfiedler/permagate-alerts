import { Router } from 'express';
import { apiRouter } from './routes/api.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import * as config from './config.js';

export const router = Router();

// default supported routes
router.use(apiRouter);
router.use(adminRouter);

if (config.enableHostedFrontend) {
  router.use(publicRouter);
}

import { Router } from 'express';
import { apiRouter } from './routes/api.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';

export const router = Router();

// default supported routes
router.use(apiRouter);
router.use(adminRouter);
router.use(publicRouter);

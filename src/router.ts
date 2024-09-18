import { Router } from 'express';
import { apiRouter } from './routes/api.js';
import { publicRouter } from './routes/public.js';
import { arioRouter } from './routes/ar-io.js';
import { adminRouter } from './routes/admin.js';

export const router = Router();

router.use(apiRouter);
router.use(arioRouter);
router.use(adminRouter);
router.use(publicRouter);

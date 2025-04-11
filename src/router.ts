import { Router } from 'express';
import { apiRouter } from './routes/api.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { stripeRouter } from './routes/stripe.js';
export const router = Router();

router.use(apiRouter);
router.use(stripeRouter);
router.use(adminRouter);
router.use(publicRouter);

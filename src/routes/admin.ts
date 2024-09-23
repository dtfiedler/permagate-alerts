import { Router } from 'express';
import { adminMiddleware } from '../middleware/admin.js';

const adminRouter = Router();

// any admin routes here
adminRouter.use('/api/admin', adminMiddleware);

export { adminRouter };

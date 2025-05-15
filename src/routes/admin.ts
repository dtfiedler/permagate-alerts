import { Router } from 'express';
import { adminMiddleware } from '../middleware/admin.js';
import { arioNetworkPoller } from '../system.js';
import { logger } from '../logger.js';
const adminRouter = Router();

// any admin routes here
adminRouter.use('/api/admin', adminMiddleware);

// trigger network event processing
let isProcessing = false;
adminRouter.post('/api/admin/process/network-events', (_req, res) => {
  if (isProcessing) {
    res.status(200).send('Network event processing already in progress');
    return;
  }
  isProcessing = true;
  arioNetworkPoller
    .processArNSExpirationEvents()
    .then(() => {
      logger.info('ArNS expiration events processed');
    })
    .catch((error) => {
      logger.error('Error processing ArNS expiration events', error);
    })
    .finally(() => {
      isProcessing = false;
    });
  res.send('Network event processing triggered');
});

export { adminRouter };

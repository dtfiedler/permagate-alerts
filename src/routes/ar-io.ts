import { Router, Response } from 'express';
import { Request } from '../types.js';
const arioRouter = Router();

// Define route for /ar-io/webhook
// @ts-ignore
arioRouter.post('/ar-io/webhook', (req: Request, res: Response) => {
  // Handle the webhook request here
  req.logger.info('Received webhook:', req.body);

  // Send a response
  res.status(200).json({ message: 'Webhook received successfully' });
});

export { arioRouter };

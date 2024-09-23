import { Router, Response } from 'express';
import { Request } from '../types.js';
import { NewEvent } from '../db/schema.js';

const arioRouter = Router();

// Define route for /ar-io/webhook
// @ts-ignore
arioRouter.post('/ar-io/webhook', async (req: Request, res: Response) => {
  // Handle the webhook request here
  req.logger.info('Received webhook:', req.body);
  try {
    const event: NewEvent = JSON.parse(req.body);
    req.processor.processEvent(event); // don't await this
    // Send a response
    res.status(200).json({ message: 'Webhook received successfully' });
  } catch (error: any) {
    // catch the error if conflict on insert
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      req.logger.info('Event already exists:', error);
      return res.status(202).json({ message: 'Webhook received successfully' });
    }
    req.logger.error('Error creating event:', {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export { arioRouter };

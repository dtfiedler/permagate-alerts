import { Router, Response } from 'express';
import { Request } from '../types.js';
import { aoRawEventSchema } from '../db/schema.js';
import { ZodError } from 'zod';

const arioRouter = Router();

// Define route for /ar-io/webhook
// @ts-ignore
arioRouter.post('/ar-io/webhook', async (req: Request, res: Response) => {
  // Handle the webhook request here
  req.logger.info('Received webhook:', req.body);
  try {
    const parsedEvent = aoRawEventSchema.parse(req.body);
    req.processor.processEvent(parsedEvent); // don't await this
    res.status(200).json({ message: 'Webhook received successfully' });
  } catch (error: any) {
    // catch the error if conflict on insert
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      req.logger.info('Event already exists:', error);
      return res.status(202).json({ message: 'Webhook received successfully' });
    }
    if (error instanceof ZodError) {
      req.logger.error('Error creating event:', {
        message: error.message,
      });
      return res.status(400).json({ message: 'Bad request' });
    }
    req.logger.error('Error creating event:', {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export { arioRouter };

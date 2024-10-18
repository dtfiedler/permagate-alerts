import { Router, Response } from 'express';
import { Request } from '../types.js';
import { schemas } from '../db/schema.js';
import { ZodError } from 'zod';

const arioRouter = Router();

// Define route for /ar-io/webhook
// @ts-ignore
arioRouter.post('/ar-io/webhook', async (req: Request, res: Response) => {
  // Handle the webhook request here
  const { logger, processor } = req;
  logger.info('Received webhook event', {
    id: req.body?.event?.data?.id || 'unknown',
  });
  try {
    const parsedEvent = schemas.webhookEvent.parse(req.body.event);
    // process event in background
    processor.processEvent(parsedEvent).catch((error) => {
      logger.error('Error processing event:', {
        message: error.message,
      });
    });
    res.status(200).json({ message: 'Webhook received successfully' });
  } catch (error: any) {
    // catch the error if conflict on insert
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      logger.info('Event already exists:', error);
      return res.status(202).json({ message: 'Webhook received successfully' });
    }
    if (error instanceof ZodError) {
      logger.error('Error creating event:', {
        message: error.message,
      });
      return res.status(400).json({ message: 'Bad request' });
    }
    logger.error('Error creating event:', {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export { arioRouter };

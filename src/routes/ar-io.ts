import { Router } from 'express';

const arioRouter = Router();

// Define route for /ar-io/webhook
arioRouter.post('/ar-io/webhook', (req, res) => {
  // Handle the webhook request here
  console.log('Received webhook:', req.body);

  // Send a response
  res.status(200).json({ message: 'Webhook received successfully' });
});

export { arioRouter };

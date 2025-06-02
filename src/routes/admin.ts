import { Router, type Response } from 'express';
import type { Request } from '../types.js';
import { adminMiddleware } from '../middleware/admin.js';
import { generateVerifyLink } from '../lib/hash.js';
import { logger } from '../logger.js';

const adminRouter = Router();

// any admin routes here
adminRouter.use('/api/admin', adminMiddleware);

adminRouter.get(
  '/api/admin/send-verification-email',
  // @ts-ignore
  async (req: Request, res: Response) => {
    try {
      const email = req.query.email as string;
      const verifyLink = generateVerifyLink(email);
      logger.info('Sending verification email', { email, verifyLink });
      await req.notifier?.sendRawEmail({
        to: [email],
        text: `Please verify your email address by clicking the link below:\n\n${verifyLink}`,
        subject: '🤖 Verify your email address',
      });
      res.status(200).send('Verification email sent');
    } catch (error) {
      logger.error('Error sending verification email', { error });
      res.status(500).send('Error sending verification email');
    }
  },
);

export { adminRouter };

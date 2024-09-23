import { Request, Response, NextFunction } from 'express';
import * as config from '../config.js';

export const adminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.headers.authorization === `Bearer ${config.adminApiKey}`) {
    return next();
  }
  res.status(401).json({
    error: 'Unauthorized',
  });
  return;
};

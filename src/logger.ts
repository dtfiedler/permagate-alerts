import { createLogger, format, transports } from 'winston';
import * as config from './config.js';

export const logger = createLogger({
  level: config.logLevel,
  format: format.combine(format.errors(), format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

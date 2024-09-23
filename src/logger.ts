import { createLogger, format, transports } from 'winston';

export const logger = createLogger({
  level: 'info',
  format: format.combine(format.errors(), format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

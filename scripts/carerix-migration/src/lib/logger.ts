import winston from 'winston';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logsDir = resolve(__dirname, '..', '..', 'logs');

const today = new Date().toISOString().slice(0, 10);

export function createLogger(): winston.Logger {
  return winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.Console({
        level: 'info',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level}: ${message}${extra}`;
          }),
        ),
      }),
      new winston.transports.File({
        filename: resolve(logsDir, `migration-${today}.log`),
        level: 'debug',
      }),
      new winston.transports.File({
        filename: resolve(logsDir, `migration-errors-${today}.log`),
        level: 'error',
      }),
    ],
  });
}

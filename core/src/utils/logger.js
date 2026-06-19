const winston = require('winston');
const { combine, timestamp, colorize, printf, errors } = winston.format;

const fmt = printf(({ timestamp: ts, level, message, stack }) =>
  stack ? `${ts} [${level}]: ${message}\n${stack}` : `${ts} [${level}]: ${message}`
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(errors({ stack: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), colorize(), fmt),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

module.exports = { logger };

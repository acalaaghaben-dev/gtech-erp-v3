// ── errorHandler.js ───────────────────────────────────────
const { logger } = require('../utils/logger');
const errorHandler = (err, req, res, _next) => {
  logger.error(`[${req.method}] ${req.path} — ${err.message}`);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'خطأ داخلي في الخادم',
    requestId: req.requestId,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
};
module.exports = { errorHandler };

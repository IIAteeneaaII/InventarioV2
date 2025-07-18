const logger = require('../utils/logger');

function loggerMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      operation: req.method + ' ' + req.originalUrl,
      user_id: req.session?.userId || 'anon',
      session_id: req.sessionID,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      ip: req.ip,
      metadata: {
        params: req.params,
        query: req.query,
        body: req.body,
      }
    });
  });
  next();
}

module.exports = loggerMiddleware;
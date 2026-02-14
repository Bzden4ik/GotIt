const db = require('../database/database');

/**
 * Middleware для обработки ошибок
 */
function errorHandler(err, req, res, next) {
  console.error('❌ Ошибка сервера:', err);
  
  // Не показываем детали ошибок пользователю в продакшене
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Внутренняя ошибка сервера' 
    : err.message;
  
  res.status(statusCode).json({
    success: false,
    error: message
  });
}

/**
 * Rate limiting - ограничение запросов
 */
const rateLimitStore = new Map();

function rateLimit(options = {}) {
  const maxRequests = options.maxRequests || 100;
  const windowMs = options.windowMs || 60 * 1000; // 1 минута
  
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    const userData = rateLimitStore.get(key);
    
    if (now > userData.resetTime) {
      userData.count = 1;
      userData.resetTime = now + windowMs;
      return next();
    }
    
    if (userData.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Слишком много запросов, попробуй позже'
      });
    }
    
    userData.count++;
    next();
  };
}

// Очистка старых данных из rate limit
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now > data.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Async handler wrapper
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  rateLimit,
  asyncHandler
};

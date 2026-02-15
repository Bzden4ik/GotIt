const jwt = require('jsonwebtoken');

/**
 * JWT Secret (должен быть в .env)
 */
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '30d'; // Токен действителен 30 дней

/**
 * Генерация JWT токена для пользователя
 */
function generateToken(userId, telegramId) {
  return jwt.sign(
    { 
      userId: userId,
      telegramId: telegramId,
      type: 'access'
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Middleware: Проверка JWT токена
 */
function authenticateToken(req, res, next) {
  // Получаем токен из заголовка Authorization
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Токен не предоставлен',
      needAuth: true
    });
  }

  // Проверяем токен
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      // Токен невалидный или истёк
      return res.status(401).json({
        success: false,
        error: 'Неверный или истёкший токен',
        needAuth: true
      });
    }

    // Добавляем данные пользователя в req
    req.user = {
      id: payload.userId,
      telegramId: payload.telegramId
    };

    next();
  });
}

/**
 * Опциональная аутентификация (не требует токен, но если есть - проверяет)
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // Нет токена - ок, идём дальше
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      // Токен есть но невалидный - игнорируем
      req.user = null;
    } else {
      req.user = {
        id: payload.userId,
        telegramId: payload.telegramId
      };
    }
    next();
  });
}

module.exports = {
  generateToken,
  authenticateToken,
  optionalAuth
};

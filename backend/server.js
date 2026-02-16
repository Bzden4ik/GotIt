const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
require('dotenv').config();

// Sentry инициализация (перед любыми импортами!)
const Sentry = require('@sentry/node');
const { ProfilingIntegration } = require('@sentry/profiling-node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app: express() }),
      new ProfilingIntegration(),
    ],
    tracesSampleRate: 0.1, // 10% транзакций
    profilesSampleRate: 0.1, // 10% профилей
  });
  console.log('✅ Sentry инициализирован');
}

const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const Scheduler = require('./scheduler');
const { errorHandler, rateLimit, asyncHandler } = require('./middleware/security');
const { generateToken, authenticateToken, optionalAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Sentry: Request handler (должен быть ПЕРВЫМ middleware)
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

// Middleware

// Helmet — security headers (XSS protection, HSTS, no-sniff, etc.)
app.use(helmet({
  contentSecurityPolicy: false, // Отключаем CSP (API-сервер, не отдаёт HTML)
  crossOriginEmbedderPolicy: false,
}));

// CORS — ограничиваем допустимые origins
const allowedOrigins = [
  'https://bzden4ik.github.io',          // GitHub Pages (production)
  'https://go-tit.ru',                   // Собственный домен
  'https://www.go-tit.ru',              // www версия
  process.env.FRONTEND_URL,               // Из переменных окружения (если задан)
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:5173'] : []),
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без origin (Telegram webhook, curl, health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`⚠ CORS заблокирован origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' })); // Ограничение размера body
app.use(rateLimit({ maxRequests: 100, windowMs: 60 * 1000 })); // 100 запросов в минуту

function verifyTelegramAuth(data) {
  if (!BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN не задан, проверка подписи пропущена');
    return true;
  }
  const { hash, ...rest } = data;
  if (!hash) return false;
  const checkString = Object.keys(rest).sort().map(key => `${key}=${rest[key]}`).join('\n');
  const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  if (hmac !== hash) return false;
  const authDate = parseInt(data.auth_date, 10);
  if (Date.now() / 1000 - authDate > 86400) return false;
  return true;
}

// Тест
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend работает!', timestamp: new Date().toISOString() });
});

// Health check — для мониторинга и uptime-сервисов
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    checks: {}
  };

  // Проверка БД (используем реальный запрос через db)
  try {
    const start = Date.now();
    await db.getUserById(0); // Лёгкий SELECT, вернёт null но проверит соединение
    health.checks.database = { status: 'ok', responseTime: Date.now() - start + 'ms' };
  } catch (error) {
    health.checks.database = { status: 'error', error: error.message };
    health.status = 'degraded';
  }

  // Проверка парсера (пингуем Fetta)
  try {
    const start = Date.now();
    const axios = require('axios');
    const response = await axios.get('https://fetta.app', { timeout: 5000, maxRedirects: 2 });
    health.checks.fetta = {
      status: response.status === 200 ? 'ok' : 'warning',
      responseTime: Date.now() - start + 'ms',
      httpStatus: response.status
    };
  } catch (error) {
    health.checks.fetta = { status: 'error', error: error.message };
    health.status = 'degraded';
  }

  // Статус планировщика
  if (schedulerRef) {
    health.checks.scheduler = {
      status: schedulerRef.isRunning ? 'running' : 'stopped',
      hasLock: schedulerRef.hasLock,
      isChecking: schedulerRef.isChecking,
      id: schedulerRef.schedulerId
    };
  } else {
    health.checks.scheduler = { status: 'not_initialized' };
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Ссылка на планировщик для health check
let schedulerRef = null;

// === Авторизация ===
app.post('/api/auth/telegram', async (req, res) => {
  const telegramData = req.body;
  if (!telegramData || !telegramData.id) {
    return res.status(400).json({ success: false, error: 'Нет данных Telegram' });
  }
  if (!verifyTelegramAuth(telegramData)) {
    return res.status(401).json({ success: false, error: 'Неверная подпись Telegram' });
  }
  try {
    await db.createUser(telegramData.id, telegramData.username || '', telegramData.first_name || '');
    const user = await db.getUserByTelegramId(telegramData.id);
    
    // Генерируем JWT токен
    const token = generateToken(user.id, user.telegram_id);
    
    console.log(`Авторизован: ${user.username} (tg: ${user.telegram_id})`);
    res.json({
      success: true,
      token: token,
      user: { 
        id: user.id, 
        telegramId: user.telegram_id, 
        username: user.username, 
        firstName: user.first_name 
      }
    });
  } catch (error) {
    console.error('Ошибка авторизации:', error);
    res.status(500).json({ success: false, error: 'Ошибка авторизации' });
  }
});

// Проверка пользователя (теперь через токен)
app.get('/api/auth/check', authenticateToken, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'Пользователь не найден', 
        needAuth: true 
      });
    }
    res.json({
      success: true,
      user: { 
        id: user.id, 
        telegramId: user.telegram_id, 
        username: user.username, 
        firstName: user.first_name 
      }
    });
  } catch (error) {
    console.error('Ошибка проверки:', error);
    res.status(500).json({ success: false, error: 'Ошибка проверки' });
  }
});

// Поиск стримера (не требует авторизации)
app.get('/api/streamer/search', async (req, res) => {
  const { nickname } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Необходимо указать nickname' });
  try {
    console.log(`Поиск стримера: ${nickname}`);
    const result = await fettaParser.getStreamerInfo(nickname);
    if (!result.success) return res.status(404).json({ success: false, error: result.error });
    res.json({ success: true, streamer: result.profile });
  } catch (error) {
    console.error('Ошибка при поиске:', error);
    res.status(500).json({ success: false, error: 'Ошибка при поиске стримера' });
  }
});

// Добавить стримера в отслеживаемые (требует авторизации)
app.post('/api/tracked', authenticateToken, async (req, res) => {
  const { nickname } = req.body;
  const userId = req.user.id; // Из JWT токена!
  
  if (!nickname) return res.status(400).json({ error: 'Необходимо указать nickname' });

  try {
    const existingStreamer = await db.getStreamerByNickname(nickname);
    if (existingStreamer) {
      const isTracked = await db.isStreamerTracked(userId, existingStreamer.id);
      if (isTracked) {
        const items = await db.getWishlistItems(existingStreamer.id);
        return res.json({ 
          success: true, 
          streamer: { ...existingStreamer, itemsCount: items.length }, 
          message: 'Стример уже в отслеживаемых' 
        });
      }
      await db.addTrackedStreamer(userId, existingStreamer.id);
      const items = await db.getWishlistItems(existingStreamer.id);
      return res.json({ success: true, streamer: { ...existingStreamer, itemsCount: items.length } });
    }

    const result = await fettaParser.getStreamerInfo(nickname);
    if (!result.success) return res.status(404).json({ success: false, error: result.error });

    const streamer = await db.createOrUpdateStreamer({
      nickname: result.profile.nickname, 
      name: result.profile.name,
      username: result.profile.username, 
      avatar: result.profile.avatar,
      description: result.profile.description, 
      fettaUrl: result.profile.fettaUrl
    });

    if (result.wishlist && result.wishlist.length > 0) {
      await db.saveWishlistItems(streamer.id, result.wishlist);
    }
    await db.addTrackedStreamer(userId, streamer.id);
    res.json({ success: true, streamer: { ...streamer, itemsCount: result.wishlist.length } });
  } catch (error) {
    console.error('Ошибка при добавлении:', error);
    res.status(500).json({ success: false, error: error.message || 'Ошибка при добавлении стримера' });
  }
});

// Список отслеживаемых (требует авторизации)
app.get('/api/tracked', authenticateToken, async (req, res) => {
  const userId = req.user.id; // Из JWT токена!
  
  try {
    // Оптимизированный запрос - получаем всё за 1 SQL запрос (с JOIN)
    const streamers = await db.getTrackedStreamers(userId);
    res.json({ success: true, streamers });
  } catch (error) {
    console.error('Ошибка при получении отслеживаемых:', error);
    res.status(500).json({ success: false, error: 'Ошибка при получении списка' });
  }
});

// Проверка отслеживания (опциональная авторизация)
app.get('/api/tracked/check/:nickname', optionalAuth, async (req, res) => {
  const { nickname } = req.params;
  const userId = req.user?.id; // Может быть null если не авторизован
  
  if (!userId) return res.json({ success: true, isTracked: false });
  
  try {
    const streamer = await db.getStreamerByNickname(nickname);
    if (!streamer) return res.json({ success: true, isTracked: false });
    const isTracked = await db.isStreamerTracked(userId, streamer.id);
    res.json({ success: true, isTracked, streamerId: streamer.id });
  } catch (error) {
    console.error('Ошибка проверки отслеживания:', error);
    res.status(500).json({ success: false, error: 'Ошибка проверки' });
  }
});

// Удалить стримера (требует авторизации)
app.delete('/api/tracked/:streamerId', authenticateToken, async (req, res) => {
  const { streamerId } = req.params;
  const userId = req.user.id; // Из JWT токена!
  
  try {
    await db.removeTrackedStreamer(userId, parseInt(streamerId));
    res.json({ success: true, message: 'Стример удален из отслеживаемых' });
  } catch (error) {
    console.error('Ошибка при удалении:', error);
    res.status(500).json({ success: false, error: 'Ошибка при удалении стримера' });
  }
});

// Вишлист стримера (не требует авторизации)
app.get('/api/streamer/:id/wishlist', async (req, res) => {
  const { id } = req.params;
  try {
    const streamer = await db.getStreamerById(parseInt(id));
    if (!streamer) return res.status(404).json({ success: false, error: 'Стример не найден' });
    const items = await db.getWishlistItems(streamer.id);
    res.json({ success: true, items });
  } catch (error) {
    console.error('Ошибка при получении вишлиста:', error);
    res.status(500).json({ success: false, error: 'Ошибка при получении вишлиста' });
  }
});

// === Настройки уведомлений (требуют авторизации) ===

// Получить настройки уведомлений для стримера
app.get('/api/user/streamer/:streamerId/settings', authenticateToken, async (req, res) => {
  const { streamerId } = req.params;
  const userId = req.user.id; // Из JWT токена!
  
  try {
    const settings = await db.getStreamerSettings(userId, parseInt(streamerId));
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Ошибка получения настроек:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения настроек' });
  }
});

// Обновить настройки уведомлений для стримера
app.put('/api/user/streamer/:streamerId/settings', authenticateToken, async (req, res) => {
  const { streamerId } = req.params;
  const userId = req.user.id; // Из JWT токена!
  const { notifications_enabled, notify_in_pm } = req.body;
  
  try {
    await db.updateStreamerSettings(userId, parseInt(streamerId), {
      notifications_enabled: notifications_enabled ? 1 : 0,
      notify_in_pm: notify_in_pm ? 1 : 0
    });
    res.json({ success: true, message: 'Настройки обновлены' });
  } catch (error) {
    console.error('Ошибка обновления настроек:', error);
    res.status(500).json({ success: false, error: 'Ошибка обновления настроек' });
  }
});

// Получить группы пользователя
app.get('/api/user/groups', authenticateToken, async (req, res) => {
  const userId = req.user.id; // Из JWT токена!
  
  try {
    const groups = await db.getUserGroups(userId);
    res.json({ success: true, groups });
  } catch (error) {
    console.error('Ошибка получения групп:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения групп' });
  }
});

// Получить настройки группы для стримера
app.get('/api/group/:groupId/streamer/:streamerId/settings', async (req, res) => {
  const { groupId, streamerId } = req.params;
  try {
    const settings = await db.getGroupStreamerSettings(parseInt(groupId), parseInt(streamerId));
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Ошибка получения настроек группы:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения настроек группы' });
  }
});

// Обновить настройки группы для стримера
app.put('/api/group/:groupId/streamer/:streamerId/settings', async (req, res) => {
  const { groupId, streamerId } = req.params;
  const { enabled } = req.body;
  try {
    await db.updateGroupStreamerSettings(parseInt(groupId), parseInt(streamerId), enabled);
    res.json({ success: true, message: 'Настройки группы обновлены' });
  } catch (error) {
    console.error('Ошибка обновления настроек группы:', error);
    res.status(500).json({ success: false, error: 'Ошибка обновления настроек группы' });
  }
});

// === Telegram Webhook ===
app.post('/webhook/telegram', async (req, res) => {
  try {
    const update = req.body;
    if (!BOT_TOKEN) {
      return res.status(500).json({ error: 'Бот не настроен' });
    }
    const TelegramBot = require('./bot/telegramBot');
    const bot = new TelegramBot(BOT_TOKEN);
    await bot.handleUpdate(update);
    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка обработки webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// === Sentry Error Handler (должен быть перед обычным error handler!) ===
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// === Обработчик ошибок (должен быть последним!) ===
app.use(errorHandler);

// === Запуск ===
async function startServer() {
  try {
    // Инициализируем БД (создаём таблицы)
    await db.init();

    app.listen(PORT, async () => {
      console.log(`Сервер запущен на порту ${PORT}`);

      // Устанавливаем webhook для бота если есть URL
      if (BOT_TOKEN && process.env.WEBHOOK_URL) {
        const TelegramBot = require('./bot/telegramBot');
        const bot = new TelegramBot(BOT_TOKEN);
        try {
          await bot.setWebhook(`${process.env.WEBHOOK_URL}/webhook/telegram`);
          console.log('✅ Webhook установлен');
        } catch (error) {
          console.error('❌ Ошибка установки webhook:', error.message);
        }
      }

      schedulerRef = new Scheduler(BOT_TOKEN);
      const checkInterval = parseInt(process.env.CHECK_INTERVAL) || 30;
      schedulerRef.start(checkInterval);
      console.log(`✅ Планировщик настроен на проверку каждые ${checkInterval} секунд`);
    });
  } catch (error) {
    console.error('Ошибка запуска сервера:', error);
    process.exit(1);
  }
}

startServer();

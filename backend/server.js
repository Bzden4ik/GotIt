const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const { execSync } = require('child_process');
require('dotenv').config();

// === Кольцевой буфер логов ===
const LOG_BUFFER_SIZE = 500;
const logBuffer = [];
const botLogBuffer = [];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function pushLog(level, msg) {
  logBuffer.push({ time: new Date().toISOString(), level, message: msg });
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
}
function pushBotLog(level, msg) {
  botLogBuffer.push({ time: new Date().toISOString(), level, message: msg });
  if (botLogBuffer.length > LOG_BUFFER_SIZE) botLogBuffer.shift();
  pushLog(level, '[BOT] ' + msg);
}

console.log = (...a) => { const m = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '); pushLog('info', m); originalLog.apply(console, a); };
console.error = (...a) => { const m = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '); pushLog('error', m); originalError.apply(console, a); };
console.warn = (...a) => { const m = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '); pushLog('warn', m); originalWarn.apply(console, a); };

// Глобальный логгер для бота
global.botLog = {
  info: (...a) => { const m = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '); pushBotLog('info', m); originalLog.apply(console, ['[BOT]', ...a]); },
  error: (...a) => { const m = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '); pushBotLog('error', m); originalError.apply(console, ['[BOT]', ...a]); },
  warn: (...a) => { const m = a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '); pushBotLog('warn', m); originalWarn.apply(console, ['[BOT]', ...a]); }
};

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
    const result = await fettaParser.searchStreamer(nickname);
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

// === Админ-панель ===
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'gotit-admin-2024';

function adminAuth(req, res, next) {
  const token = req.query.token || req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

// Основные логи (JSON)
app.get('/api/admin/logs', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, LOG_BUFFER_SIZE);
  const level = req.query.level;
  const search = req.query.search?.toLowerCase();
  let logs = [...logBuffer];
  if (level) logs = logs.filter(l => l.level === level);
  if (search) logs = logs.filter(l => l.message.toLowerCase().includes(search));
  res.json({ success: true, total: logs.length, logs: logs.slice(-limit) });
});

// Логи бота (JSON)
app.get('/api/admin/bot-logs', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, LOG_BUFFER_SIZE);
  const level = req.query.level;
  const search = req.query.search?.toLowerCase();
  let logs = [...botLogBuffer];
  if (level) logs = logs.filter(l => l.level === level);
  if (search) logs = logs.filter(l => l.message.toLowerCase().includes(search));
  res.json({ success: true, total: logs.length, logs: logs.slice(-limit) });
});

// Статус сервера
app.get('/api/admin/status', adminAuth, async (req, res) => {
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  // Проверка webhook
  let webhookInfo = null;
  if (BOT_TOKEN) {
    try {
      const axios = require('axios');
      const resp = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`, { timeout: 5000 });
      webhookInfo = resp.data.result;
    } catch(e) { webhookInfo = { error: e.message }; }
  }

  res.json({
    success: true,
    status: {
      uptime: `${Math.floor(uptime/3600)}ч ${Math.floor((uptime%3600)/60)}м ${Math.floor(uptime%60)}с`,
      memory: { rss: `${Math.round(mem.rss/1024/1024)} MB`, heap: `${Math.round(mem.heapUsed/1024/1024)} MB` },
      nodeVersion: process.version,
      pid: process.pid,
      scheduler: schedulerRef ? { isRunning: schedulerRef.isRunning, id: schedulerRef.schedulerId } : 'не инициализирован',
      logsInBuffer: logBuffer.length,
      botLogsInBuffer: botLogBuffer.length,
      webhook: webhookInfo
    }
  });
});

// Веб-панель
app.get('/admin/logs', adminAuth, (req, res) => { res.send(getAdminPageHtml(ADMIN_TOKEN)); });

// Список стримеров для вкладки Scheduler
app.get('/api/admin/scheduler/streamers', adminAuth, async (req, res) => {
  try {
    const streamers = await db.getAllStreamersAdmin();
    const lastChecked = schedulerRef ? schedulerRef.getLastCheckedMap() : {};
    const checkIntervals = schedulerRef ? schedulerRef.checkIntervals : { 3: 30000, 2: 60000, 1: 60000 };
    const queueStatus = schedulerRef ? schedulerRef.getQueueStatus() : null;
    res.json({ success: true, streamers, lastChecked, checkIntervals, queueStatus });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Обновить приоритет стримера
app.post('/api/admin/scheduler/streamer/:id/priority', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { priority } = req.body;
  if (![1, 2, 3].includes(Number(priority))) {
    return res.status(400).json({ success: false, error: 'priority должен быть 1, 2 или 3' });
  }
  try {
    await db.setStreamerPriority(parseInt(id), Number(priority));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Статус очереди планировщика
app.get('/api/admin/scheduler/queue', adminAuth, (req, res) => {
  if (!schedulerRef) return res.json({ success: true, queue: [], workerBusy: false, currentStreamer: null, history: {}, planLog: [] });
  res.json({ success: true, ...schedulerRef.getQueueStatus() });
});

// === Broadcast ===
const AIAssistant = require('./bot/aiAssistant');
const broadcastJobs = new Map(); // jobId -> { status, results, done }

// Предпросмотр: генерируем ЛС и групповую версию через AI
app.post('/api/admin/broadcast/preview', adminAuth, asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ success: false, error: 'Нет текста' });

  const ai = new AIAssistant();
  const result = await ai.generateBroadcastMessages(message.trim());
  if (!result) return res.status(500).json({ success: false, error: 'Ошибка генерации (Groq API недоступен?)' });

  res.json({ success: true, dmVersion: result.dmVersion, groupVersion: result.groupVersion });
}));

// Запуск рассылки
app.post('/api/admin/broadcast/send', adminAuth, asyncHandler(async (req, res) => {
  const { dmMessage, groupMessage, target } = req.body;
  if (!dmMessage || !groupMessage) return res.status(400).json({ success: false, error: 'Нет текстов' });
  if (!['dm', 'groups', 'all'].includes(target)) return res.status(400).json({ success: false, error: 'target: dm|groups|all' });
  if (!BOT_TOKEN) return res.status(500).json({ success: false, error: 'BOT_TOKEN не задан' });

  const jobId = Math.random().toString(36).substring(2, 10);
  const job = { done: false, results: { dmSent: 0, dmFailed: 0, groupSent: 0, groupFailed: 0 } };
  broadcastJobs.set(jobId, job);

  // Запускаем асинхронно (не ждём завершения)
  const TelegramBot = require('./bot/telegramBot');
  const bot = new TelegramBot(BOT_TOKEN);
  bot.broadcastMessage(dmMessage, groupMessage, target, (r) => { job.results = r; })
    .then(r => { job.results = r; job.done = true; console.log(`Broadcast #${jobId} завершён:`, r); })
    .catch(e => { job.done = true; job.error = e.message; console.error(`Broadcast #${jobId} ошибка:`, e.message); });

  res.json({ success: true, jobId });
}));

// Статус рассылки
app.get('/api/admin/broadcast/status/:jobId', adminAuth, (req, res) => {
  const job = broadcastJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Job не найден' });
  res.json({ success: true, done: job.done, results: job.results, error: job.error || null });
});

// === Telegram Webhook ===
app.post('/webhook/telegram', async (req, res) => {
  try {
    const update = req.body;
    const updateType = update.message ? 'message' : update.callback_query ? 'callback' : update.my_chat_member ? 'member_update' : 'unknown';
    const from = update.message?.from || update.callback_query?.from || update.my_chat_member?.from;
    global.botLog.info(`Webhook получен: ${updateType} от ${from?.username || from?.first_name || 'unknown'} (${from?.id || '?'})`);

    if (!BOT_TOKEN) {
      global.botLog.error('BOT_TOKEN не задан!');
      return res.status(500).json({ error: 'Бот не настроен' });
    }
    const TelegramBot = require('./bot/telegramBot');
    const bot = new TelegramBot(BOT_TOKEN);
    await bot.handleUpdate(update);
    global.botLog.info(`Webhook обработан: ${updateType}`);
    res.json({ ok: true });
  } catch (error) {
    global.botLog.error(`Ошибка webhook: ${error.message}`);
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
function getAdminPageHtml(token) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>GotIt Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e0e0e0;font-family:'JetBrains Mono','Consolas',monospace;font-size:15px}
.header{background:#111118;border-bottom:1px solid #2a2a3a;padding:14px 24px;display:flex;align-items:center;gap:20px;position:sticky;top:0;z-index:10}
.header h1{font-size:19px;color:#7ee8fa;font-weight:600}
.tabs{display:flex;gap:6px;margin-left:28px}
.tab{padding:8px 20px;border-radius:7px;cursor:pointer;background:#1a1a28;border:1px solid #2a2a3a;color:#888;font-size:14px;font-family:inherit;transition:all .2s}
.tab:hover{color:#ccc;border-color:#444}
.tab.active{background:#7ee8fa22;border-color:#7ee8fa;color:#7ee8fa}
.tab .badge{background:#f87171;color:#fff;font-size:11px;padding:2px 6px;border-radius:8px;margin-left:5px}
.status{margin-left:auto;display:flex;gap:16px;font-size:13px;color:#666}
.status b{color:#7ee8fa}
.dot{width:9px;height:9px;border-radius:50%;background:#4ade80;display:inline-block;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.controls{background:#111118;border-bottom:1px solid #2a2a3a;padding:10px 24px;display:flex;gap:10px;flex-wrap:wrap;position:sticky;top:51px;z-index:9}
.controls button,.controls select,.controls input{background:#1a1a28;border:1px solid #2a2a3a;color:#ccc;padding:7px 14px;border-radius:7px;font-size:13px;font-family:inherit;cursor:pointer;outline:none;transition:all .2s}
.controls button:hover{background:#252538;border-color:#7ee8fa;color:#7ee8fa}
.controls button.active{background:#7ee8fa22;border-color:#7ee8fa;color:#7ee8fa}
.controls input{width:220px}
.controls input:focus{border-color:#7ee8fa}
.log-container{padding:8px 0;overflow-y:auto;height:calc(100vh - 120px)}
.log-line{padding:4px 24px;display:flex;gap:12px;border-bottom:1px solid #ffffff06;transition:background .15s}
.log-line:hover{background:#ffffff08}
.log-time{color:#555;min-width:90px;flex-shrink:0}
.log-level{min-width:48px;flex-shrink:0;font-weight:600;text-transform:uppercase;font-size:12px}
.log-level.info{color:#4ade80}.log-level.error{color:#f87171}.log-level.warn{color:#fbbf24}
.log-msg{white-space:pre-wrap;word-break:break-all;flex:1}
.log-line.error{background:#f8717108}.log-line.error .log-msg{color:#fca5a5}
.webhook-info{background:#111118;padding:14px 24px;border-bottom:1px solid #2a2a3a;font-size:13px;display:none}
.webhook-info.visible{display:block}
.webhook-info span{margin-right:18px}
.webhook-info .ok{color:#4ade80}.webhook-info .err{color:#f87171}
.new-log{animation:flashIn .5s ease}
@keyframes flashIn{from{background:#7ee8fa15}to{background:transparent}}
::-webkit-scrollbar{width:7px}::-webkit-scrollbar-track{background:#0a0a0f}::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:4px}
.broadcast-panel{display:none;padding:24px;height:calc(100vh - 120px);overflow-y:auto;max-width:900px;margin:0 auto}
.broadcast-panel.visible{display:block}
.bc-title{font-size:15px;color:#7ee8fa;font-weight:600;margin-bottom:18px}
.bc-label{font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.bc-textarea{width:100%;background:#111118;border:1px solid #2a2a3a;color:#ccc;padding:12px;border-radius:8px;font-size:14px;font-family:inherit;resize:vertical;min-height:80px;outline:none;transition:border-color .2s}
.bc-textarea:focus{border-color:#7ee8fa}
.bc-preview-box{background:#111118;border:1px solid #2a2a3a;border-radius:8px;padding:14px;font-size:13px;color:#ccc;line-height:1.6;white-space:pre-wrap;min-height:60px}
.bc-preview-box.empty{color:#333;font-style:italic}
.bc-row{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
.bc-btn{padding:9px 20px;border-radius:8px;font-size:13px;font-family:inherit;cursor:pointer;border:1px solid;transition:all .2s;outline:none}
.bc-btn-preview{background:#7ee8fa18;border-color:#7ee8fa44;color:#7ee8fa}.bc-btn-preview:hover{background:#7ee8fa33}
.bc-btn-dm{background:#60a5fa18;border-color:#60a5fa44;color:#60a5fa}.bc-btn-dm:hover{background:#60a5fa33}
.bc-btn-groups{background:#f59e0b18;border-color:#f59e0b44;color:#f59e0b}.bc-btn-groups:hover{background:#f59e0b33}
.bc-btn-all{background:#4ade8018;border-color:#4ade8044;color:#4ade80}.bc-btn-all:hover{background:#4ade8033}
.bc-btn:disabled{opacity:.4;cursor:not-allowed}
.bc-section{margin-top:22px}
.bc-progress{margin-top:14px;background:#111118;border:1px solid #2a2a3a;border-radius:8px;padding:14px;font-size:13px;display:none}
.bc-progress.visible{display:block}
.bc-progress-bar-wrap{background:#1a1a28;border-radius:4px;height:6px;margin:10px 0}
.bc-progress-bar{height:6px;border-radius:4px;background:#4ade80;transition:width .5s}
.bc-result{margin-top:8px;color:#555;font-size:12px}
.sched-panel{display:none;padding:20px 24px;height:calc(100vh - 120px);overflow-y:auto}
.sched-panel.visible{display:block}
.sched-header{display:flex;gap:14px;align-items:center;margin-bottom:20px;flex-wrap:wrap}
.sched-legend{display:flex;gap:14px;margin-left:auto;font-size:13px}
.sched-legend span{display:flex;align-items:center;gap:5px}
.dot-vip{width:9px;height:9px;border-radius:50%;background:#f59e0b;display:inline-block}
.dot-high{width:9px;height:9px;border-radius:50%;background:#60a5fa;display:inline-block}
.dot-norm{width:9px;height:9px;border-radius:50%;background:#6b7280;display:inline-block}
.sched-table{width:100%;border-collapse:collapse;font-size:14px}
.sched-table th{text-align:left;padding:9px 12px;color:#555;border-bottom:1px solid #2a2a3a;font-weight:400;text-transform:uppercase;font-size:11px;letter-spacing:.05em}
.sched-table td{padding:10px 12px;border-bottom:1px solid #111118;vertical-align:middle}
.sched-table tr:hover td{background:#ffffff06}
.p-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600}
.p-3{background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44}
.p-2{background:#60a5fa22;color:#60a5fa;border:1px solid #60a5fa44}
.p-1{background:#6b728022;color:#888;border:1px solid #6b728044}
.prio-select{background:#1a1a28;border:1px solid #2a2a3a;color:#ccc;padding:6px 10px;border-radius:7px;font-size:13px;font-family:inherit;cursor:pointer;outline:none;transition:all .2s}
.prio-select:focus,.prio-select:hover{border-color:#7ee8fa;color:#7ee8fa}
.sched-save{background:#7ee8fa22;border:1px solid #7ee8fa44;color:#7ee8fa;padding:5px 13px;border-radius:7px;font-size:13px;font-family:inherit;cursor:pointer;transition:all .2s}
.sched-save:hover{background:#7ee8fa44}
.sched-save.saved{background:#4ade8022;border-color:#4ade8044;color:#4ade80}
.last-check{color:#555;font-size:13px}
.last-check.recent{color:#4ade80}
.last-check.stale{color:#fbbf24}
.sched-refresh{background:#1a1a28;border:1px solid #2a2a3a;color:#ccc;padding:7px 14px;border-radius:7px;font-size:13px;font-family:inherit;cursor:pointer;outline:none;transition:all .2s}
.sched-refresh:hover{color:#7ee8fa;border-color:#7ee8fa}
.interval-info{font-size:12px;color:#555;margin-top:4px}
.queue-section{margin-top:28px}
.queue-title{font-size:13px;color:#7ee8fa;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:10px}
.queue-title .q-count{background:#7ee8fa22;color:#7ee8fa;border:1px solid #7ee8fa44;padding:2px 9px;border-radius:10px;font-size:12px}
.timeline{display:flex;align-items:stretch;gap:0;overflow-x:auto;padding-bottom:8px;min-height:64px}
.timeline::-webkit-scrollbar{height:4px}
.timeline::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:2px}
.tl-block{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:8px 12px;border-radius:8px;min-width:90px;max-width:160px;position:relative;flex-shrink:0;transition:transform .2s,box-shadow .2s;cursor:default}
.tl-block:hover{transform:translateY(-2px);box-shadow:0 4px 16px #0006}
.tl-active{background:#7ee8fa18;border:1px solid #7ee8fa55;animation:activePulse 2s infinite}
@keyframes activePulse{0%,100%{border-color:#7ee8fa55;box-shadow:0 0 0 0 #7ee8fa22}50%{border-color:#7ee8fa;box-shadow:0 0 0 4px #7ee8fa11}}
.tl-p3{background:#f59e0b14;border:1px solid #f59e0b44}
.tl-p2{background:#60a5fa14;border:1px solid #60a5fa44}
.tl-p1{background:#ffffff08;border:1px solid #ffffff18}
.tl-p3.tl-active{background:#f59e0b1a;border-color:#f59e0b;animation:activePulseVip 2s infinite}
@keyframes activePulseVip{0%,100%{border-color:#f59e0b66;box-shadow:0 0 0 0 #f59e0b22}50%{border-color:#f59e0b;box-shadow:0 0 0 4px #f59e0b11}}
.tl-nick{font-size:13px;font-weight:600;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px}
.tl-est{font-size:11px;color:#666;margin-top:3px}
.tl-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;margin-bottom:4px}
.tl-badge-3{color:#f59e0b;background:#f59e0b18}.tl-badge-2{color:#60a5fa;background:#60a5fa18}.tl-badge-1{color:#888;background:#88888818}
.tl-arrow{width:24px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#333;font-size:16px;align-self:center}
.tl-gap-label{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:10px;color:#4ade80;white-space:nowrap;background:#0a0a0f;padding:0 4px}
.tl-progress{position:absolute;bottom:0;left:0;height:3px;background:#7ee8fa;border-radius:0 0 7px 7px;transition:width 1s linear}
.tl-p3 .tl-progress{background:#f59e0b}
.tl-p2 .tl-progress{background:#60a5fa}
.tl-empty{color:#333;font-size:13px;padding:20px;text-align:center;width:100%}
.plan-log{margin-top:16px}
.plan-log-title{font-size:12px;color:#444;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
.plan-log-list{display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto}
.plan-log-item{font-size:12px;padding:5px 10px;border-radius:6px;background:#111118;border-left:3px solid #2a2a3a;color:#666;display:flex;align-items:center;gap:8px;animation:slideIn .3s ease}
.plan-log-item.gap{border-left-color:#4ade80;color:#aaa}
@keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
</style></head><body>
<div class="header">
  <h1>GotIt Admin</h1>
  <div class="tabs">
    <button class="tab active" data-tab="server" onclick="switchTab('server')">Server</button>
    <button class="tab" data-tab="bot" onclick="switchTab('bot')">Bot <span class="badge" id="botBadge" style="display:none">0</span></button>
    <button class="tab" data-tab="scheduler" onclick="switchTab('scheduler')">Scheduler</button>
    <button class="tab" data-tab="broadcast" onclick="switchTab('broadcast')">Broadcast</button>
  </div>
  <div class="status">
    <span class="dot"></span>
    <span>Uptime: <b id="sUp">—</b></span>
    <span>RAM: <b id="sRam">—</b></span>
    <span>PID: <b id="sPid">—</b></span>
  </div>
</div>
<div class="webhook-info" id="webhookInfo">
  <b>Webhook:</b>
  <span>URL: <b id="whUrl">—</b></span>
  <span>Pending: <b id="whPending">—</b></span>
  <span>Last error: <b id="whError">—</b></span>
</div>
<div class="controls" id="controls">
  <button onclick="setFilter('')" class="active" id="btnAll">Все</button>
  <button onclick="setFilter('info')" id="btnInfo">INFO</button>
  <button onclick="setFilter('error')" id="btnError">ERRORS</button>
  <button onclick="setFilter('warn')" id="btnWarn">WARN</button>
  <input type="text" id="searchInput" placeholder="Поиск..." oninput="fetchLogs()">
  <select id="limitSelect" onchange="fetchLogs()">
    <option value="50">50</option><option value="100" selected>100</option><option value="200">200</option><option value="500">500</option>
  </select>
  <button onclick="toggleAuto()" id="btnAuto" class="active">Auto: ON</button>
  <button onclick="scrollToBottom()">↓</button>
</div>
<div class="log-container" id="logContainer"></div>
<div class="broadcast-panel" id="broadcastPanel">
  <div class="bc-title">📢 Рассылка от создателя</div>

  <div class="bc-label">Сообщение от создателя (сырой текст)</div>
  <textarea class="bc-textarea" id="bcRawText" placeholder="Напиши что нужно сообщить пользователям..."></textarea>
  <div class="bc-row">
    <button class="bc-btn bc-btn-preview" id="bcPreviewBtn" onclick="bcPreview()">✨ Предпросмотр</button>
  </div>

  <div id="bcPreviewSection" style="display:none">
    <div class="bc-section">
      <div class="bc-label">💬 Версия для ЛС (с обращением Сэмпай)</div>
      <div class="bc-preview-box" id="bcDmPreview"></div>
      <div style="margin-top:6px">
        <textarea class="bc-textarea" id="bcDmEdit" style="min-height:60px" placeholder="Можно отредактировать..."></textarea>
      </div>
    </div>
    <div class="bc-section">
      <div class="bc-label">👥 Версия для групп</div>
      <div class="bc-preview-box" id="bcGroupPreview"></div>
      <div style="margin-top:6px">
        <textarea class="bc-textarea" id="bcGroupEdit" style="min-height:60px" placeholder="Можно отредактировать..."></textarea>
      </div>
    </div>
    <div class="bc-section">
      <div class="bc-label">Отправить</div>
      <div class="bc-row">
        <button class="bc-btn bc-btn-dm" onclick="bcSend('dm')" id="bcBtnDm">💬 Только в ЛС</button>
        <button class="bc-btn bc-btn-groups" onclick="bcSend('groups')" id="bcBtnGroups">👥 Только в группы</button>
        <button class="bc-btn bc-btn-all" onclick="bcSend('all')" id="bcBtnAll">📢 Всем</button>
      </div>
    </div>
    <div class="bc-progress" id="bcProgress">
      <span id="bcProgressText">Идёт рассылка...</span>
      <div class="bc-progress-bar-wrap"><div class="bc-progress-bar" id="bcProgressBar" style="width:0%"></div></div>
      <div class="bc-result" id="bcResult"></div>
    </div>
  </div>
</div>

<div class="sched-panel" id="schedPanel">
  <div class="sched-header">
    <b style="color:#7ee8fa;font-size:14px">⏱ Приоритеты проверки стримеров</b>
    <div class="sched-legend">
      <span><span class="dot-vip"></span> VIP — каждые 30с / пауза 3с</span>
      <span><span class="dot-high"></span> High — каждые 60с / пауза 5с</span>
      <span><span class="dot-norm"></span> Normal — каждые ${parseInt(process.env.CHECK_INTERVAL)||60}с / пауза 10-15с</span>
    </div>
    <button class="sched-refresh" onclick="fetchScheduler()">↻ Обновить</button>
  </div>
  <table class="sched-table">
    <thead><tr>
      <th>Стример</th>
      <th>Приоритет</th>
      <th>Подписчиков</th>
      <th>Товаров</th>
      <th>Последняя проверка</th>
      <th>Следующая через</th>
      <th></th>
    </tr></thead>
    <tbody id="schedBody"><tr><td colspan="7" style="color:#555;text-align:center;padding:20px">Загрузка...</td></tr></tbody>
  </table>

  <div class="queue-section">
    <div class="queue-title">
      Очередь проверок
      <span class="q-count" id="qCount">0</span>
    </div>
    <div class="timeline" id="qTimeline"><div class="tl-empty">Очередь пуста</div></div>
    <div class="plan-log">
      <div class="plan-log-title">Последние вставки планировщика</div>
      <div class="plan-log-list" id="planLogList"><div style="color:#333;font-size:12px;padding:4px 10px">Нет данных</div></div>
    </div>
  </div>
</div>
<script>
const T='${token}';
let tab='server',filter='',auto=true,lastCount=0,timer;

// === Broadcast ===
let bcJobId=null,bcPollTimer=null;
async function bcPreview(){
  const raw=document.getElementById('bcRawText').value.trim();
  if(!raw)return;
  const btn=document.getElementById('bcPreviewBtn');
  btn.textContent='⏳ Генерация...';btn.disabled=true;
  try{
    const r=await fetch('/api/admin/broadcast/preview?token='+T,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:raw})});
    const d=await r.json();
    if(!d.success){alert('Ошибка: '+d.error);return;}
    document.getElementById('bcDmPreview').textContent=d.dmVersion;
    document.getElementById('bcGroupPreview').textContent=d.groupVersion;
    document.getElementById('bcDmEdit').value=d.dmVersion;
    document.getElementById('bcGroupEdit').value=d.groupVersion;
    document.getElementById('bcPreviewSection').style.display='block';
    document.getElementById('bcProgress').classList.remove('visible');
    document.getElementById('bcResult').textContent='';
  }catch(e){alert('Ошибка запроса');}
  finally{btn.textContent='✨ Предпросмотр';btn.disabled=false;}
}
async function bcSend(target){
  const dm=document.getElementById('bcDmEdit').value.trim();
  const grp=document.getElementById('bcGroupEdit').value.trim();
  if(!dm||!grp){alert('Тексты пустые');return;}
  if(!confirm(`Отправить рассылку: ${target === 'dm' ? 'личные сообщения' : target === 'groups' ? 'группы' : 'всем'}?`))return;
  ['bcBtnDm','bcBtnGroups','bcBtnAll'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=true;});
  const prog=document.getElementById('bcProgress');
  prog.classList.add('visible');
  document.getElementById('bcProgressText').textContent='Идёт рассылка...';
  document.getElementById('bcProgressBar').style.width='5%';
  document.getElementById('bcResult').textContent='';
  try{
    const r=await fetch('/api/admin/broadcast/send?token='+T,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dmMessage:dm,groupMessage:grp,target})});
    const d=await r.json();
    if(!d.success){alert('Ошибка: '+d.error);return;}
    bcJobId=d.jobId;
    bcPollTimer=setInterval(bcPollStatus,1000);
  }catch(e){alert('Ошибка запуска');}
}
async function bcPollStatus(){
  if(!bcJobId)return;
  try{
    const r=await fetch('/api/admin/broadcast/status/'+bcJobId+'?token='+T);
    const d=await r.json();
    if(!d.success)return;
    const res=d.results;
    const totalSent=(res.dmSent||0)+(res.groupSent||0);
    const totalFailed=(res.dmFailed||0)+(res.groupFailed||0);
    document.getElementById('bcProgressText').textContent=`Отправлено: ${totalSent} | Ошибок: ${totalFailed}`;
    if(d.done){
      clearInterval(bcPollTimer);bcPollTimer=null;bcJobId=null;
      document.getElementById('bcProgressBar').style.width='100%';
      document.getElementById('bcProgressText').textContent='✅ Рассылка завершена';
      document.getElementById('bcResult').textContent=`ЛС: ${res.dmSent} усп. / ${res.dmFailed} ошиб. | Группы: ${res.groupSent} усп. / ${res.groupFailed} ошиб.`;
      ['bcBtnDm','bcBtnGroups','bcBtnAll'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=false;});
    } else {
      document.getElementById('bcProgressBar').style.width=Math.min(90,5+totalSent*3)+'%';
    }
  }catch(e){}
}
let schedData={streamers:[],lastChecked:{},checkIntervals:{3:30000,2:60000,1:90000}};

function switchTab(t){
  tab=t;lastCount=0;
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(b=>{if(b.getAttribute('data-tab')===t)b.classList.add('active');});
  const isLog=(t==='server'||t==='bot');
  document.getElementById('webhookInfo').classList.toggle('visible',t==='bot');
  document.getElementById('logContainer').style.display=isLog?'block':'none';
  document.getElementById('controls').style.display=isLog?'flex':'none';
  document.getElementById('schedPanel').classList.toggle('visible',t==='scheduler');
  document.getElementById('broadcastPanel').classList.toggle('visible',t==='broadcast');
  if(t==='bot')document.getElementById('botBadge').style.display='none';
  if(t==='scheduler'){lastPlanLogKey='';fetchScheduler();return;}
  if(t==='broadcast')return;
  fetchLogs();
}
function setFilter(l){filter=l;document.querySelectorAll('.controls button[id^="btn"]').forEach(b=>b.classList.remove('active'));
document.getElementById(l?'btn'+l.charAt(0).toUpperCase()+l.slice(1):'btnAll').classList.add('active');fetchLogs();}
function toggleAuto(){auto=!auto;document.getElementById('btnAuto').textContent='Auto: '+(auto?'ON':'OFF');
document.getElementById('btnAuto').classList.toggle('active',auto);if(auto)startAuto();else clearInterval(timer);}
function scrollToBottom(){const c=document.getElementById('logContainer');c.scrollTop=c.scrollHeight;}
function esc(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function fetchLogs(){try{
const lim=document.getElementById('limitSelect').value;
const s=document.getElementById('searchInput').value;
const endpoint=tab==='bot'?'bot-logs':'logs';
let u='/api/admin/'+endpoint+'?token='+T+'&limit='+lim;
if(filter)u+='&level='+filter;if(s)u+='&search='+encodeURIComponent(s);
const r=await fetch(u);const d=await r.json();if(d.success)renderLogs(d.logs);
}catch(e){}}
function renderLogs(logs){const c=document.getElementById('logContainer');
const atBot=c.scrollHeight-c.scrollTop-c.clientHeight<50;
const isNew=logs.length>lastCount;lastCount=logs.length;
c.innerHTML=logs.map((l,i)=>{const t=l.time.substring(11,19);
const cls=isNew&&i>=logs.length-3?' new-log':'';
return '<div class="log-line '+l.level+cls+'"><span class="log-time">'+t+'</span><span class="log-level '+l.level+'">'+l.level+'</span><span class="log-msg">'+esc(l.message)+'</span></div>';}).join('');
if(atBot||isNew)scrollToBottom();}
async function fetchStatus(){try{
const r=await fetch('/api/admin/status?token='+T);const d=await r.json();if(!d.success)return;
const s=d.status;document.getElementById('sUp').textContent=s.uptime;
document.getElementById('sRam').textContent=s.memory.rss;document.getElementById('sPid').textContent=s.pid;
if(s.botLogsInBuffer>0&&tab!=='bot'){const b=document.getElementById('botBadge');b.textContent=s.botLogsInBuffer;b.style.display='inline';}
if(s.webhook){const w=s.webhook;document.getElementById('whUrl').textContent=w.url||'не задан';
document.getElementById('whUrl').className=w.url?'ok':'err';
document.getElementById('whPending').textContent=w.pending_update_count||0;
document.getElementById('whError').textContent=w.last_error_message||'нет';
document.getElementById('whError').className=w.last_error_message?'err':'ok';}
}catch(e){}}
function startAuto(){clearInterval(timer);timer=setInterval(()=>{if(auto){if(tab==='scheduler')fetchScheduler();else{fetchLogs();fetchStatus();}}},3000);}
fetchLogs();fetchStatus();startAuto();

async function fetchScheduler(){try{
  const [r1,r2]=await Promise.all([
    fetch('/api/admin/scheduler/streamers?token='+T),
    fetch('/api/admin/scheduler/queue?token='+T)
  ]);
  const [d1,d2]=await Promise.all([r1.json(),r2.json()]);
  if(d1.success){schedData=d1;renderScheduler();}
  if(d2.success){renderQueue(d2);}
}catch(e){}}

function fmtAgo(ts){
  if(!ts)return'<span class="last-check">—</span>';
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<5)return'<span class="last-check recent">только что</span>';
  if(s<120)return'<span class="last-check recent">'+s+'с назад</span>';
  if(s<3600)return'<span class="last-check stale">'+Math.floor(s/60)+'м назад</span>';
  return'<span class="last-check stale">'+Math.floor(s/3600)+'ч назад</span>';
}

function fmtNext(ts,priority){
  if(!ts)return'<span style="color:#555">—</span>';
  const interval=schedData.checkIntervals[priority]||90000;
  const remaining=Math.max(0,Math.round((interval-(Date.now()-ts))/1000));
  if(remaining===0)return'<span style="color:#4ade80">сейчас</span>';
  return'<span style="color:#7ee8fa">~'+remaining+'с</span>';
}

const PLABELS={3:'VIP',2:'High',1:'Normal'};
const PCLASS={3:'p-3',2:'p-2',1:'p-1'};

function renderScheduler(){
  const tbody=document.getElementById('schedBody');
  if(!schedData.streamers.length){tbody.innerHTML='<tr><td colspan="7" style="color:#555;text-align:center;padding:20px">Нет стримеров</td></tr>';return;}
  tbody.innerHTML=schedData.streamers.map(s=>{
    const p=s.priority||1;
    const ts=schedData.lastChecked[s.id]||0;
    return'<tr>'+
      '<td><b style="color:#ccc">'+esc(s.nickname)+'</b>'+(s.name&&s.name!==s.nickname?'<br><span style="color:#555;font-size:11px">'+esc(s.name)+'</span>':'')+'</td>'+
      '<td><span class="p-badge '+PCLASS[p]+'">'+PLABELS[p]+'</span></td>'+
      '<td style="color:#888">'+s.followers_count+'</td>'+
      '<td style="color:#888">'+s.items_count+'</td>'+
      '<td>'+fmtAgo(ts)+'</td>'+
      '<td>'+fmtNext(ts,p)+'</td>'+
      '<td style="display:flex;gap:6px;align-items:center">'+
        '<select class="prio-select" id="psel_'+s.id+'" onchange="savePriority('+s.id+',this)">'+
          '<option value="3"'+(p===3?' selected':'')+'>VIP</option>'+
          '<option value="2"'+(p===2?' selected':'')+'>High</option>'+
          '<option value="1"'+(p===1?' selected':'')+'>Normal</option>'+
        '</select>'+
        '<button class="sched-save" id="sbtn_'+s.id+'" onclick="savePriority('+s.id+',this.previousElementSibling)">Сохранить</button>'+
      '</td>'+
    '</tr>';
  }).join('');
}

function fmtMs(ms){if(!ms)return'~?с';const s=Math.round(ms/1000);return'~'+s+'с';}

function renderQueue(data){
  const tl=document.getElementById('qTimeline');
  const countEl=document.getElementById('qCount');
  const {currentStreamer,queue,history}=data;
  const blocks=[];

  // Текущий (активный)
  if(currentStreamer){
    const est=history[currentStreamer.id]?.avg||25000;
    const progress=Math.min(100,Math.round(currentStreamer.runningMs/est*100));
    blocks.push({
      id:currentStreamer.id,
      nick:currentStreamer.nickname,
      p:currentStreamer.priority,
      est,
      progress,
      active:true,
      label:'сейчас'
    });
  }

  // Очередь
  for(const s of queue){
    blocks.push({
      id:s.id,
      nick:s.nickname,
      p:s.priority,
      est:s.estimatedMs,
      progress:0,
      active:false,
      label:null
    });
  }

  countEl.textContent=queue.length+(currentStreamer?'+1':'');

  if(!blocks.length){
    tl.innerHTML='<div class="tl-empty">Очередь пуста</div>';
    renderPlanLog(data.planLog||[]);
    return;
  }

  // Строим HTML с анимацией — не перерисовываем если набор не изменился
  const newKey=blocks.map(b=>b.id+':'+b.p+':'+b.active).join('|');
  if(tl.dataset.key===newKey){
    // Только обновляем прогресс-бары активного блока
    if(currentStreamer){
      const pb=document.getElementById('pb_'+currentStreamer.id);
      if(pb){
        const est=history[currentStreamer.id]?.avg||25000;
        pb.style.width=Math.min(100,Math.round(currentStreamer.runningMs/est*100))+'%';
      }
    }
    renderPlanLog(data.planLog||[]);
    return;
  }
  tl.dataset.key=newKey;

  const PNAMES={3:'VIP',2:'High',1:'Normal'};
  let html='';
  for(let i=0;i<blocks.length;i++){
    const b=blocks[i];
    const cls='tl-block tl-p'+b.p+(b.active?' tl-active':'');
    const histInfo=history[b.id];
    const estLabel=histInfo?fmtMs(histInfo.avg):(b.active?fmtMs(b.est):'est. ?');
    html+='<div class="'+cls+'" id="tlb_'+b.id+'">';
    html+='<div class="tl-badge tl-badge-'+b.p+'">'+PNAMES[b.p]+'</div>';
    html+='<div class="tl-nick">'+esc(b.nick)+'</div>';
    html+='<div class="tl-est">'+(b.active?'⚡ идёт...':estLabel)+'</div>';
    if(b.active){html+='<div class="tl-progress" id="pb_'+b.id+'" style="width:'+b.progress+'%"></div>';}
    html+='</div>';
    if(i<blocks.length-1)html+='<div class="tl-arrow">›</div>';
  }
  tl.innerHTML=html;
  renderPlanLog(data.planLog||[]);
}

const PLAN_LOG_ICONS={gap_insert:'💡'};
let lastPlanLogKey='';
function renderPlanLog(log){
  const el=document.getElementById('planLogList');
  const key=JSON.stringify(log.map(e=>e.ts+e.nickname));
  if(key===lastPlanLogKey)return; // не перерисовываем если ничего не изменилось
  lastPlanLogKey=key;
  if(!log.length){el.innerHTML='<div style="color:#333;font-size:12px;padding:4px 10px">Нет данных — вставки происходят когда VIP/High стример влезает в паузу между Normal</div>';return;}
  el.innerHTML=log.map(e=>{
    const ago=Math.round((Date.now()-e.ts)/1000);
    const PNAMES={3:'VIP',2:'High',1:'Normal'};
    return'<div class="plan-log-item gap">'+
      '<span>💡</span>'+
      '<span><b style="color:#ccc">'+esc(e.nickname)+'</b> <span style="color:#555">['+PNAMES[e.priority]+']</span></span>'+
      '<span style="color:#555">вставлен в паузу '+fmtMs(e.baseDelay)+'</span>'+
      '<span style="margin-left:auto;color:#444">'+ago+'с назад</span>'+
    '</div>';
  }).join('');
}

async function savePriority(id,sel){
  const priority=parseInt(sel.value);
  const btn=document.getElementById('sbtn_'+id);
  btn.textContent='...';
  try{
    const r=await fetch('/api/admin/scheduler/streamer/'+id+'/priority?token='+T,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({priority})
    });
    const d=await r.json();
    if(d.success){btn.textContent='✓';btn.classList.add('saved');setTimeout(()=>{btn.textContent='Сохранить';btn.classList.remove('saved');fetchScheduler();},1500);}
    else{btn.textContent='Ошибка';}
  }catch(e){btn.textContent='Ошибка';}
}
</script></body></html>`;
}

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

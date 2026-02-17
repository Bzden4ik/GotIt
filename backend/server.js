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
body{background:#0a0a0f;color:#e0e0e0;font-family:'JetBrains Mono','Consolas',monospace;font-size:13px}
.header{background:#111118;border-bottom:1px solid #2a2a3a;padding:12px 20px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:10}
.header h1{font-size:16px;color:#7ee8fa;font-weight:600}
.tabs{display:flex;gap:4px;margin-left:24px}
.tab{padding:6px 16px;border-radius:6px;cursor:pointer;background:#1a1a28;border:1px solid #2a2a3a;color:#888;font-size:12px;font-family:inherit;transition:all .2s}
.tab:hover{color:#ccc;border-color:#444}
.tab.active{background:#7ee8fa22;border-color:#7ee8fa;color:#7ee8fa}
.tab .badge{background:#f87171;color:#fff;font-size:10px;padding:1px 5px;border-radius:8px;margin-left:4px}
.status{margin-left:auto;display:flex;gap:12px;font-size:11px;color:#666}
.status b{color:#7ee8fa}
.dot{width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.controls{background:#111118;border-bottom:1px solid #2a2a3a;padding:8px 20px;display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:45px;z-index:9}
.controls button,.controls select,.controls input{background:#1a1a28;border:1px solid #2a2a3a;color:#ccc;padding:5px 12px;border-radius:6px;font-size:12px;font-family:inherit;cursor:pointer;outline:none;transition:all .2s}
.controls button:hover{background:#252538;border-color:#7ee8fa;color:#7ee8fa}
.controls button.active{background:#7ee8fa22;border-color:#7ee8fa;color:#7ee8fa}
.controls input{width:200px}
.controls input:focus{border-color:#7ee8fa}
.log-container{padding:8px 0;overflow-y:auto;height:calc(100vh - 110px)}
.log-line{padding:2px 20px;display:flex;gap:10px;border-bottom:1px solid #ffffff06;transition:background .15s}
.log-line:hover{background:#ffffff08}
.log-time{color:#555;min-width:85px;flex-shrink:0}
.log-level{min-width:44px;flex-shrink:0;font-weight:600;text-transform:uppercase;font-size:11px}
.log-level.info{color:#4ade80}.log-level.error{color:#f87171}.log-level.warn{color:#fbbf24}
.log-msg{white-space:pre-wrap;word-break:break-all;flex:1}
.log-line.error{background:#f8717108}.log-line.error .log-msg{color:#fca5a5}
.webhook-info{background:#111118;padding:12px 20px;border-bottom:1px solid #2a2a3a;font-size:12px;display:none}
.webhook-info.visible{display:block}
.webhook-info span{margin-right:16px}
.webhook-info .ok{color:#4ade80}.webhook-info .err{color:#f87171}
.new-log{animation:flashIn .5s ease}
@keyframes flashIn{from{background:#7ee8fa15}to{background:transparent}}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#0a0a0f}::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:3px}
</style></head><body>
<div class="header">
  <h1>GotIt Admin</h1>
  <div class="tabs">
    <button class="tab active" onclick="switchTab('server')">Server</button>
    <button class="tab" onclick="switchTab('bot')">Bot <span class="badge" id="botBadge" style="display:none">0</span></button>
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
<div class="controls">
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
<script>
const T='${token}';
let tab='server',filter='',auto=true,lastCount=0,timer;
function switchTab(t){tab=t;lastCount=0;document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
document.querySelector('.tab[onclick*="'+t+'"]').classList.add('active');
document.getElementById('webhookInfo').classList.toggle('visible',t==='bot');
if(t==='bot')document.getElementById('botBadge').style.display='none';
fetchLogs();}
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
function startAuto(){clearInterval(timer);timer=setInterval(()=>{if(auto){fetchLogs();fetchStatus();}},3000);}
fetchLogs();fetchStatus();startAuto();
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

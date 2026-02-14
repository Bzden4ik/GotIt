const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();
const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const Scheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

app.use(cors());
app.use(express.json());

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
    console.log(`Авторизован: ${user.username} (tg: ${user.telegram_id})`);
    res.json({
      success: true,
      user: { id: user.id, telegramId: user.telegram_id, username: user.username, firstName: user.first_name }
    });
  } catch (error) {
    console.error('Ошибка авторизации:', error);
    res.status(500).json({ success: false, error: 'Ошибка авторизации' });
  }
});

// Проверка пользователя
app.get('/api/auth/check', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: 'userId не указан' });
  try {
    const user = await db.getUserById(parseInt(userId));
    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден', needReauth: true });
    res.json({
      success: true,
      user: { id: user.id, telegramId: user.telegram_id, username: user.username, firstName: user.first_name }
    });
  } catch (error) {
    console.error('Ошибка проверки:', error);
    res.status(500).json({ success: false, error: 'Ошибка проверки' });
  }
});

// Поиск стримера
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

// Добавить стримера в отслеживаемые
app.post('/api/tracked', async (req, res) => {
  const { nickname, userId } = req.body;
  if (!nickname) return res.status(400).json({ error: 'Необходимо указать nickname' });
  if (!userId) return res.status(401).json({ error: 'Необходимо авторизоваться' });

  try {
    const existingStreamer = await db.getStreamerByNickname(nickname);
    if (existingStreamer) {
      const isTracked = await db.isStreamerTracked(userId, existingStreamer.id);
      if (isTracked) {
        const items = await db.getWishlistItems(existingStreamer.id);
        return res.json({ success: true, streamer: { ...existingStreamer, itemsCount: items.length }, message: 'Стример уже в отслеживаемых' });
      }
      await db.addTrackedStreamer(userId, existingStreamer.id);
      const items = await db.getWishlistItems(existingStreamer.id);
      return res.json({ success: true, streamer: { ...existingStreamer, itemsCount: items.length } });
    }

    const result = await fettaParser.getStreamerInfo(nickname);
    if (!result.success) return res.status(404).json({ success: false, error: result.error });

    const streamer = await db.createOrUpdateStreamer({
      nickname: result.profile.nickname, name: result.profile.name,
      username: result.profile.username, avatar: result.profile.avatar,
      description: result.profile.description, fettaUrl: result.profile.fettaUrl
    });

    if (result.wishlist && result.wishlist.length > 0) {
      await db.saveWishlistItems(streamer.id, result.wishlist);
    }
    await db.addTrackedStreamer(userId, streamer.id);
    res.json({ success: true, streamer: { ...streamer, itemsCount: result.wishlist.length } });
  } catch (error) {
    console.error('Ошибка при добавлении:', error);
    if (error.message && error.message.includes('не найден в базе данных')) {
      return res.status(401).json({ success: false, error: 'Сессия устарела. Войдите заново через Telegram', needReauth: true });
    }
    res.status(500).json({ success: false, error: error.message || 'Ошибка при добавлении стримера' });
  }
});

// Список отслеживаемых
app.get('/api/tracked', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(401).json({ success: false, error: 'Необходимо авторизоваться' });
  try {
    const streamers = await db.getTrackedStreamers(userId);
    const result = [];
    for (const s of streamers) {
      const items = await db.getWishlistItems(s.id);
      result.push({ ...s, itemsCount: items.length });
    }
    res.json({ success: true, streamers: result });
  } catch (error) {
    console.error('Ошибка при получении отслеживаемых:', error);
    res.status(500).json({ success: false, error: 'Ошибка при получении списка' });
  }
});

// Проверка отслеживания
app.get('/api/tracked/check/:nickname', async (req, res) => {
  const { nickname } = req.params;
  const { userId } = req.query;
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

// Удалить стримера
app.delete('/api/tracked/:streamerId', async (req, res) => {
  const { streamerId } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(401).json({ success: false, error: 'Необходимо авторизоваться' });
  try {
    await db.removeTrackedStreamer(userId, parseInt(streamerId));
    res.json({ success: true, message: 'Стример удален из отслеживаемых' });
  } catch (error) {
    console.error('Ошибка при удалении:', error);
    res.status(500).json({ success: false, error: 'Ошибка при удалении стримера' });
  }
});

// Вишлист стримера
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

// === Настройки уведомлений ===

// Получить настройки уведомлений для стримера
app.get('/api/user/:userId/streamer/:streamerId/settings', async (req, res) => {
  const { userId, streamerId } = req.params;
  try {
    const settings = await db.getStreamerSettings(parseInt(userId), parseInt(streamerId));
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Ошибка получения настроек:', error);
    res.status(500).json({ success: false, error: 'Ошибка получения настроек' });
  }
});

// Обновить настройки уведомлений для стримера
app.put('/api/user/:userId/streamer/:streamerId/settings', async (req, res) => {
  const { userId, streamerId } = req.params;
  const { notifications_enabled, notify_in_pm } = req.body;
  try {
    await db.updateStreamerSettings(parseInt(userId), parseInt(streamerId), {
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
app.get('/api/user/:userId/groups', async (req, res) => {
  const { userId } = req.params;
  try {
    const groups = await db.getUserGroups(parseInt(userId));
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

      const scheduler = new Scheduler(BOT_TOKEN);
      const checkInterval = parseInt(process.env.CHECK_INTERVAL) || 5;
      scheduler.start(checkInterval);
      console.log(`Планировщик настроен на проверку каждые ${checkInterval} секунд`);
    });
  } catch (error) {
    console.error('Ошибка запуска сервера:', error);
    process.exit(1);
  }
}

startServer();

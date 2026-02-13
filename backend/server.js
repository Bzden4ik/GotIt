const express = require('express');
const cors = require('cors');
require('dotenv').config();
const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Тестовый эндпоинт
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Backend работает!', 
    timestamp: new Date().toISOString() 
  });
});

// Эндпоинт для поиска стримера
app.get('/api/streamer/search', async (req, res) => {
  const { nickname } = req.query;
  
  if (!nickname) {
    return res.status(400).json({ error: 'Необходимо указать nickname' });
  }

  try {
    console.log(`Поиск стримера: ${nickname}`);
    const result = await fettaParser.getStreamerInfo(nickname);
    
    if (!result.success) {
      return res.status(404).json({ 
        success: false, 
        error: result.error 
      });
    }
    
    res.json({
      success: true,
      streamer: result.profile
    });
  } catch (error) {
    console.error('Ошибка при поиске стримера:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при поиске стримера' 
    });
  }
});

// Добавить стримера в отслеживаемые
app.post('/api/tracked', async (req, res) => {
  const { nickname, userId = 1 } = req.body; // TODO: реальный userId из Telegram
  
  if (!nickname) {
    return res.status(400).json({ error: 'Необходимо указать nickname' });
  }

  try {
    // Получаем данные стримера с fetta.app
    const result = await fettaParser.getStreamerInfo(nickname);
    
    if (!result.success) {
      return res.status(404).json({ 
        success: false, 
        error: result.error 
      });
    }

    // Сохраняем стримера в БД
    const streamer = db.createOrUpdateStreamer({
      nickname: result.profile.nickname,
      name: result.profile.name,
      username: result.profile.username,
      avatar: result.profile.avatar,
      description: result.profile.description,
      fettaUrl: result.profile.fettaUrl
    });

    // Сохраняем вишлист
    if (result.wishlist && result.wishlist.length > 0) {
      db.saveWishlistItems(streamer.id, result.wishlist);
    }

    // Добавляем в отслеживаемые
    db.addTrackedStreamer(userId, streamer.id);
    
    res.json({
      success: true,
      streamer: {
        ...streamer,
        itemsCount: result.wishlist.length
      }
    });
  } catch (error) {
    console.error('Ошибка при добавлении стримера:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при добавлении стримера' 
    });
  }
});

// Получить список отслеживаемых стримеров
app.get('/api/tracked', async (req, res) => {
  const { userId = 1 } = req.query; // TODO: реальный userId из Telegram

  try {
    const streamers = db.getTrackedStreamers(userId);
    
    // Добавляем количество товаров для каждого стримера
    const streamersWithItems = streamers.map(streamer => {
      const items = db.getWishlistItems(streamer.id);
      return {
        ...streamer,
        itemsCount: items.length
      };
    });
    
    res.json({
      success: true,
      streamers: streamersWithItems
    });
  } catch (error) {
    console.error('Ошибка при получении отслеживаемых:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при получении списка' 
    });
  }
});

// Удалить стримера из отслеживаемых
app.delete('/api/tracked/:streamerId', async (req, res) => {
  const { streamerId } = req.params;
  const { userId = 1 } = req.query; // TODO: реальный userId из Telegram

  try {
    db.removeTrackedStreamer(userId, parseInt(streamerId));
    
    res.json({
      success: true,
      message: 'Стример удален из отслеживаемых'
    });
  } catch (error) {
    console.error('Ошибка при удалении стримера:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при удалении стримера' 
    });
  }
});

// Получить вишлист стримера по ID
app.get('/api/streamer/:id/wishlist', async (req, res) => {
  const { id } = req.params;

  try {
    const streamer = db.getStreamerById(parseInt(id));
    
    if (!streamer) {
      return res.status(404).json({ 
        success: false, 
        error: 'Стример не найден' 
      });
    }

    const items = db.getWishlistItems(streamer.id);
    
    res.json({
      success: true,
      items
    });
  } catch (error) {
    console.error('Ошибка при получении вишлиста:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при получении вишлиста' 
    });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

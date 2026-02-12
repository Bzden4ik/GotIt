const express = require('express');
const cors = require('cors');
require('dotenv').config();

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
    // TODO: Реализовать парсинг fetta.app
    res.json({
      success: true,
      streamer: {
        nickname: nickname,
        username: `@${nickname}`,
        avatar: 'https://via.placeholder.com/80',
        description: 'Описание стримера',
        fettaUrl: `https://fetta.app/u/${nickname}`
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при поиске стримера' });
  }
});

// Эндпоинт для получения вишлиста
app.get('/api/streamer/:nickname/wishlist', async (req, res) => {
  const { nickname } = req.params;

  try {
    // TODO: Реализовать парсинг вишлиста
    res.json({
      success: true,
      items: []
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при получении вишлиста' });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

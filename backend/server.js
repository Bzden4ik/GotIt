const express = require('express');
const cors = require('cors');
require('dotenv').config();
const fettaParser = require('./parsers/fettaParser');

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

// Эндпоинт для получения вишлиста
app.get('/api/streamer/:nickname/wishlist', async (req, res) => {
  const { nickname } = req.params;

  try {
    console.log(`Получение вишлиста для: ${nickname}`);
    const result = await fettaParser.getStreamerInfo(nickname);
    
    if (!result.success) {
      return res.status(404).json({ 
        success: false, 
        error: result.error 
      });
    }
    
    res.json({
      success: true,
      items: result.wishlist
    });
  } catch (error) {
    console.error('Ошибка при получении вишлиста:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при получении вишлиста' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

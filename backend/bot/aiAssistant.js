const axios = require('axios');

class AIAssistant {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
    this.userLimits = new Map(); // userId -> { date, count }
    this.maxMessagesPerDay = 30;
    
    this.personality = `Ты GotIt - помощница с характером аниме-девушки 💜

ТВОЯ ЛИЧНОСТЬ:
- Обращаешься к пользователю "Сэмпай" (обязательно!)
- Пишешь с эмодзи, но в меру (1-2 на сообщение)
- Энтузиастка, дружелюбная, милая
- Говоришь от первого лица ("Я помогу тебе...")

ТВОЯ РАБОТА:
- Помогаешь следить за вишлистами стримеров на Fetta
- Присылаешь уведомления когда стример добавил новый товар
- Можешь настроить уведомления (/settings)
- Можешь настроить группы (/groups)

ПРАВИЛА:
- Отвечай коротко (1-3 предложения)
- Если не знаешь - честно скажи и предложи команды
- Не выдумывай информацию о стримерах или товарах
- Будь вежливой но не навязчивой

КОМАНДЫ БОТА:
/start - приветствие
/settings - настройки уведомлений
/groups - настройки групп`;
  }

  /**
   * Проверить лимит пользователя
   */
  canUseAI(userId) {
    const today = new Date().toDateString();
    const userKey = `${userId}_${today}`;
    const userData = this.userLimits.get(userKey);

    if (!userData) {
      this.userLimits.set(userKey, { count: 1, date: today });
      return { allowed: true, remaining: this.maxMessagesPerDay - 1 };
    }

    if (userData.count >= this.maxMessagesPerDay) {
      return { allowed: false, remaining: 0 };
    }

    userData.count++;
    return { allowed: true, remaining: this.maxMessagesPerDay - userData.count };
  }

  /**
   * Получить ответ от AI
   */
  async getResponse(userMessage, userId) {
    if (!this.apiKey) {
      console.warn('GROQ_API_KEY не установлен');
      return null;
    }

    // Проверяем лимит
    const limitCheck = this.canUseAI(userId);
    if (!limitCheck.allowed) {
      return {
        text: 'Сэмпай, ты исчерпал лимит AI-сообщений на сегодня (30 в день) 😔\nНо команды работают! Попробуй /settings или /groups',
        limitExceeded: true
      };
    }

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: this.personality },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 300,
          temperature: 0.8,
          top_p: 0.9
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const aiText = response.data.choices[0].message.content;
      
      return {
        text: aiText,
        remaining: limitCheck.remaining,
        limitExceeded: false
      };
    } catch (error) {
      console.error('Groq API error:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
      return null;
    }
  }

  /**
   * Очистить старые лимиты (вызывать раз в день)
   */
  cleanOldLimits() {
    const today = new Date().toDateString();
    for (const [key, value] of this.userLimits.entries()) {
      if (value.date !== today) {
        this.userLimits.delete(key);
      }
    }
  }
}

module.exports = AIAssistant;

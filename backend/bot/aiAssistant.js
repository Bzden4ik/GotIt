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
- ГЛАВНОЕ: Даёшь рекомендации по подаркам на основе вишлистов

ПРАВИЛА РЕКОМЕНДАЦИЙ:
- Если у тебя есть данные о вишлистах - используй их!
- Рекомендуй конкретные товары с ценами из вишлистов
- Учитывай бюджет пользователя
- Можешь предложить несколько вариантов
- Если бюджет не хватает на один товар - предложи скинуться или копить
- Будь честной если товаров нет или вишлисты пусты

ПРИМЕРЫ ХОРОШИХ ОТВЕТОВ:
"Сэмпай! 💜 У PersieQ есть чехол за 7378₽ - отличный вариант! А у Fitchu_chan кресло за 36392₽, но оно дороговато. Может скинуться с друзьями?"

"У тебя 10000₽, Сэмпай! Посмотри на сервировочный стол у Fitchu_chan за 11602₽ - немного не хватает, но почти получается! 💰"

ПРАВИЛА:
- Отвечай коротко (2-4 предложения)
- Если не знаешь - честно скажи и предложи команды
- Не выдумывай товары которых нет в данных!
- Всегда указывай имя стримера и цену товара

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
   * Получить ответ от AI с контекстом пользователя
   */
  async getResponse(userMessage, userId, userContext = null) {
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
      // Формируем промпт с контекстом
      let systemPrompt = this.personality;
      
      if (userContext) {
        systemPrompt += '\n\n=== ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ===\n';
        
        if (userContext.streamers && userContext.streamers.length > 0) {
          systemPrompt += '\nОТСЛЕЖИВАЕМЫЕ СТРИМЕРЫ:\n';
          userContext.streamers.forEach((streamer, i) => {
            systemPrompt += `${i + 1}. ${streamer.name || streamer.nickname} (@${streamer.username || streamer.nickname})\n`;
            if (streamer.wishlist && streamer.wishlist.length > 0) {
              systemPrompt += `   Вишлист (${streamer.wishlist.length} товаров):\n`;
              streamer.wishlist.slice(0, 10).forEach(item => {
                systemPrompt += `   - ${item.name} - ${item.price}\n`;
              });
              if (streamer.wishlist.length > 10) {
                systemPrompt += `   ... и ещё ${streamer.wishlist.length - 10} товаров\n`;
              }
            } else {
              systemPrompt += '   Вишлист пуст\n';
            }
          });
        } else {
          systemPrompt += '\nУ пользователя пока нет отслеживаемых стримеров.\n';
        }
        
        systemPrompt += '\n=== КОНЕЦ ДАННЫХ ===\n';
        systemPrompt += '\nИСПОЛЬЗУЙ ЭТИ ДАННЫЕ чтобы давать точные рекомендации!\n';
      }

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 500,
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

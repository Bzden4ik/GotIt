const axios = require('axios');
const cheerio = require('cheerio');

class FettaParser {
  constructor() {
    this.baseUrl = 'https://fetta.app';
    this.apiUrl = 'https://fetta.app/api';
  }

  /**
   * Извлечь UID из HTML страницы (Next.js RSC/SSR)
   */
  extractUidFromHtml(html) {
    const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    // Стратегия 1: RSC payload (экранированные кавычки \\" в Next.js script-тегах)
    const escapedPatterns = [
      new RegExp(`\\\\"wishlistOwnerId\\\\":\\\\"(${UUID})\\\\"`, 'i'),
      new RegExp(`\\\\"userId\\\\":\\\\"(${UUID})\\\\"`, 'i'),
      new RegExp(`\\\\"targetUserId\\\\":\\\\"(${UUID})\\\\"`, 'i'),
      new RegExp(`\\\\"ownerId\\\\":\\\\"(${UUID})\\\\"`, 'i'),
    ];
    // Стратегия 2: обычный JSON
    const normalPatterns = [
      new RegExp(`"wishlistOwnerId"\\s*:\\s*"(${UUID})"`, 'i'),
      new RegExp(`"userId"\\s*:\\s*"(${UUID})"`, 'i'),
      new RegExp(`"targetUserId"\\s*:\\s*"(${UUID})"`, 'i'),
      new RegExp(`"ownerId"\\s*:\\s*"(${UUID})"`, 'i'),
      new RegExp(`"uid"\\s*:\\s*"(${UUID})"`, 'i'),
    ];
    const patterns = [...escapedPatterns, ...normalPatterns];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        console.log(`UID найден по паттерну: ${pattern.source.substring(0, 30)}...`);
        return match[1];
      }
    }

    // Стратегия 2: __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const uid = this.findUidInObject(nextData);
        if (uid) {
          console.log('UID найден в __NEXT_DATA__');
          return uid;
        }
      } catch (e) {
        console.log('Ошибка парсинга __NEXT_DATA__:', e.message);
      }
    }

    // Стратегия 3: RSC payload (self.__next_f.push)
    const rscChunks = html.match(/self\.__next_f\.push\(\[.*?\]\)/g);
    if (rscChunks) {
      for (const chunk of rscChunks) {
        const uuidMatch = chunk.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
        if (uuidMatch) {
          console.log('UID-кандидат найден в RSC payload');
          return uuidMatch[1];
        }
      }
    }

    // Стратегия 4: все UUID в HTML, берём первый уникальный
    const allUuids = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
    if (allUuids && allUuids.length > 0) {
      // Берём первый UUID — обычно это ID пользователя
      const unique = [...new Set(allUuids)];
      console.log(`Найдено ${unique.length} уникальных UUID, берём первый: ${unique[0]}`);
      return unique[0];
    }

    return null;
  }

  /**
   * Рекурсивный поиск UID в объекте (для __NEXT_DATA__)
   */
  findUidInObject(obj, keys = ['userId', 'wishlistOwnerId', 'ownerId', 'uid', 'id']) {
    if (!obj || typeof obj !== 'object') return null;
    
    for (const key of keys) {
      if (obj[key] && typeof obj[key] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(obj[key])) {
        return obj[key];
      }
    }
    
    for (const val of Object.values(obj)) {
      if (typeof val === 'object' && val !== null) {
        const found = this.findUidInObject(val, keys);
        if (found) return found;
      }
    }
    
    return null;
  }

  /**
   * Получить страницу стримера и UID
   */
  async fetchStreamerPage(nickname) {
    const url = `${this.baseUrl}/u/${nickname}`;
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
        }
      });
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error('Стример не найден');
      }
      throw error;
    }
  }

  /**
   * Проверить UID через API товаров
   */
  async verifyUid(uid) {
    try {
      const response = await axios.get(`${this.apiUrl}/product/products/public/get`, {
        params: { uid, p: 0 }
      });
      return response.data && response.data.products !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Получить товары через API (все страницы)
   */
  async getWishlistFromAPI(uid) {
    try {
      let allProducts = [];
      const seenIds = new Set();
      let page = 0;
      let hasMore = true;
      let emptyPagesCount = 0;
      const maxEmptyPages = 2;
      let consecutiveErrors = 0;
      const maxErrors = 2; // Уменьшил с 3 до 2 - быстрее останавливаемся при rate limit

      console.log(`Загрузка товаров для UID ${uid}...`);

      while (hasMore && emptyPagesCount < maxEmptyPages && consecutiveErrors < maxErrors) {
        try {
          const response = await axios.get(
            `${this.apiUrl}/product/products/public/get`,
            { 
              params: { uid, p: page },
              timeout: 20000 // Увеличил до 20 секунд
            }
          );

          const data = response.data;
          consecutiveErrors = 0; // Сброс счётчика ошибок при успехе
          
          if (data.products && data.products.length > 0) {
            let newProducts = 0;
            let duplicates = 0;
            
            for (const product of data.products) {
              if (!seenIds.has(product.id)) {
                seenIds.add(product.id);
                allProducts.push(product);
                newProducts++;
              } else {
                duplicates++;
              }
            }
            
            console.log(`  Страница p=${page}: ${data.products.length} товаров (новых: ${newProducts}, дублей: ${duplicates})`);
            
            if (newProducts === 0) {
              emptyPagesCount++;
            } else {
              emptyPagesCount = 0;
            }
          } else {
            console.log(`  Страница p=${page}: пустая`);
            emptyPagesCount++;
          }
          
          page++;
          
          // КРИТИЧНО: Задержка между страницами
          if (page <= 10) {
            const delay = 4000 + Math.random() * 3000; // 4-7 секунд (было 2-4)
            console.log(`    [пауза ${Math.round(delay/1000)}с перед следующей страницей]`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
        } catch (error) {
          consecutiveErrors++;
          
          // Специальная обработка 429
          if (error.response && error.response.status === 429) {
            const retryDelay = 15000 + (consecutiveErrors * 10000); // 15, 25, 35 секунд
            console.log(`  ⚠ Rate limit 429 на странице p=${page}, длинная пауза ${retryDelay/1000}с`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
            // При 429 НЕ увеличиваем счетчик критичных ошибок
            consecutiveErrors = Math.max(0, consecutiveErrors - 1);
            continue; // Повторяем ту же страницу
          }
          
          console.error(`  ⚠ Ошибка загрузки страницы p=${page}:`, error.message);
          
          if (consecutiveErrors >= maxErrors) {
            console.error(`  ❌ Слишком много ошибок (${maxErrors}), останавливаемся`);
            break;
          }
          
          // Пауза перед retry
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        if (page > 10) {
          console.log(`  ⚠ Достигнут лимит страниц (10), останавливаемся`);
          break;
        }
      }

      console.log(`  Итого уникальных товаров: ${allProducts.length}`);
      
      // НОВАЯ ЗАЩИТА: Если товаров меньше 5 - подозрение на rate limit
      if (allProducts.length > 0 && allProducts.length < 5) {
        console.log(`  ⚠ ВНИМАНИЕ: Загружено мало товаров (${allProducts.length}), возможно rate limit`);
      }
      
      return allProducts;
    } catch (error) {
      console.error('Критическая ошибка при получении вишлиста из API:', error.message);
      return [];
    }
  }

  /**
   * Получить категории через API
   */
  async getCategoriesFromAPI(uid) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/category/public/get`,
        { params: { uid } }
      );
      return response.data.categories || [];
    } catch (error) {
      console.error('Ошибка при получении категорий из API:', error.message);
      return [];
    }
  }

  /**
   * Парсинг профиля стримера из HTML
   */
  parseStreamerProfile(html, nickname, uid) {
    const $ = cheerio.load(html);
    
    let avatar = null;
    const avatarImg = $('img[alt="Profile picture"]').first();
    if (avatarImg.length) {
      avatar = avatarImg.attr('src');
      if (avatar && !avatar.startsWith('http')) {
        avatar = this.baseUrl + avatar;
      }
    }

    let name = nickname;
    const nameElement = $('h2').first();
    if (nameElement.length) {
      name = nameElement.text().trim() || nickname;
    }

    let username = `@${nickname}`;
    const usernameElements = $('span').filter((i, el) => {
      const text = $(el).text().trim();
      return text.startsWith('@');
    });
    if (usernameElements.length) {
      username = usernameElements.first().text().trim();
    }

    let description = '';
    // Ищем описание - span с классом содержащим "text-tertiary" (но не "text-tertiary/50")
    // и исключаем элементы внутри footer
    const descElements = $('span').filter((i, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const className = $el.attr('class') || '';
      const inFooter = $el.closest('footer').length > 0;
      
      // Проверяем:
      // 1. Текст не пустой и не короткий
      // 2. Есть класс text-tertiary (без /50)
      // 3. Не в футере
      // 4. Не юзернейм
      return text.length > 5 && 
             className.includes('text-tertiary') && 
             !className.includes('text-tertiary/50') &&
             !inFooter &&
             !text.startsWith('@');
    });
    
    if (descElements.length) {
      description = descElements.first().text().trim();
    }

    const socialLinks = [];
    $('a[target="_blank"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        if (href.includes('twitch.tv')) {
          socialLinks.push({ platform: 'twitch', url: href });
        } else if (href.includes('youtube.com') || href.includes('youtu.be')) {
          socialLinks.push({ platform: 'youtube', url: href });
        } else if (href.includes('t.me')) {
          socialLinks.push({ platform: 'telegram', url: href });
        } else if (href.includes('twitter.com') || href.includes('x.com')) {
          socialLinks.push({ platform: 'twitter', url: href });
        }
      }
    });

    return {
      nickname,
      name,
      username,
      avatar,
      description,
      socialLinks,
      fettaUrl: `${this.baseUrl}/u/${nickname}`,
      uid
    };
  }

  /**
   * Получить полную информацию о стримере
   */
  async getStreamerInfo(nickname) {
    try {
      console.log(`Получение данных для стримера: ${nickname}`);
      
      // Получаем HTML страницы (один запрос вместо двух)
      const html = await this.fetchStreamerPage(nickname);
      console.log(`Страница получена, размер: ${html.length} символов`);
      
      // Извлекаем UID из HTML
      let uid = this.extractUidFromHtml(html);
      
      if (uid) {
        // Проверяем UID через API
        const valid = await this.verifyUid(uid);
        if (!valid) {
          console.log(`UID ${uid} не прошёл проверку, ищем дальше...`);
          // Пробуем найти другие UUID
          const allUuids = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
          if (allUuids) {
            const unique = [...new Set(allUuids)];
            for (const candidate of unique) {
              if (candidate === uid) continue;
              const ok = await this.verifyUid(candidate);
              if (ok) {
                console.log(`Верный UID найден перебором: ${candidate}`);
                uid = candidate;
                break;
              }
            }
          }
        } else {
          console.log(`UID подтверждён: ${uid}`);
        }
      }
      
      if (!uid) {
        console.error('Не удалось найти UID. Первые 500 символов HTML:');
        console.error(html.substring(0, 500));
        throw new Error('Не удалось найти UID пользователя. Структура страницы могла измениться.');
      }
      
      // Парсим профиль из HTML
      const profile = this.parseStreamerProfile(html, nickname, uid);
      
      // Получаем вишлист из API (все страницы)
      const apiProducts = await this.getWishlistFromAPI(uid);
      console.log(`Получено товаров из API: ${apiProducts.length}`);
      
      // Получаем категории
      const categories = await this.getCategoriesFromAPI(uid);
      console.log(`Получено категорий: ${categories.length}`);
      
      // Преобразуем формат API в наш формат
      const wishlist = apiProducts.map(product => {
        // Валидация product ID
        if (!product.id) {
          console.log(`  ⚠ Товар без ID: ${product.name}`);
          return null;
        }
        
        // Добавляем +8% к цене и округляем вверх
        let finalPrice = product.price || 0;
        if (finalPrice > 0) {
          finalPrice = Math.ceil(finalPrice * 1.08); // +8% и округление вверх
        }
        
        return {
          id: String(product.id), // Принудительно string
          externalId: product.externalId ? String(product.externalId) : null,
          image: product.imageUrl || '',
          price: finalPrice > 0 ? `${finalPrice} ₽` : '',
          priceRaw: finalPrice,
          name: product.name || 'Без названия',
          productUrl: product.externalId ? `https://www.ozon.ru/product/${product.externalId}` : '',
          isPinned: product.isPinned || false,
          isUnavailable: product.isUnavailable || false
        };
      }).filter(item => item !== null); // Убираем null значения
      
      return {
        success: true,
        profile,
        wishlist,
        categories
      };
    } catch (error) {
      console.error('Ошибка при получении информации о стримере:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new FettaParser();

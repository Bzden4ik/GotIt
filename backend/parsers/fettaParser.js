const axios = require('axios');
const cheerio = require('cheerio');

class FettaParser {
  constructor() {
    this.baseUrl = 'https://fetta.app';
    this.apiUrl = 'https://fetta.app/api';
  }

  /**
   * Получить UID пользователя из страницы
   */
  async getUserId(nickname) {
    try {
      const url = `${this.baseUrl}/u/${nickname}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      // Ищем UID в HTML - убираем флаг i для case-sensitive
      const uidMatch = response.data.match(/"userId":"([a-f0-9\-]{36})"/);
      if (uidMatch) {
        console.log(`UID найден: ${uidMatch[1]}`);
        return uidMatch[1];
      }
      
      // Альтернативный поиск
      const uidMatch2 = response.data.match(/"wishlistOwnerId":"([a-f0-9\-]{36})"/);
      if (uidMatch2) {
        console.log(`UID найден (альт): ${uidMatch2[1]}`);
        return uidMatch2[1];
      }
      
      console.error('Не удалось найти UID в HTML');
      throw new Error('Не удалось найти UID пользователя');
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error('Стример не найден');
      }
      throw error;
    }
  }

  /**
   * Получить товары через API
   */
  async getWishlistFromAPI(uid) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/product/products/public/get`,
        {
          params: {
            uid: uid,
            p: 0 // страница 0 = первая страница
          }
        }
      );
      
      return response.data.products || [];
    } catch (error) {
      console.error('Ошибка при получении вишлиста из API:', error.message);
      return [];
    }
  }

  /**
   * Парсинг профиля стримера
   */
  async parseStreamerProfile(html, nickname, uid) {
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
    const descElements = $('span').filter((i, el) => {
      const text = $(el).text().trim();
      const parent = $(el).parent();
      return text.length > 20 && !text.startsWith('@') && parent.prop('tagName') === 'DIV';
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
      
      // Получаем UID
      const uid = await this.getUserId(nickname);
      console.log(`UID найден: ${uid}`);
      
      // Получаем страницу для профиля
      const pageResponse = await axios.get(`${this.baseUrl}/u/${nickname}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      // Парсим профиль
      const profile = await this.parseStreamerProfile(pageResponse.data, nickname, uid);
      
      // Получаем вишлист из API
      const apiProducts = await this.getWishlistFromAPI(uid);
      console.log(`Получено товаров из API: ${apiProducts.length}`);
      
      // Преобразуем формат API в наш формат
      const wishlist = apiProducts.map(product => ({
        image: product.imageUrl,
        price: product.price ? `${product.price} ₽` : '',
        name: product.name,
        productUrl: product.externalId ? `https://www.ozon.ru/product/${product.externalId}` : ''
      }));
      
      return {
        success: true,
        profile,
        wishlist
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

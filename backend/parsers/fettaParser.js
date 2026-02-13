const axios = require('axios');
const cheerio = require('cheerio');

class FettaParser {
  constructor() {
    this.baseUrl = 'https://fetta.app';
  }

  /**
   * Получить страницу стримера
   */
  async getStreamerPage(nickname) {
    try {
      const url = `${this.baseUrl}/u/${nickname}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error('Стример не найден');
      }
      throw new Error('Ошибка при получении страницы стримера');
    }
  }

  /**
   * Парсинг профиля стримера
   */
  parseStreamerProfile(html, nickname) {
    const $ = cheerio.load(html);
    
    // Парсинг аватарки
    let avatar = null;
    const avatarImg = $('img.rounded-full').first();
    if (avatarImg.length) {
      avatar = avatarImg.attr('src');
      // Если относительный путь, добавляем домен
      if (avatar && !avatar.startsWith('http')) {
        avatar = this.baseUrl + avatar;
      }
    }

    // Парсинг имени стримера
    let name = nickname;
    const nameElement = $('h1, h2, .name, [class*="name"]').first();
    if (nameElement.length) {
      name = nameElement.text().trim() || nickname;
    }

    // Парсинг юзернейма
    let username = `@${nickname}`;
    const usernameElement = $('[class*="username"], .username, [href*="t.me"]').first();
    if (usernameElement.length) {
      const usernameText = usernameElement.text().trim();
      if (usernameText.startsWith('@')) {
        username = usernameText;
      }
    }

    // Парсинг описания
    let description = '';
    const descriptionElement = $('p, .description, [class*="description"], [class*="bio"]').first();
    if (descriptionElement.length) {
      description = descriptionElement.text().trim();
    }

    // Парсинг ссылок на соцсети
    const socialLinks = [];
    $('a[href]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        if (href.includes('twitch.tv')) {
          socialLinks.push({ platform: 'twitch', url: href });
        } else if (href.includes('youtube.com') || href.includes('youtu.be')) {
          socialLinks.push({ platform: 'youtube', url: href });
        } else if (href.includes('t.me') || href.includes('telegram')) {
          socialLinks.push({ platform: 'telegram', url: href });
        } else if (href.includes('twitter.com') || href.includes('x.com')) {
          socialLinks.push({ platform: 'twitter', url: href });
        } else if (href.includes('instagram.com')) {
          socialLinks.push({ platform: 'instagram', url: href });
        } else if (href.includes('vk.com')) {
          socialLinks.push({ platform: 'vk', url: href });
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
      fettaUrl: `${this.baseUrl}/u/${nickname}`
    };
  }

  /**
   * Парсинг вишлиста (список товаров)
   */
  parseWishlist(html) {
    const $ = cheerio.load(html);
    const items = [];

    // Ищем сетку с товарами (grid с auto-cols-fr)
    const gridContainer = $('.grid.auto-cols-fr, .grid.grid-cols-2, .grid.grid-cols-3, .grid.grid-cols-4');
    
    if (gridContainer.length) {
      // Ищем карточки товаров внутри сетки
      gridContainer.find('.group.relative').each((i, elem) => {
        const $item = $(elem);
        
        // Пропускаем плейсхолдеры (анимация загрузки)
        if ($item.hasClass('animate-pulse')) {
          return;
        }
        
        // Парсинг картинки
        const img = $item.find('img[alt="Product picture"]').first();
        const image = img.attr('src');
        
        // Парсинг цены (текст с font-semibold)
        const priceElement = $item.find('.font-semibold').first();
        const price = priceElement.text().trim();
        
        // Парсинг названия (текст с line-clamp-2)
        const nameElement = $item.find('.line-clamp-2').first();
        const name = nameElement.text().trim();
        
        // Парсинг ссылки (если есть)
        let productUrl = '';
        const linkElement = $item.find('a[href]').first();
        if (linkElement.length) {
          productUrl = linkElement.attr('href');
        }

        // Добавляем только если есть картинка или название
        if (image || name) {
          items.push({
            image,
            price,
            name,
            productUrl
          });
        }
      });
    }

    return items;
  }

  /**
   * Получить полную информацию о стримере
   */
  async getStreamerInfo(nickname) {
    try {
      const html = await this.getStreamerPage(nickname);
      const profile = this.parseStreamerProfile(html, nickname);
      const wishlist = this.parseWishlist(html);
      
      return {
        success: true,
        profile,
        wishlist
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new FettaParser();

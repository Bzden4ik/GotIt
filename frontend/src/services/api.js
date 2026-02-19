import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

class ApiService {
  constructor() {
    this.token = null;
    this.loadToken();
  }

  /**
   * Загрузить токен из localStorage
   */
  loadToken() {
    this.token = localStorage.getItem('authToken');
  }

  /**
   * Сохранить токен в localStorage
   */
  setToken(token) {
    this.token = token;
    localStorage.setItem('authToken', token);
  }

  /**
   * Удалить токен
   */
  clearToken() {
    this.token = null;
    localStorage.removeItem('authToken');
  }

  /**
   * Получить заголовки с токеном
   */
  getAuthHeaders() {
    if (!this.token) return {};
    return {
      Authorization: `Bearer ${this.token}`
    };
  }

  /**
   * Авторизация через Telegram
   */
  async authTelegram(telegramData) {
    try {
      const response = await axios.post(`${API_BASE_URL}/auth/telegram`, telegramData);
      
      // Сохраняем токен
      if (response.data.success && response.data.token) {
        this.setToken(response.data.token);
      }
      
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Проверка пользователя (через токен)
   */
  async checkUser() {
    try {
      const response = await axios.get(`${API_BASE_URL}/auth/check`, {
        headers: this.getAuthHeaders()
      });
      return response.data;
    } catch (error) {
      // Если токен невалидный - очищаем
      if (error.response?.status === 401) {
        this.clearToken();
      }
      throw this.handleError(error);
    }
  }

  /**
   * Поиск стримера (не требует авторизации)
   */
  async searchStreamer(nickname) {
    try {
      const response = await axios.get(`${API_BASE_URL}/streamer/search`, {
        params: { nickname }
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Получить вишлист стримера (не требует авторизации)
   */
  async getWishlist(streamerId) {
    try {
      const response = await axios.get(`${API_BASE_URL}/streamer/${streamerId}/wishlist`);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Добавить стримера в отслеживаемые (требует авторизации)
   */
  async addTrackedStreamer(nickname) {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/tracked`,
        { nickname },
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        this.clearToken();
      }
      throw this.handleError(error);
    }
  }

  /**
   * Получить список отслеживаемых стримеров (требует авторизации)
   */
  async getTrackedStreamers() {
    try {
      const response = await axios.get(`${API_BASE_URL}/tracked`, {
        headers: this.getAuthHeaders()
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        this.clearToken();
      }
      throw this.handleError(error);
    }
  }

  /**
   * Проверить отслеживается ли стример (опциональная авторизация)
   */
  async checkIfTracked(nickname) {
    try {
      const response = await axios.get(`${API_BASE_URL}/tracked/check/${nickname}`, {
        headers: this.getAuthHeaders()
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Удалить стримера из отслеживаемых (требует авторизации)
   */
  async removeTrackedStreamer(streamerId) {
    try {
      const response = await axios.delete(`${API_BASE_URL}/tracked/${streamerId}`, {
        headers: this.getAuthHeaders()
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        this.clearToken();
      }
      throw this.handleError(error);
    }
  }

  /**
   * Проверить статус сайта (технические работы)
   */
  async getStatus() {
    try {
      const response = await axios.get(`${API_BASE_URL}/status`);
      return response.data;
    } catch (error) {
      return { success: false, maintenance: { active: false } };
    }
  }

  /**
   * Проверить авторизован ли пользователь
   */
  isAuthenticated() {
    return !!this.token;
  }

  /**
   * Обработка ошибок
   */
  handleError(error) {
    if (error.response) {
      const errorData = error.response.data;
      
      // Если ошибка авторизации
      if (errorData.needAuth) {
        return new Error('Необходимо авторизоваться');
      }
      
      return new Error(errorData.error || 'Ошибка сервера');
    } else if (error.request) {
      return new Error('Не удалось связаться с сервером');
    } else {
      return new Error('Ошибка при выполнении запроса');
    }
  }
}

const apiService = new ApiService();
export default apiService;

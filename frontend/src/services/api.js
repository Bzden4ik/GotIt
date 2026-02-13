import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

class ApiService {
  constructor() {
    this.userId = null;
  }

  setUserId(userId) {
    this.userId = userId;
  }

  /**
   * Авторизация через Telegram
   */
  async authTelegram(telegramData) {
    try {
      const response = await axios.post(`${API_BASE_URL}/auth/telegram`, telegramData);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Проверка пользователя
   */
  async checkUser(userId) {
    try {
      const response = await axios.get(`${API_BASE_URL}/auth/check`, {
        params: { userId }
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Поиск стримера
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
   * Получить вишлист стримера
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
   * Добавить стримера в отслеживаемые
   */
  async addTrackedStreamer(nickname) {
    try {
      const response = await axios.post(`${API_BASE_URL}/tracked`, {
        nickname,
        userId: this.userId
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Получить список отслеживаемых стримеров
   */
  async getTrackedStreamers() {
    try {
      const response = await axios.get(`${API_BASE_URL}/tracked`, {
        params: { userId: this.userId }
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Проверить отслеживается ли стример
   */
  async checkIfTracked(nickname) {
    try {
      const response = await axios.get(`${API_BASE_URL}/tracked/check/${nickname}`, {
        params: { userId: this.userId }
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Удалить стримера из отслеживаемых
   */
  async removeTrackedStreamer(streamerId) {
    try {
      const response = await axios.delete(`${API_BASE_URL}/tracked/${streamerId}`, {
        params: { userId: this.userId }
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Обработка ошибок
   */
  handleError(error) {
    if (error.response) {
      return new Error(error.response.data.error || 'Ошибка сервера');
    } else if (error.request) {
      return new Error('Не удалось связаться с сервером');
    } else {
      return new Error('Ошибка при выполнении запроса');
    }
  }
}

const apiService = new ApiService();
export default apiService;

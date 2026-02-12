import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

class ApiService {
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
  async getWishlist(nickname) {
    try {
      const response = await axios.get(`${API_BASE_URL}/streamer/${nickname}/wishlist`);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Добавить стримера в отслеживаемые
   */
  async addTrackedStreamer(streamerId) {
    try {
      const response = await axios.post(`${API_BASE_URL}/tracked`, {
        streamerId
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
      const response = await axios.get(`${API_BASE_URL}/tracked`);
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
      const response = await axios.delete(`${API_BASE_URL}/tracked/${streamerId}`);
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
      // Ошибка от сервера
      return new Error(error.response.data.error || 'Ошибка сервера');
    } else if (error.request) {
      // Запрос был отправлен, но ответа не было
      return new Error('Не удалось связаться с сервером');
    } else {
      // Ошибка при настройке запроса
      return new Error('Ошибка при выполнении запроса');
    }
  }
}

export default new ApiService();

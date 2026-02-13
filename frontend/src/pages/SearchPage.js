import React, { useState } from 'react';
import apiService from '../services/api';
import './SearchPage.css';

function SearchPage({ user }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    
    try {
      const response = await apiService.searchStreamer(searchQuery.trim());
      
      if (response.success && response.streamer) {
        setSearchResults([response.streamer]);
      } else {
        setError('Стример не найден');
        setSearchResults([]);
      }
    } catch (err) {
      setError(err.message || 'Ошибка при поиске стримера');
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTrack = async (streamer) => {
    if (!user) {
      alert('Для отслеживания стримеров необходимо войти через Telegram');
      return;
    }
    try {
      setLoading(true);
      await apiService.addTrackedStreamer(streamer.nickname);
      alert(`Стример ${streamer.nickname} добавлен в отслеживаемые!`);
    } catch (err) {
      const errorMsg = err.message || 'Ошибка при добавлении стримера';
      
      // Проверяем нужна ли переавторизация
      if (errorMsg.includes('Сессия устарела') || errorMsg.includes('войдите заново')) {
        alert('Ваша сессия устарела. Пожалуйста, выйдите и войдите заново через Telegram');
        // Можно автоматически разлогинить
        // window.location.reload();
      } else {
        alert(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-page">
      <div className="container">
        <h2>Поиск стримера</h2>
        
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="Введите ник стримера..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-btn" disabled={loading}>
            {loading ? 'Поиск...' : 'Найти'}
          </button>
        </form>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map((streamer, index) => (
              <div key={index} className="streamer-card">
                {streamer.avatar && (
                  <img 
                    src={streamer.avatar} 
                    alt={streamer.nickname} 
                    className="streamer-avatar"
                    onError={(e) => {
                      e.target.src = 'https://via.placeholder.com/80';
                    }}
                  />
                )}
                <div className="streamer-info">
                  <h3>{streamer.name || streamer.nickname}</h3>
                  <p className="username">{streamer.username}</p>
                  {streamer.description && (
                    <p className="description">{streamer.description}</p>
                  )}
                  {streamer.socialLinks && streamer.socialLinks.length > 0 && (
                    <div className="social-links">
                      {streamer.socialLinks.map((link, idx) => (
                        <a 
                          key={idx} 
                          href={link.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="social-link"
                          title={link.platform}
                        >
                          {link.platform}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <button 
                  className="track-btn"
                  onClick={() => handleTrack(streamer)}
                >
                  Отслеживать
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchPage;

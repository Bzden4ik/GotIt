import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAddStreamer, useCheckTracked } from '../services/apiHooks';
import apiService from '../services/api';
import Toast from '../components/Toast';
import TextDecode from '../components/TextDecode';
import './SearchPage.css';

function SearchPage({ user }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // React Query mutation с оптимистичным обновлением
  const addStreamer = useAddStreamer();

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    
    try {
      const response = await apiService.searchStreamer(searchQuery.trim());
      
      if (response.success && response.streamer) {
        // Проверяем отслеживается ли стример
        if (user) {
          const checkResult = await apiService.checkIfTracked(response.streamer.nickname);
          response.streamer.isTracked = checkResult.isTracked || false;
        } else {
          response.streamer.isTracked = false;
        }
        
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
      setToast({ type: 'warning', message: 'Для отслеживания стримеров необходимо войти через Telegram' });
      return;
    }
    
    // Если уже отслеживается - переходим на страницу отслеживаемых
    if (streamer.isTracked) {
      navigate('/tracked');
      return;
    }
    
    try {
      // Оптимистичное обновление - UI обновится мгновенно
      await addStreamer.mutateAsync(streamer.nickname);
      
      // Обновляем статус в результатах поиска
      setSearchResults(prev => 
        prev.map(s => s.nickname === streamer.nickname ? { ...s, isTracked: true } : s)
      );
      
      setToast({ type: 'success', message: `Стример ${streamer.nickname} добавлен в отслеживаемые!` });
    } catch (err) {
      const errorMsg = err.message || 'Ошибка при добавлении стримера';
      
      if (errorMsg.includes('Сессия устарела') || errorMsg.includes('войдите заново')) {
        setToast({ type: 'error', message: 'Ваша сессия устарела. Пожалуйста, выйдите и войдите заново через Telegram' });
      } else {
        setToast({ type: 'error', message: errorMsg });
      }
    }
  };

  return (
    <div className="search-page">
      <div className="container bvl">
        <TextDecode text="Найти стримера" as="h2" className="page-title" delay={200} duration={1000} />
        <p className="page-subtitle">Введите никнейм, чтобы увидеть вишлист</p>
        
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
                  className={streamer.isTracked ? "track-btn tracked" : "track-btn"}
                  onClick={() => handleTrack(streamer)}
                  disabled={addStreamer.isPending}
                >
                  {addStreamer.isPending ? 'Добавление...' : 
                   streamer.isTracked ? '✓ Отслеживается' : 'Отслеживать'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default SearchPage;

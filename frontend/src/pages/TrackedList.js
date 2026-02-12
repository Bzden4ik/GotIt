import React, { useState, useEffect } from 'react';
import apiService from '../services/api';
import WishlistModal from '../components/WishlistModal';
import './TrackedList.css';

function TrackedList() {
  const [trackedStreamers, setTrackedStreamers] = useState([]);
  const [selectedStreamer, setSelectedStreamer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadTrackedStreamers();
  }, []);

  const loadTrackedStreamers = async () => {
    try {
      setLoading(true);
      const response = await apiService.getTrackedStreamers();
      if (response.success) {
        setTrackedStreamers(response.streamers);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (streamerId) => {
    if (!window.confirm('Удалить стримера из отслеживаемых?')) return;

    try {
      await apiService.removeTrackedStreamer(streamerId);
      setTrackedStreamers(prev => prev.filter(s => s.id !== streamerId));
    } catch (err) {
      alert(err.message || 'Ошибка при удалении');
    }
  };

  const handleViewWishlist = (streamer) => {
    setSelectedStreamer(streamer);
  };

  if (loading) {
    return (
      <div className="tracked-list">
        <div className="container">
          <h2>Отслеживаемые стримеры</h2>
          <div className="loading">Загрузка...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tracked-list">
        <div className="container">
          <h2>Отслеживаемые стримеры</h2>
          <div className="error-message">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tracked-list">
      <div className="container">
        <h2>Отслеживаемые стримеры</h2>
        
        {trackedStreamers.length === 0 ? (
          <div className="empty-state">
            <p>Вы пока не отслеживаете ни одного стримера</p>
            <p className="hint">Найдите стримера в разделе "Поиск" и добавьте его в отслеживаемые</p>
          </div>
        ) : (
          <div className="streamers-grid">
            {trackedStreamers.map((streamer) => (
              <div key={streamer.id} className="streamer-card">
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
                  <p className="items-count">Товаров: {streamer.itemsCount || 0}</p>
                </div>
                <div className="card-actions">
                  <button 
                    className="view-btn"
                    onClick={() => handleViewWishlist(streamer)}
                  >
                    Вишлист
                  </button>
                  <button 
                    className="remove-btn"
                    onClick={() => handleRemove(streamer.id)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedStreamer && (
        <WishlistModal
          streamer={selectedStreamer}
          onClose={() => setSelectedStreamer(null)}
        />
      )}
    </div>
  );
}

export default TrackedList;

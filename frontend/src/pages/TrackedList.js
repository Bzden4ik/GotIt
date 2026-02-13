import React, { useState, useEffect } from 'react';
import apiService from '../services/api';
import WishlistModal from '../components/WishlistModal';
import ConfirmModal from '../components/ConfirmModal';
import Toast from '../components/Toast';
import DecodeText from '../components/DecodeText';
import PageTransition from '../components/PageTransition';
import './TrackedList.css';

function TrackedList({ user }) {
  const [trackedStreamers, setTrackedStreamers] = useState([]);
  const [selectedStreamer, setSelectedStreamer] = useState(null);
  const [streamerToDelete, setStreamerToDelete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (user) {
      loadTrackedStreamers();
    } else {
      setLoading(false);
    }
  }, [user]);

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
    setStreamerToDelete(streamerId);
  };

  const confirmDelete = async () => {
    if (!streamerToDelete) return;
    
    try {
      await apiService.removeTrackedStreamer(streamerToDelete);
      setTrackedStreamers(prev => prev.filter(s => s.id !== streamerToDelete));
      setToast({ type: 'success', message: 'Стример удален из отслеживаемых' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Ошибка при удалении' });
    } finally {
      setStreamerToDelete(null);
    }
  };

  const handleViewWishlist = (streamer) => {
    setSelectedStreamer(streamer);
  };

  if (!user) {
    return (
      <PageTransition>
        <div className="tracked-list">
          <div className="container bvl">
            <h2><DecodeText text="⭐ Отслеживаемые стримеры" /></h2>
            <div className="empty-state">
              <p>Войдите через Telegram, чтобы отслеживать стримеров</p>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (loading) {
    return (
      <PageTransition>
        <div className="tracked-list">
          <div className="container bvl">
            <h2><DecodeText text="⭐ Отслеживаемые стримеры" /></h2>
            <div className="loading">Загрузка...</div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (error) {
    return (
      <PageTransition>
        <div className="tracked-list">
          <div className="container bvl">
            <h2><DecodeText text="⭐ Отслеживаемые стримеры" /></h2>
            <div className="error-message">{error}</div>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="tracked-list">
        <div className="container bvl">
          <h2><DecodeText text="⭐ Отслеживаемые стримеры" /></h2>
        
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
      </div>

      {selectedStreamer && (
        <WishlistModal
          streamer={selectedStreamer}
          onClose={() => setSelectedStreamer(null)}
        />
      )}
      
      {streamerToDelete && (
        <ConfirmModal
          title="Удалить стримера?"
          message="Вы уверены, что хотите удалить этого стримера из отслеживаемых?"
          onConfirm={confirmDelete}
          onCancel={() => setStreamerToDelete(null)}
        />
      )}
      
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </PageTransition>
  );
}

export default TrackedList;

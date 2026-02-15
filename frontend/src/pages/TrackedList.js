import React, { useState } from 'react';
import { useTrackedStreamers, useRemoveStreamer } from '../services/apiHooks';
import WishlistModal from '../components/WishlistModal';
import ConfirmModal from '../components/ConfirmModal';
import Toast from '../components/Toast';
import TextDecode from '../components/TextDecode';
import './TrackedList.css';

function TrackedList({ user }) {
  const [selectedStreamer, setSelectedStreamer] = useState(null);
  const [streamerToDelete, setStreamerToDelete] = useState(null);
  const [toast, setToast] = useState(null);

  // React Query: автоматическое кеширование + рефетч
  const { data: trackedStreamers = [], isLoading, error } = useTrackedStreamers(!!user);
  
  // React Query mutation с оптимистичным обновлением
  const removeStreamer = useRemoveStreamer();

  const handleRemove = async (streamerId) => {
    setStreamerToDelete(streamerId);
  };

  const confirmDelete = async () => {
    if (!streamerToDelete) return;
    
    try {
      // Оптимистичное удаление - UI обновится мгновенно
      await removeStreamer.mutateAsync(streamerToDelete);
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
      <div className="tracked-list">
        <div className="container bvl">
          <TextDecode text="Отслеживаемые" as="h2" className="page-title" delay={200} duration={1000} />
          <div className="empty-state">
            <p>Войдите через Telegram, чтобы отслеживать стримеров</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="tracked-list">
        <div className="container bvl">
          <TextDecode text="Отслеживаемые" as="h2" className="page-title" delay={200} duration={1000} />
          <div className="loading">Загрузка...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tracked-list">
        <div className="container bvl">
          <TextDecode text="Отслеживаемые" as="h2" className="page-title" delay={200} duration={1000} />
          <div className="error-message">{error.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tracked-list">
      <div className="container bvl">
        <TextDecode text="Отслеживаемые" as="h2" className="page-title" delay={200} duration={1000} />
        
        {trackedStreamers.length === 0 ? (
          <div className="empty-state">
            <p>Вы пока не отслеживаете ни одного стримера</p>
            <p className="hint">Найдите стримера в разделе "Поиск" и добавьте его в отслеживаемые</p>
          </div>
        ) : (
          <div className="streamers-grid">
            {trackedStreamers.map((streamer) => (
              <div 
                key={streamer.id} 
                className={`streamer-card ${streamer.isOptimistic ? 'optimistic' : ''}`}
              >
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
                    disabled={streamer.isOptimistic}
                  >
                    Вишлист
                  </button>
                  <button 
                    className="remove-btn"
                    onClick={() => handleRemove(streamer.id)}
                    disabled={removeStreamer.isPending}
                  >
                    {removeStreamer.isPending ? 'Удаление...' : 'Удалить'}
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
    </div>
  );
}

export default TrackedList;

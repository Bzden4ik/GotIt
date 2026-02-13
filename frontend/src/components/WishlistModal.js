import React, { useState, useEffect } from 'react';
import apiService from '../services/api';
import './WishlistModal.css';

function WishlistModal({ streamer, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadWishlist = async () => {
      try {
        setLoading(true);
        const response = await apiService.getWishlist(streamer.id);
        if (response.success) {
          setItems(response.items);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadWishlist();
  }, [streamer.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="streamer-info-header">
            {streamer.avatar && (
              <img 
                src={streamer.avatar} 
                alt={streamer.nickname} 
                className="streamer-avatar-small"
              />
            )}
            <div>
              <h2>{streamer.name || streamer.nickname}</h2>
              <p className="username">{streamer.username}</p>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {loading && <div className="loading">Загрузка вишлиста...</div>}
          
          {error && <div className="error-message">{error}</div>}
          
          {!loading && !error && items.length === 0 && (
            <div className="empty-wishlist">
              <p>Вишлист пуст</p>
            </div>
          )}
          
          {!loading && !error && items.length > 0 && (
            <div className="wishlist-grid">
              {items.map((item, index) => (
                <div key={index} className="wishlist-item">
                  {item.image && (
                    <img 
                      src={item.image} 
                      alt={item.name || 'Product'} 
                      className="item-image"
                      onError={(e) => {
                        e.target.src = 'https://via.placeholder.com/200';
                      }}
                    />
                  )}
                  <div className="item-info">
                    {item.price && (
                      <div className="item-price">{item.price}</div>
                    )}
                    {item.name && (
                      <div className="item-name">{item.name}</div>
                    )}
                    {item.product_url && (
                      <a 
                        href={item.product_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="item-link"
                      >
                        Смотреть товар
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <a 
            href={streamer.fetta_url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="fetta-link"
          >
            Открыть на Fetta →
          </a>
        </div>
      </div>
    </div>
  );
}

export default WishlistModal;

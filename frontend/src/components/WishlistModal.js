import React from 'react';
import './WishlistModal.css';

function WishlistModal({ streamer, items, onClose }) {
  if (!streamer) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Вишлист: {streamer.nickname}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        
        <div className="wishlist-grid">
          {items && items.length > 0 ? (
            items.map((item, index) => (
              <div key={index} className="wishlist-item">
                <img src={item.image} alt={item.name} className="item-image" />
                <div className="item-info">
                  <p className="item-price">{item.price}</p>
                  <p className="item-name">{item.name}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-wishlist">Вишлист пуст</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default WishlistModal;

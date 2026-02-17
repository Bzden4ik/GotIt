import React from 'react';
import { useWishlist } from '../services/apiHooks';
import './WishlistModal.css';

// Определяем название площадки по URL
function getPlatformName(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('ozon.ru')) return 'Ozon';
    if (hostname.includes('wildberries.ru')) return 'Wildberries';
    if (hostname.includes('market.yandex.ru')) return 'Яндекс Маркет';
    if (hostname.includes('aliexpress')) return 'AliExpress';
    if (hostname.includes('lamoda.ru')) return 'Lamoda';
    if (hostname.includes('megamarket.ru')) return 'МегаМаркет';
    if (hostname.includes('dns-shop.ru')) return 'DNS';
    if (hostname.includes('mvideo.ru')) return 'М.Видео';
    if (hostname.includes('citilink.ru')) return 'Ситилинк';
    if (hostname.includes('amazon')) return 'Amazon';
    // Fallback: берём имя домена
    const parts = hostname.replace('www.', '').split('.');
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  } catch {
    return null;
  }
}

function WishlistModal({ streamer, onClose }) {
  const { data: items = [], isLoading: loading, error: queryError } = useWishlist(streamer.id);
  const error = queryError?.message || null;

  const fettaUrl = streamer.fetta_url || `https://fetta.app/u/${streamer.nickname}`;

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
              {items.map((item, index) => {
                const platformName = getPlatformName(item.product_url);
                
                return (
                  <a 
                    key={index} 
                    className="wishlist-item" 
                    href={fettaUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
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
                      <div className="item-buttons">
                        <span className="item-link item-link-fetta">
                          Смотреть товар
                        </span>
                        {item.product_url && platformName && (
                          <span 
                            className="item-link item-link-marketplace"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.open(item.product_url, '_blank');
                            }}
                          >
                            На {platformName}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <a 
            href={fettaUrl} 
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

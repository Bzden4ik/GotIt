import React from 'react';
import './StreamerCard.css';

function StreamerCard({ streamer, onTrack, onRemove, onViewWishlist }) {
  return (
    <div className="streamer-card-component">
      <img src={streamer.avatar} alt={streamer.nickname} className="avatar" />
      <div className="info">
        <h3>{streamer.nickname}</h3>
        <p className="username">{streamer.username}</p>
        {streamer.description && <p className="description">{streamer.description}</p>}
      </div>
      <div className="actions">
        {onTrack && <button className="btn track" onClick={onTrack}>Отслеживать</button>}
        {onViewWishlist && <button className="btn view" onClick={onViewWishlist}>Вишлист</button>}
        {onRemove && <button className="btn remove" onClick={onRemove}>Удалить</button>}
      </div>
    </div>
  );
}

export default StreamerCard;

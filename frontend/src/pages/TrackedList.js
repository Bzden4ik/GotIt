import React, { useState } from 'react';
import './TrackedList.css';

function TrackedList() {
  const [trackedStreamers, setTrackedStreamers] = useState([]);
  const [selectedStreamer, setSelectedStreamer] = useState(null);

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
                <img src={streamer.avatar} alt={streamer.nickname} className="streamer-avatar" />
                <div className="streamer-info">
                  <h3>{streamer.nickname}</h3>
                  <p className="username">{streamer.username}</p>
                </div>
                <div className="card-actions">
                  <button 
                    className="view-btn"
                    onClick={() => setSelectedStreamer(streamer)}
                  >
                    Вишлист
                  </button>
                  <button className="remove-btn">Удалить</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TrackedList;

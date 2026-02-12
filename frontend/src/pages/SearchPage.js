import React, { useState } from 'react';
import './SearchPage.css';

function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    // TODO: Подключить API
    setTimeout(() => {
      setSearchResults([
        {
          id: 1,
          nickname: 'Fitchu_chan',
          username: '@fitchu_chan',
          avatar: 'https://via.placeholder.com/80',
          description: 'Стример и контент-мейкер'
        }
      ]);
      setLoading(false);
    }, 1000);
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

        {searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map((streamer) => (
              <div key={streamer.id} className="streamer-card">
                <img src={streamer.avatar} alt={streamer.nickname} className="streamer-avatar" />
                <div className="streamer-info">
                  <h3>{streamer.nickname}</h3>
                  <p className="username">{streamer.username}</p>
                  <p className="description">{streamer.description}</p>
                </div>
                <button className="track-btn">Отслеживать</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchPage;

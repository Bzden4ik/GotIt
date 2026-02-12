import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import TrackedList from './pages/TrackedList';
import './App.css';

function App() {
  const [user] = useState(null);

  return (
    <Router basename="/GotIt">
      <div className="app">
        <header className="header">
          <div className="container">
            <h1 className="logo">GotIt</h1>
            <nav className="nav">
              <Link to="/" className="nav-link">Поиск</Link>
              <Link to="/tracked" className="nav-link">Отслеживаю</Link>
            </nav>
            <div className="user-section">
              {user ? (
                <span className="user-info">@{user.username}</span>
              ) : (
                <button className="login-btn">Войти через Telegram</button>
              )}
            </div>
          </div>
        </header>

        <main className="main">
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/tracked" element={<TrackedList />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;

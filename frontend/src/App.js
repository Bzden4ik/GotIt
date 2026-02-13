import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import TrackedList from './pages/TrackedList';
import apiService from './services/api';
import './App.css';

const BOT_USERNAME = process.env.REACT_APP_TELEGRAM_BOT_USERNAME || '';

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Восстановление сессии из localStorage
  useEffect(() => {
    const checkSession = async () => {
      const saved = localStorage.getItem('gotit_user');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          
          // Проверяем существование пользователя в БД
          try {
            const response = await apiService.checkUser(parsed.id);
            if (response.success && response.user) {
              setUser(response.user);
              apiService.setUserId(response.user.id);
            } else {
              // Пользователь не найден в БД - требуется переавторизация
              localStorage.removeItem('gotit_user');
              console.log('Требуется переавторизация');
            }
          } catch (err) {
            // Ошибка проверки - очищаем данные
            localStorage.removeItem('gotit_user');
            console.error('Ошибка проверки пользователя:', err);
          }
        } catch (e) {
          localStorage.removeItem('gotit_user');
        }
      }
      setAuthLoading(false);
    };
    
    checkSession();
  }, []);

  // Обработка авторизации через Telegram Login Widget
  const handleTelegramAuth = useCallback(async (telegramUser) => {
    try {
      const response = await apiService.authTelegram(telegramUser);
      if (response.success && response.user) {
        setUser(response.user);
        apiService.setUserId(response.user.id);
        localStorage.setItem('gotit_user', JSON.stringify(response.user));
      }
    } catch (err) {
      console.error('Ошибка авторизации:', err);
      alert('Ошибка авторизации через Telegram');
    }
  }, []);

  // Глобальный callback для Telegram Widget
  useEffect(() => {
    window.onTelegramAuth = handleTelegramAuth;
    return () => { window.onTelegramAuth = null; };
  }, [handleTelegramAuth]);

  const handleLogout = () => {
    setUser(null);
    apiService.setUserId(null);
    localStorage.removeItem('gotit_user');
  };

  // Telegram Login Widget — вставляем скрипт
  const TelegramWidget = () => {
    const ref = React.useRef(null);

    useEffect(() => {
      if (!BOT_USERNAME || !ref.current) return;
      ref.current.innerHTML = '';
      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.setAttribute('data-telegram-login', BOT_USERNAME);
      script.setAttribute('data-size', 'medium');
      script.setAttribute('data-radius', '8');
      script.setAttribute('data-onauth', 'onTelegramAuth(user)');
      script.setAttribute('data-request-access', 'write');
      script.async = true;
      ref.current.appendChild(script);
    }, []);

    return <div ref={ref} />;
  };

  if (authLoading) return null;

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
                <div className="user-logged">
                  <span className="user-info">
                    {user.username ? `@${user.username}` : user.firstName}
                  </span>
                  <button className="logout-btn" onClick={handleLogout}>Выйти</button>
                </div>
              ) : (
                <TelegramWidget />
              )}
            </div>
          </div>
        </header>

        <main className="main">
          <Routes>
            <Route path="/" element={<SearchPage user={user} />} />
            <Route path="/tracked" element={<TrackedList user={user} />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;

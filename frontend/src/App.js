import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import TrackedList from './pages/TrackedList';
import BackgroundGradient from './components/BackgroundGradient';
import apiService from './services/api';
import './App.css';

const BOT_USERNAME = process.env.REACT_APP_TELEGRAM_BOT_USERNAME || '';

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Восстановление сессии из JWT токена
  useEffect(() => {
    const checkSession = async () => {
      // Проверяем есть ли токен
      if (!apiService.isAuthenticated()) {
        setAuthLoading(false);
        return;
      }

      try {
        // Проверяем токен через API
        const response = await apiService.checkUser();
        if (response.success && response.user) {
          setUser(response.user);
        } else {
          // Токен невалидный - очищаем
          apiService.clearToken();
        }
      } catch (err) {
        console.error('Ошибка проверки токена:', err);
        // Токен невалидный или истёк - очищаем
        apiService.clearToken();
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
        // Токен уже сохранён в apiService.authTelegram()
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
    apiService.clearToken();
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
      <BackgroundGradient />
      <div className="app">
        <header className="header">
          <div className="container">
            <h1 className="logo" href="https://bzden4ik.github.io/GotIt">GotIt</h1>
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

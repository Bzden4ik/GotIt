import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import SearchPage from './pages/SearchPage';
import TrackedList from './pages/TrackedList';
import BackgroundGradient from './components/BackgroundGradient';
import MaintenanceScreen from './components/MaintenanceScreen';
import apiService from './services/api';
import './App.css';

const MAINTENANCE_PATH = '/maintenance';

const BOT_USERNAME = process.env.REACT_APP_TELEGRAM_BOT_USERNAME || '';

// React Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 минут
      cacheTime: 10 * 60 * 1000, // 10 минут
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [maintenance, setMaintenance] = useState(null);

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
        // Инвалидируем кеш при новой авторизации
        queryClient.invalidateQueries();
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
    // Очищаем кеш при выходе
    queryClient.clear();
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

  // Polling статуса техработ каждые 30 секунд
  useEffect(() => {
    const checkStatus = async () => {
      const data = await apiService.getStatus();
      if (data?.success) setMaintenance(data.maintenance);
    };
    checkStatus();
    const id = setInterval(checkStatus, 30000);
    return () => clearInterval(id);
  }, []);

  // Редирект при изменении статуса техработ
  useEffect(() => {
    if (maintenance === null) return; // ещё не загрузился
    const currentPath = window.location.pathname.replace('/GotIt', '') || '/';
    if (maintenance.active && currentPath !== MAINTENANCE_PATH) {
      window.location.replace('/GotIt' + MAINTENANCE_PATH);
    } else if (!maintenance.active && currentPath === MAINTENANCE_PATH) {
      window.location.replace('/GotIt/');
    }
  }, [maintenance]);

  if (authLoading) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <Router basename="/GotIt">
        <BackgroundGradient />
        <div className="app">
          <header className="header">
            <div className="container">
              <div className="logo-group">
                <a href="https://t.me/Bzden4ikkk" target="_blank" rel="noopener noreferrer" className="author-link" title="Telegram @Bzden4ikkk">
                  <span className="author-text">by Bzden4ik</span>
                  <svg className="author-tg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                </a>
                <h1 className="logo">GotIt</h1>
              </div>
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
              <Route path="/maintenance" element={<MaintenanceScreen maintenance={maintenance} asPage />} />
            </Routes>
          </main>
        </div>
      </Router>
      
      {/* React Query DevTools (только в dev) */}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}

export default App;

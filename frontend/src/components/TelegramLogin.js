import React, { useEffect } from 'react';
import './TelegramLogin.css';

function TelegramLogin({ botUsername, onAuth }) {
  useEffect(() => {
    // Telegram Login Widget script
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    script.async = true;

    window.onTelegramAuth = onAuth;

    const container = document.getElementById('telegram-login-container');
    if (container) {
      container.appendChild(script);
    }

    return () => {
      window.onTelegramAuth = null;
    };
  }, [botUsername, onAuth]);

  return (
    <div className="telegram-login">
      <div id="telegram-login-container"></div>
    </div>
  );
}

export default TelegramLogin;

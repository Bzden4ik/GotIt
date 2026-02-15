import React, { useState, useEffect, useRef } from 'react';
import './SearchLoader.css';

// Сообщения с плейсхолдером {nick} для подстановки ника
const MESSAGES = [
  'Ищу стримера...',
  'Пытаюсь найти {nick}...',
  'Заглядываю на Fetta.app...',
  'Хм... трудно найти, но я постараюсь!',
  'Проверяю вишлист {nick}...',
  'Собираю данные о стримере...',
  'Почти нашёл! Ещё чуть-чуть...',
  'Парсю страницу {nick}...',
  'Ищу среди тысяч стримеров...',
  'Загружаю профиль и товары...',
  'Секундочку, уже почти...',
  '{nick}, где ты прячешься?',
  'Копаюсь в данных Fetta...',
  'Нашёл что-то интересное...',
  'Подождите, магия в процессе...',
];

function SearchLoader({ nickname = '' }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [fade, setFade] = useState(true);
  const usedRef = useRef(new Set());
  const timerRef = useRef(null);

  // Выбрать случайное сообщение (не повторяя последние)
  const getNextIndex = () => {
    // Если использовали почти все — сбросить
    if (usedRef.current.size >= MESSAGES.length - 2) {
      usedRef.current.clear();
    }

    let next;
    do {
      next = Math.floor(Math.random() * MESSAGES.length);
    } while (usedRef.current.has(next));

    usedRef.current.add(next);
    return next;
  };

  useEffect(() => {
    // Первое сообщение — всегда "Ищу стримера..."
    setMessageIndex(0);
    usedRef.current.add(0);

    const cycle = () => {
      // Затухание
      setFade(false);

      timerRef.current = setTimeout(() => {
        setMessageIndex(getNextIndex());
        setFade(true);
      }, 400); // пауза на fade-out
    };

    const interval = setInterval(cycle, 2800);

    return () => {
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const displayNick = nickname || 'стримера';
  const currentMessage = MESSAGES[messageIndex].replace(/\{nick\}/g, displayNick);

  return (
    <div className="search-loader">
      <div className="loader-spinner">
        <div className="spinner-ring" />
        <div className="spinner-ring spinner-ring--2" />
        <div className="spinner-ring spinner-ring--3" />
        <div className="spinner-dot" />
      </div>
      <p className={`loader-message ${fade ? 'loader-message--visible' : 'loader-message--hidden'}`}>
        {currentMessage}
      </p>
    </div>
  );
}

export default SearchLoader;

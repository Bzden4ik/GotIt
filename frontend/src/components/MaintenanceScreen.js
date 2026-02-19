import React, { useState, useEffect, useRef } from 'react';
import TextDecode from './TextDecode';
import './MaintenanceScreen.css';

const TERM_LINES = [
  'Инициализация протокола обслуживания...',
  'Остановка активных процессов...',
  'Создание резервной копии данных...',
  'Применение обновлений системы...',
  'Оптимизация базы данных...',
  'Проверка целостности файлов...',
  'Перезапуск сервисов...',
];

function Countdown({ endsAt }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const tick = () => {
      const diff = new Date(endsAt) - new Date();
      if (diff <= 0) { setTimeLeft('00:00:00'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const pad = n => String(n).padStart(2, '0');
      setTimeLeft(`${pad(h)}:${pad(m)}:${pad(s)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return (
    <div className="maint-countdown">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      Завершение через&nbsp;
      <span className="maint-countdown-time">{timeLeft}</span>
    </div>
  );
}

function TerminalLines({ visible }) {
  const [shown, setShown] = useState([]);
  const [done, setDone] = useState([]);
  const timerRef = useRef([]);

  useEffect(() => {
    if (!visible) { setShown([]); setDone([]); return; }

    const timers = timerRef.current;
    TERM_LINES.forEach((_, i) => {
      const t1 = setTimeout(() => setShown(p => [...p, i]), 800 + i * 600);
      const t2 = setTimeout(() => setDone(p => [...p, i]), 800 + i * 600 + 900);
      timers.push(t1, t2);
    });

    return () => timers.forEach(clearTimeout);
  }, [visible]);

  return (
    <div className="maint-term-lines">
      {TERM_LINES.map((line, i) => (
        <div
          key={i}
          className={`maint-term-line${shown.includes(i) ? ' shown' : ''}${done.includes(i) ? ' done' : ''}`}
        >
          <div className="maint-term-line-dot" />
          <span>{line}</span>
        </div>
      ))}
    </div>
  );
}

function MaintenanceScreen({ maintenance }) {
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef(null);
  const observerRef = useRef(null);

  useEffect(() => {
    if (maintenance?.active) {
      const t = setTimeout(() => setVisible(true), 30);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [maintenance?.active]);

  // MutationObserver: если элемент удалили или сняли класс visible — восстанавливаем
  useEffect(() => {
    if (!visible || !overlayRef.current) return;

    const el = overlayRef.current;

    observerRef.current = new MutationObserver(() => {
      // Если класс visible убрали — возвращаем
      if (!el.classList.contains('visible')) {
        el.classList.add('visible');
      }
    });

    // Следим за атрибутами самого элемента
    observerRef.current.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });

    // Следим за удалением из родителя
    const parentObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.removedNodes.forEach(node => {
          if (node === el) {
            // Восстанавливаем элемент
            m.target.appendChild(el);
          }
        });
      }
    });

    if (el.parentNode) {
      parentObserver.observe(el.parentNode, { childList: true });
    }

    return () => {
      observerRef.current?.disconnect();
      parentObserver.disconnect();
    };
  }, [visible]);

  if (!maintenance?.active && !visible) return null;

  const msg = maintenance?.message || 'Совсем скоро всё вернётся в норму!';
  const endsAt = maintenance?.endsAt;

  return (
    <div ref={overlayRef} className={`maint-overlay${visible ? ' visible' : ''}`}>
      <div className="maint-bg">
        <div className="maint-ribbon maint-ribbon--1" />
        <div className="maint-ribbon maint-ribbon--2" />
        <div className="maint-ribbon maint-ribbon--3" />
        <div className="maint-ribbon maint-ribbon--4" />
        <div className="maint-orb maint-orb--1" />
        <div className="maint-orb maint-orb--2" />
        <div className="maint-noise" />
        <div className="maint-scanlines" />
      </div>

      <div className="maint-content">
        <div className="maint-logo-wrap">
          <div className="maint-ring" />
          <div className="maint-ring maint-ring--2" />
          <div className="maint-ring maint-ring--3" />
          <div className="maint-logo-icon" data-text="G">G</div>
        </div>

        {visible && (
          <TextDecode
            text="Технические работы"
            as="h1"
            className="maint-title"
            delay={200}
            duration={900}
          />
        )}

        {visible && (
          <TextDecode
            text={msg}
            as="p"
            className="maint-message"
            delay={600}
            duration={1100}
          />
        )}

        {endsAt && visible && <Countdown endsAt={endsAt} />}

        <div className="maint-terminal">
          <div className="maint-term-header">
            <div className="maint-term-dot" />
            <div className="maint-term-dot" />
            <div className="maint-term-dot" />
          </div>
          <TerminalLines visible={visible} />
        </div>
      </div>
    </div>
  );
}

export default MaintenanceScreen;

import React, { useState, useEffect, useRef, useCallback } from 'react';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function TextDecode({ text, as: Tag = 'span', className = '', delay = 0, duration = 1200 }) {
  const [display, setDisplay] = useState('');
  const [started, setStarted] = useState(false);
  const ref = useRef(null);
  const frameRef = useRef(null);

  const animate = useCallback(() => {
    const chars = text.split('');
    const total = chars.length;
    const steps = Math.ceil(duration / 30);
    let step = 0;

    // Порядок раскрытия — рандомный
    const order = chars.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    // Определяем на каком шаге каждая буква «встанет на место»
    const revealAt = new Array(total).fill(0);
    order.forEach((charIdx, i) => {
      revealAt[charIdx] = Math.floor((i / total) * steps * 0.85) + Math.floor(steps * 0.15);
    });

    const tick = () => {
      step++;
      const result = chars.map((ch, i) => {
        if (ch === ' ') return ' ';
        if (step >= revealAt[i]) return ch;
        // Скрэмбл
        return CHARS[Math.floor(Math.random() * CHARS.length)];
      });
      setDisplay(result.join(''));

      if (step < steps) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(text);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [text, duration]);

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    animate();
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [started, animate]);

  return (
    <Tag ref={ref} className={className} style={{ visibility: started ? 'visible' : 'hidden' }}>
      {display || text}
    </Tag>
  );
}

export default TextDecode;

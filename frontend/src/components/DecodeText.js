import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import './DecodeText.css';

function DecodeText({ text, className = '', delay = 0 }) {
  const textRef = useRef(null);
  const charsRef = useRef([]);

  useEffect(() => {
    if (!textRef.current) return;

    const chars = text.split('');
    charsRef.current = [];

    // Очищаем контейнер
    textRef.current.innerHTML = '';

    // Создаем span для каждого символа
    chars.forEach((char, i) => {
      const span = document.createElement('span');
      span.className = 'decode-char';
      span.textContent = char === ' ' ? '\u00A0' : char;
      span.style.display = 'inline-block';
      textRef.current.appendChild(span);
      charsRef.current.push(span);
    });

    // Анимация появления
    gsap.fromTo(
      charsRef.current,
      {
        opacity: 0,
        filter: 'blur(10px)',
        y: 10,
        scale: 0.95
      },
      {
        opacity: 1,
        filter: 'blur(0px)',
        y: 0,
        scale: 1,
        duration: 0.8,
        delay: delay,
        stagger: {
          amount: 0.6,
          from: 'random'
        },
        ease: 'power2.out',
        onStart: function() {
          // Добавляем фазу "призрачной" буквы
          gsap.to(this.targets(), {
            opacity: 0.3,
            duration: 0.2,
            ease: 'none'
          });
        }
      }
    );
  }, [text, delay]);

  return (
    <div ref={textRef} className={`decode-text ${className}`}></div>
  );
}

export default DecodeText;

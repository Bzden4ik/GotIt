import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import './PageTransition.css';

function PageTransition({ children }) {
  const containerRef = useRef(null);

  useEffect(() => {
    // Анимация появления страницы
    gsap.fromTo(
      containerRef.current,
      {
        opacity: 0,
        y: 20
      },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: 'power2.out'
      }
    );
  }, []);

  return (
    <div ref={containerRef} className="page-transition-container">
      {children}
    </div>
  );
}

export default PageTransition;

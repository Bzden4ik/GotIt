import React, { useEffect, useRef } from 'react';
import './PageTransition.css';

function PageTransition({ children }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Простая CSS анимация без GSAP
    containerRef.current.style.opacity = '0';
    containerRef.current.style.transform = 'translateY(10px)';
    
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        containerRef.current.style.opacity = '1';
        containerRef.current.style.transform = 'translateY(0)';
      }
    });
  }, []);

  return (
    <div ref={containerRef} className="page-transition-container">
      {children}
    </div>
  );
}

export default PageTransition;

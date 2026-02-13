import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

/**
 * Хук для анимации появления элементов
 */
export const useStaggerAnimation = (selector, delay = 0) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = containerRef.current.querySelectorAll(selector);
    
    gsap.fromTo(
      elements,
      {
        opacity: 0,
        y: 30,
        scale: 0.95,
        filter: 'blur(5px)'
      },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: 'blur(0px)',
        duration: 0.6,
        delay: delay,
        stagger: 0.1,
        ease: 'power2.out'
      }
    );
  }, [selector, delay]);

  return containerRef;
};

export default useStaggerAnimation;

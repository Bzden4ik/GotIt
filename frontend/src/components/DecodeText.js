import React, { useEffect, useRef, useState } from 'react';
import './DecodeText.css';

function DecodeText({ text, className = '', delay = 0 }) {
  const [displayText, setDisplayText] = useState('');
  const [isAnimating, setIsAnimating] = useState(true);

  useEffect(() => {
    const chars = text.split('');
    let currentIndex = 0;
    
    const startDelay = setTimeout(() => {
      const interval = setInterval(() => {
        if (currentIndex < chars.length) {
          setDisplayText(text.substring(0, currentIndex + 1));
          currentIndex++;
        } else {
          clearInterval(interval);
          setIsAnimating(false);
        }
      }, 30);

      return () => clearInterval(interval);
    }, delay * 1000);

    return () => clearTimeout(startDelay);
  }, [text, delay]);

  return (
    <span className={`decode-text ${isAnimating ? 'animating' : ''} ${className}`}>
      {displayText}
    </span>
  );
}

export default DecodeText;

import React from 'react';
import './DecodeText.css';

function DecodeText({ text, className = '' }) {
  return (
    <span className={`decode-text ${className}`}>
      {text}
    </span>
  );
}

export default DecodeText;

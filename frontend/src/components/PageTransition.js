import React from 'react';
import './PageTransition.css';

function PageTransition({ children }) {
  return (
    <div className="page-transition-container">
      {children}
    </div>
  );
}

export default PageTransition;

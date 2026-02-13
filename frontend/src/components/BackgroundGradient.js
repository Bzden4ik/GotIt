import React from 'react';
import './BackgroundGradient.css';

function BackgroundGradient() {
  return (
    <div className="bg-scene">
      {/* Ribbon streams */}
      <div className="bg-ribbon bg-ribbon--1" />
      <div className="bg-ribbon bg-ribbon--2" />
      <div className="bg-ribbon bg-ribbon--3" />

      {/* Ambient orbs */}
      <div className="bg-orb bg-orb--1" />
      <div className="bg-orb bg-orb--2" />

      {/* Noise overlay */}
      <div className="bg-noise" />
    </div>
  );
}

export default BackgroundGradient;

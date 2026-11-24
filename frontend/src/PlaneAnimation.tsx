import React from 'react';
import './PlaneAnimation.css';

interface PlaneAnimationProps {
  dir: 'ltr' | 'rtl';
  onComplete: () => void;
  id: number;
}

export const PlaneAnimation: React.FC<PlaneAnimationProps> = ({ dir, onComplete, id }) => {
  return (
    <div 
      key={id} 
      className={`plane-wrapper ${dir}`} 
      onAnimationEnd={onComplete}
    >
      <div className="plane-body">
        {/* След всегда рендерится первым, а Flexbox сам поставит его сзади */}
        <div className="contrail" />
        
        <svg
          className="plane-svg"
          width="3vw" 
          height="3vw"
          viewBox="0 0 24 24"
          fill="#b800ff"
          style={{ filter: 'drop-shadow(0 0 0.5vw rgba(184,0,255,0.6))' }}
          xmlns="http://w3.org"
        >
          <path d="M21 16V14L13 9V3.5C13 2.67 12.33 2 11.5 2C10.67 2 10 2.67 10 3.5V9L2 14V16L10 13.5V19L8 20.5V22L11.5 21L15 22V20.5L13 19V13.5L21 16Z" />
        </svg>
      </div>
    </div>
  );
};
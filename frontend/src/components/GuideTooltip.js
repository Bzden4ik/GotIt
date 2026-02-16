import React, { useState, useEffect, useRef } from 'react';
import './GuideTooltip.css';

function GuideTooltip() {
  const [isVisible, setIsVisible] = useState(false);
  const popupRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (isVisible && popupRef.current) {
      // Прокрутить на середину при открытии
      const scrollWidth = popupRef.current.scrollWidth;
      const clientWidth = popupRef.current.clientWidth;
      popupRef.current.scrollLeft = (scrollWidth - clientWidth) / 2;

      // Добавить обработчик колесика для горизонтальной прокрутки
      const handleWheel = (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          popupRef.current.scrollLeft += e.deltaY;
        }
      };

      const popup = popupRef.current;
      popup.addEventListener('wheel', handleWheel, { passive: false });

      return () => {
        popup.removeEventListener('wheel', handleWheel);
      };
    }
  }, [isVisible]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        isVisible &&
        popupRef.current &&
        triggerRef.current &&
        !popupRef.current.contains(event.target) &&
        !triggerRef.current.contains(event.target)
      ) {
        setIsVisible(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible]);

  const toggleGuide = () => {
    setIsVisible(!isVisible);
  };

  return (
    <div className="guide-tooltip-wrapper">
      <div 
        ref={triggerRef}
        className="guide-trigger"
        onClick={toggleGuide}
      >
        <span className="guide-icon">ⓘ</span>
        <span className="guide-text">Гайд как найти стримера</span>
      </div>

      {isVisible && (
        <div ref={popupRef} className="guide-popup">
          <div className="guide-content">
            <div className="guide-step">
              <img src={`${process.env.PUBLIC_URL}/images/1.jpg`} alt="Шаг 1" className="guide-image" />
              <p className="guide-description">
                <strong>1.</strong> Вам нужна прямая ссылка на Fetta.app стримера. <br /> <strong>Это важно, так как его никнейм там может отличаться от имени на Twitch или других площадках!</strong>
              </p>
            </div>

            <div className="guide-step">
              <img src={`${process.env.PUBLIC_URL}/images/2.jpg`} alt="Шаг 2" className="guide-image" />
              <p className="guide-description">
                <strong>2.</strong> Скопируйте из URL только сам никнейм (текст после слеша).
              </p>
            </div>

            <div className="guide-step">
              <img src={`${process.env.PUBLIC_URL}/images/3.jpg`} alt="Шаг 3" className="guide-image" />
              <p className="guide-description">
                <strong>3.</strong> Вставьте ник в поле поиска и нажмите «Найти». <br /> Дождитесь появления карточки (до 2 минут). <br /> Нажмите «Отслеживать», чтобы подписаться на обновление товаров.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GuideTooltip;

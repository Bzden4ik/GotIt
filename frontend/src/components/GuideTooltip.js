import React, { useState } from 'react';
import './GuideTooltip.css';

function GuideTooltip() {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="guide-tooltip-wrapper">
      <div 
        className="guide-trigger"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        <span className="guide-icon">ⓘ</span>
        <span className="guide-text">Гайд как найти стримера</span>
      </div>

      {isVisible && (
        <div className="guide-popup">
          <div className="guide-content">
            <div className="guide-step">
              <img src={`${process.env.PUBLIC_URL}/images/1.jpg`} alt="Шаг 1" className="guide-image" />
              <p className="guide-description">
                <strong>1.</strong> Вам нужна ссылка на Fetta.app вашего стримера, это главное ведь имя вашего стримера на фетте может отличаться нежели на твиче или там где он стример.
              </p>
            </div>

            <div className="guide-step">
              <img src={`${process.env.PUBLIC_URL}/images/2.jpg`} alt="Шаг 2" className="guide-image" />
              <p className="guide-description">
                <strong>2.</strong> Дальше копируем (Ctrl + C или ПКМ → Копировать) в конце ссылки ник вашего стримера без / только имя!
              </p>
            </div>

            <div className="guide-step">
              <img src={`${process.env.PUBLIC_URL}/images/3.jpg`} alt="Шаг 3" className="guide-image" />
              <p className="guide-description">
                <strong>3.</strong> Тут вы вставляете (Ctrl + V или ПКМ → Вставить) ник вашего стримера в поле: "Введите ник стримера..."
              </p>
            </div>

            <div className="guide-step">
              <img src={`${process.env.PUBLIC_URL}/images/4.jpg`} alt="Шаг 4" className="guide-image" />
              <p className="guide-description">
                <strong>4.</strong> Как только вставили ник нажимаем на кнопку Найти и придется подождать от 1 минуты до 2 минут, как только стример найдется снизу под поиском он появиться и нажимайте на кнопку отслеживать всё готово! Вы подписались на уведомления об обновлении товаров вишлиста этого стримера.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GuideTooltip;

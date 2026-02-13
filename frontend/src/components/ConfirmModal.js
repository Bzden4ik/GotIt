import React, { useState, useEffect } from 'react';
import './ConfirmModal.css';

function ConfirmModal({ title, message, onConfirm, onCancel }) {
  const [rememberChoice, setRememberChoice] = useState(false);

  // Проверяем сохраненный выбор
  useEffect(() => {
    const savedChoice = localStorage.getItem('confirmDelete_remembered');
    if (savedChoice) {
      const { value, timestamp } = JSON.parse(savedChoice);
      
      // Проверяем актуальность (до 7 утра следующего дня по МСК)
      const now = new Date();
      const savedDate = new Date(timestamp);
      
      // Вычисляем 7 утра МСК следующего дня после сохранения
      const nextReset = new Date(savedDate);
      nextReset.setDate(nextReset.getDate() + 1);
      nextReset.setHours(7 - 3, 0, 0, 0); // МСК = UTC+3
      
      if (now < nextReset && value === true) {
        // Автоматически подтверждаем если запомнено
        onConfirm();
        return;
      } else if (now >= nextReset) {
        // Сбрасываем если прошло время
        localStorage.removeItem('confirmDelete_remembered');
      }
    }
  }, [onConfirm]);

  const handleConfirm = () => {
    if (rememberChoice) {
      localStorage.setItem('confirmDelete_remembered', JSON.stringify({
        value: true,
        timestamp: new Date().toISOString()
      }));
    }
    onConfirm();
  };

  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-header">
          <h3>{title}</h3>
        </div>
        
        <div className="confirm-modal-body">
          <p>{message}</p>
          
          <label className="confirm-remember-checkbox">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
            />
            <span>Запомнить выбор до завтра 7:00 МСК</span>
          </label>
        </div>
        
        <div className="confirm-modal-footer">
          <button className="confirm-btn-cancel" onClick={onCancel}>
            Отмена
          </button>
          <button className="confirm-btn-confirm" onClick={handleConfirm}>
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;

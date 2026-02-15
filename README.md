# GotIt

Сервис для отслеживания вишлистов стримеров с fetta.app

## Структура проекта

- `/frontend` - React приложение
  - `/src/components` - компоненты (карточки стримеров, модальные окна)
  - `/src/pages` - страницы (поиск, отслеживаемые)
  - `/src/services` - API-сервис
- `/backend` - Node.js сервер
  - `/bot` - модуль Telegram бота
  - `/database` - работа с SQLite базой данных
  - `/parsers` - парсер fetta.app
  - `scheduler.js` - планировщик проверки вишлистов
  - `server.js` - основной сервер

## Установка

### Frontend
```bash
cd frontend
npm install
npm start
```

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Настройте переменные окружения в .env
npm start
```

### Настройка Telegram бота

1. Создайте бота через [@BotFather](https://t.me/BotFather):
   - Отправьте команду `/newbot`
   - Задайте имя и username бота
   - Получите токен бота

2. Настройте бота для Login Widget:
   - Отправьте `/setdomain` в @BotFather
   - Укажите домен вашего сайта (например, `bzden4ik.github.io`)

3. Добавьте данные бота в `.env`:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_BOT_USERNAME=your_bot_username
   CHECK_INTERVAL=*/30 * * * *
   ```

### Настройка планировщика

Планировщик автоматически проверяет вишлисты стримеров и отправляет уведомления о новых товарах.

**Параметры в `.env`:**
- `CHECK_INTERVAL` - расписание проверки в формате cron (по умолчанию: каждые 30 минут)

**Примеры расписаний:**
- `*/15 * * * *` - каждые 15 минут
- `0 * * * *` - каждый час
- `0 */2 * * *` - каждые 2 часа
- `0 9,18 * * *` - в 9:00 и 18:00 каждый день

## Деплой

### Frontend (GitHub Pages)
```bash
cd frontend
npm run deploy
```

### Backend (VPS)
```bash
# На VPS
git pull
cd backend
npm install
pm2 restart gotit-backend
```

## Тестирование

### Тест Telegram бота
```bash
cd backend
node test-bot.js YOUR_TELEGRAM_ID
```

### Тест планировщика (разовая проверка)
```bash
cd backend
node test-scheduler.js
```

## Технологии

- React - фронтенд
- Node.js + Express - бэкенд
- SQLite (better-sqlite3) - база данных
- Telegram Bot API - уведомления
- Cheerio - парсинг HTML
- node-cron - планировщик задач
- axios - HTTP-запросы

## Возможности

✅ Поиск стримеров на fetta.app  
✅ Авторизация через Telegram  
✅ Добавление стримеров в отслеживаемые  
✅ Просмотр вишлистов стримеров  
✅ Автоматическая проверка новых товаров  
✅ Уведомления в Telegram о новых товарах  
✅ AI-помощник для рекомендаций подарков  
✅ Поддержка групп в Telegram  
✅ JWT аутентификация  
✅ Horizontal scaling (distributed lock)  
✅ N+1 query optimization

## Оптимизации

- **N+1 Query Fix:** Один SQL запрос вместо N+1 при загрузке отслеживаемых стримеров (10x быстрее)
- **Distributed Lock:** Поддержка horizontal scaling без дублирования уведомлений
- **JWT Auth:** Защита от IDOR атак
- **Database Writes:** 99.97% экономия через умные проверки (80M/месяц → 15-30K/месяц)

Подробнее: [OPTIMIZATIONS.md](./OPTIMIZATIONS.md)

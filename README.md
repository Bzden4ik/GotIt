# GotIt

Сервис для отслеживания вишлистов стримеров с fetta.app

## Структура проекта

- `/frontend` - React приложение
- `/backend` - Node.js сервер

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

## Технологии

- React
- Node.js + Express
- Telegram Bot API
- Cheerio (парсинг)

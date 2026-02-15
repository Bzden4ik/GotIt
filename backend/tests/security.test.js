/**
 * Unit-тесты для middleware безопасности
 * Тестируем: rate limiting, error handler, async handler
 */

// Мокаем БД чтобы не требовались env-переменные Turso
jest.mock('../database/database', () => ({}));

const { errorHandler, rateLimit, asyncHandler } = require('../middleware/security');

// Хелпер: создаёт mock req/res/next
function createMocks(ip = '127.0.0.1') {
  return {
    req: { ip, connection: { remoteAddress: ip } },
    res: {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    },
    next: jest.fn(),
  };
}

// ────────────────────────────────────
// Rate Limiting
// ────────────────────────────────────

describe('rateLimit', () => {
  test('пропускает запросы в пределах лимита', () => {
    const middleware = rateLimit({ maxRequests: 3, windowMs: 60000 });
    const { req, res, next } = createMocks('10.0.0.1');

    middleware(req, res, next);
    middleware(req, res, next);
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('блокирует после превышения лимита', () => {
    const middleware = rateLimit({ maxRequests: 2, windowMs: 60000 });
    const { req, res, next } = createMocks('10.0.0.2');

    middleware(req, res, next); // 1 — ok
    middleware(req, res, next); // 2 — ok
    middleware(req, res, next); // 3 — blocked

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  test('разные IP имеют отдельные счётчики', () => {
    const middleware = rateLimit({ maxRequests: 1, windowMs: 60000 });

    const mock1 = createMocks('192.168.1.1');
    const mock2 = createMocks('192.168.1.2');

    middleware(mock1.req, mock1.res, mock1.next); // IP1 — 1/1
    middleware(mock2.req, mock2.res, mock2.next); // IP2 — 1/1

    expect(mock1.next).toHaveBeenCalledTimes(1);
    expect(mock2.next).toHaveBeenCalledTimes(1);
  });

  test('использует значения по умолчанию', () => {
    const middleware = rateLimit();
    const { req, res, next } = createMocks('10.0.0.99');

    // Должен пропустить хотя бы 1 запрос
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// ────────────────────────────────────
// Error Handler
// ────────────────────────────────────

describe('errorHandler', () => {
  test('возвращает 500 по умолчанию', () => {
    const { req, res, next } = createMocks();
    const err = new Error('Test error');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  test('использует statusCode из ошибки', () => {
    const { req, res, next } = createMocks();
    const err = new Error('Not found');
    err.statusCode = 404;

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('скрывает детали в production', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const { req, res, next } = createMocks();
    errorHandler(new Error('Secret details'), req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Внутренняя ошибка сервера' })
    );

    process.env.NODE_ENV = origEnv;
  });

  test('показывает детали в development', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const { req, res, next } = createMocks();
    errorHandler(new Error('Debug info'), req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Debug info' })
    );

    process.env.NODE_ENV = origEnv;
  });
});

// ────────────────────────────────────
// Async Handler
// ────────────────────────────────────

describe('asyncHandler', () => {
  test('пробрасывает ошибку в next()', async () => {
    const { req, res, next } = createMocks();
    const error = new Error('Async fail');
    const handler = asyncHandler(async () => { throw error; });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  test('не вызывает next при успехе', async () => {
    const { req, res, next } = createMocks();
    const handler = asyncHandler(async (req, res) => {
      res.json({ ok: true });
    });

    await handler(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });
});

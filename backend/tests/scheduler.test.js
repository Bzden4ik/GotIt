/**
 * Unit-тесты для Scheduler
 * Тестируем: isWithinWorkingHours, защита от повторного запуска, singleton
 */

// Мокаем все зависимости
jest.mock('../parsers/fettaParser', () => ({
  getStreamerInfo: jest.fn(),
}));

jest.mock('../database/database', () => ({
  tryAcquireSchedulerLock: jest.fn().mockResolvedValue(true),
  updateSchedulerHeartbeat: jest.fn().mockResolvedValue(),
  releaseSchedulerLock: jest.fn().mockResolvedValue(),
  getAllTrackedStreamers: jest.fn().mockResolvedValue([]),
  getWishlistItems: jest.fn().mockResolvedValue([]),
  getNewWishlistItems: jest.fn().mockResolvedValue([]),
  saveWishlistItems: jest.fn().mockResolvedValue(),
  getStreamerFollowers: jest.fn().mockResolvedValue([]),
  getGroupsForStreamerNotifications: jest.fn().mockResolvedValue([]),
  getStreamerSettings: jest.fn().mockResolvedValue({ notifications_enabled: 1, notify_in_pm: 1 }),
}));

jest.mock('../bot/telegramBot', () => {
  return jest.fn().mockImplementation(() => ({
    sendNewItemsNotification: jest.fn().mockResolvedValue(),
  }));
});

// Нужно очищать singleton между тестами
let Scheduler;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Сбрасываем singleton
  jest.resetModules();
  Scheduler = require('../scheduler');
});

afterEach(() => {
  jest.useRealTimers();
});

// ────────────────────────────────────
// isWithinWorkingHours
// ────────────────────────────────────

describe('isWithinWorkingHours', () => {
  test('активен в 12:00 МСК (9:00 UTC)', () => {
    jest.setSystemTime(new Date('2026-02-15T09:00:00Z'));
    const scheduler = new Scheduler(null);
    expect(scheduler.isWithinWorkingHours()).toBe(true);
  });

  test('активен в 7:00 МСК (4:00 UTC)', () => {
    jest.setSystemTime(new Date('2026-02-15T04:00:00Z'));
    const scheduler = new Scheduler(null);
    expect(scheduler.isWithinWorkingHours()).toBe(true);
  });

  test('активен в 23:00 МСК (20:00 UTC)', () => {
    jest.setSystemTime(new Date('2026-02-15T20:00:00Z'));
    const scheduler = new Scheduler(null);
    expect(scheduler.isWithinWorkingHours()).toBe(true);
  });

  test('активен в 2:59 МСК (23:59 UTC)', () => {
    jest.setSystemTime(new Date('2026-02-15T23:59:00Z'));
    const scheduler = new Scheduler(null);
    expect(scheduler.isWithinWorkingHours()).toBe(true);
  });

  test('активен в 3:00 МСК (0:00 UTC)', () => {
    jest.setSystemTime(new Date('2026-02-15T00:00:00Z'));
    const scheduler = new Scheduler(null);
    expect(scheduler.isWithinWorkingHours()).toBe(true);
  });

  test('неактивен в 4:00 МСК (1:00 UTC)', () => {
    jest.setSystemTime(new Date('2026-02-15T01:00:00Z'));
    const scheduler = new Scheduler(null);
    expect(scheduler.isWithinWorkingHours()).toBe(false);
  });

  test('неактивен в 5:30 МСК (2:30 UTC)', () => {
    jest.setSystemTime(new Date('2026-02-15T02:30:00Z'));
    const scheduler = new Scheduler(null);
    expect(scheduler.isWithinWorkingHours()).toBe(false);
  });

  test('неактивен в 6:59 МСК (3:59 UTC)', () => {
    jest.setSystemTime(new Date('2026-02-15T03:59:00Z'));
    const scheduler = new Scheduler(null);
    expect(scheduler.isWithinWorkingHours()).toBe(false);
  });
});

// ────────────────────────────────────
// Singleton pattern
// ────────────────────────────────────

describe('Singleton', () => {
  test('возвращает тот же экземпляр при повторном создании', () => {
    const s1 = new Scheduler('token1');
    const s2 = new Scheduler('token2');
    expect(s1.schedulerId).toBe(s2.schedulerId);
  });
});

// ────────────────────────────────────
// start / startChecks — защита от повторного запуска
// ────────────────────────────────────

describe('start', () => {
  test('не запускается повторно если isRunning = true', async () => {
    const scheduler = new Scheduler(null);
    scheduler.isRunning = true;

    await scheduler.start(30);

    // Если бы запустился — создал бы intervalId
    expect(scheduler.intervalId).toBeNull();
  });
});

describe('startChecks', () => {
  test('устанавливает isRunning в true', () => {
    const scheduler = new Scheduler(null);
    scheduler.startChecks(30);

    expect(scheduler.isRunning).toBe(true);
  });

  test('не запускается повторно', () => {
    const scheduler = new Scheduler(null);
    scheduler.startChecks(30);
    const firstIntervalId = scheduler.intervalId;

    scheduler.startChecks(30); // повторный вызов
    expect(scheduler.intervalId).toBe(firstIntervalId); // не изменился
  });

  test('создаёт heartbeat и основной интервал', () => {
    const scheduler = new Scheduler(null);
    scheduler.startChecks(30);

    expect(scheduler.heartbeatId).not.toBeNull();
    expect(scheduler.intervalId).not.toBeNull();
  });
});

// ────────────────────────────────────
// stop — корректная остановка
// ────────────────────────────────────

describe('stop', () => {
  test('очищает все интервалы', async () => {
    const scheduler = new Scheduler(null);
    scheduler.startChecks(30);

    expect(scheduler.isRunning).toBe(true);

    await scheduler.stop();

    expect(scheduler.isRunning).toBe(false);
    expect(scheduler.intervalId).toBeNull();
    expect(scheduler.heartbeatId).toBeNull();
  });

  test('очищает retryIntervalId', async () => {
    const scheduler = new Scheduler(null);
    scheduler.retryIntervalId = setInterval(() => {}, 1000);

    await scheduler.stop();

    expect(scheduler.retryIntervalId).toBeNull();
  });
});

// ────────────────────────────────────
// checkAllStreamers — защита от параллельных проверок
// ────────────────────────────────────

describe('checkAllStreamers', () => {
  test('пропускает если уже выполняется', async () => {
    const db = require('../database/database');
    const scheduler = new Scheduler(null);
    scheduler.isChecking = true;

    await scheduler.checkAllStreamers();

    // getAllTrackedStreamers не должен был вызваться
    expect(db.getAllTrackedStreamers).not.toHaveBeenCalled();
  });

  test('устанавливает isChecking и сбрасывает после завершения', async () => {
    const db = require('../database/database');
    db.getAllTrackedStreamers.mockResolvedValue([]);

    const scheduler = new Scheduler(null);
    expect(scheduler.isChecking).toBe(false);

    await scheduler.checkAllStreamers();

    expect(scheduler.isChecking).toBe(false); // Сброшен после завершения
  });

  test('сбрасывает isChecking при ошибке', async () => {
    const db = require('../database/database');
    db.getAllTrackedStreamers.mockRejectedValue(new Error('DB error'));

    const scheduler = new Scheduler(null);

    await scheduler.checkAllStreamers();

    expect(scheduler.isChecking).toBe(false); // finally всегда сбрасывает
  });

  test('дедуплицирует стримеров по nickname (case-insensitive)', async () => {
    const db = require('../database/database');
    const fettaParser = require('../parsers/fettaParser');

    db.getAllTrackedStreamers.mockResolvedValue([
      { id: 1, nickname: 'Simfonira', name: 'Simfonira', fetta_url: 'url1' },
      { id: 2, nickname: 'simfonira', name: 'simfonira', fetta_url: 'url2' },
    ]);

    fettaParser.getStreamerInfo.mockResolvedValue({
      success: true,
      wishlist: [],
      profile: {},
    });

    db.getWishlistItems.mockResolvedValue([]);
    db.getNewWishlistItems.mockResolvedValue([]);

    const scheduler = new Scheduler(null);
    await scheduler.checkAllStreamers();

    // Должен проверить только 1 стримера (не 2)
    expect(fettaParser.getStreamerInfo).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────
// checkStreamer — логика проверки одного стримера
// ────────────────────────────────────

describe('checkStreamer', () => {
  const mockStreamer = { id: 1, nickname: 'TestStreamer', name: 'Test', fetta_url: 'https://fetta.app/u/TestStreamer' };

  test('пропускает при неуспешном парсинге', async () => {
    const fettaParser = require('../parsers/fettaParser');
    const db = require('../database/database');

    fettaParser.getStreamerInfo.mockResolvedValue({ success: false, error: 'Not found' });

    const scheduler = new Scheduler(null);
    await scheduler.checkStreamer(mockStreamer);

    expect(db.saveWishlistItems).not.toHaveBeenCalled();
  });

  test('защита: не сохраняет при 0 товаров из API если в базе есть', async () => {
    const fettaParser = require('../parsers/fettaParser');
    const db = require('../database/database');

    fettaParser.getStreamerInfo.mockResolvedValue({ success: true, wishlist: [] });
    db.getWishlistItems.mockResolvedValue([{ id: 1, product_id: 'p1' }]);

    const scheduler = new Scheduler(null);
    await scheduler.checkStreamer(mockStreamer);

    expect(db.saveWishlistItems).not.toHaveBeenCalled();
  });

  test('защита: не сохраняет при подозрительно малом количестве товаров', async () => {
    const fettaParser = require('../parsers/fettaParser');
    const db = require('../database/database');

    fettaParser.getStreamerInfo.mockResolvedValue({
      success: true,
      wishlist: [{ id: 'p1', name: 'Item', price: '100 ₽' }]
    });
    // В базе 20 товаров, а API вернул 1
    db.getWishlistItems.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ id: i, product_id: `p${i}` }))
    );

    const scheduler = new Scheduler(null);
    await scheduler.checkStreamer(mockStreamer);

    expect(db.saveWishlistItems).not.toHaveBeenCalled();
  });

  test('защита от спама: пропускает уведомления при первой синхронизации', async () => {
    const fettaParser = require('../parsers/fettaParser');
    const db = require('../database/database');

    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`, externalId: `e${i}`, name: `Item ${i}`, price: '100 ₽'
    }));

    fettaParser.getStreamerInfo.mockResolvedValue({ success: true, wishlist: items });
    db.getWishlistItems.mockResolvedValue([]); // База пустая
    db.getNewWishlistItems.mockResolvedValue(items); // Все товары "новые"

    const scheduler = new Scheduler('test-token');
    await scheduler.checkStreamer(mockStreamer);

    // Сохраняет товары
    expect(db.saveWishlistItems).toHaveBeenCalled();
    // Но НЕ запрашивает подписчиков (нет уведомлений)
    expect(db.getStreamerFollowers).not.toHaveBeenCalled();
  });

  test('отправляет уведомления при реальных новых товарах', async () => {
    const fettaParser = require('../parsers/fettaParser');
    const db = require('../database/database');

    const existingItems = [
      { id: 1, product_id: 'p1', external_id: 'e1' },
      { id: 2, product_id: 'p2', external_id: 'e2' },
    ];

    const apiItems = [
      { id: 'p1', externalId: 'e1', name: 'Old', price: '100 ₽' },
      { id: 'p2', externalId: 'e2', name: 'Old2', price: '200 ₽' },
      { id: 'p3', externalId: 'e3', name: 'New!', price: '300 ₽' },
    ];

    fettaParser.getStreamerInfo.mockResolvedValue({ success: true, wishlist: apiItems });
    db.getWishlistItems.mockResolvedValue(existingItems);
    db.getNewWishlistItems.mockResolvedValue([apiItems[2]]); // Только 1 новый
    db.getStreamerFollowers.mockResolvedValue([
      { id: 1, telegram_id: 123, username: 'user1' }
    ]);

    const scheduler = new Scheduler('test-token');
    await scheduler.checkStreamer(mockStreamer);

    expect(db.getStreamerFollowers).toHaveBeenCalledWith(1);
    expect(db.saveWishlistItems).toHaveBeenCalled();
  });
});

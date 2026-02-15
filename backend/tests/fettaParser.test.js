/**
 * Unit-тесты для FettaParser
 * Тестируем: извлечение UID, парсинг профиля, маппинг товаров
 */

// Мокаем зависимости ДО импорта
jest.mock('axios');
const axios = require('axios');

// Парсер экспортируется как singleton — нужен свежий экземпляр
// Перезагружаем модуль для каждого теста
let fettaParser;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Очищаем кеш модуля чтобы получить чистый экземпляр
  delete require.cache[require.resolve('../parsers/fettaParser')];
  fettaParser = require('../parsers/fettaParser');
});

afterEach(() => {
  jest.useRealTimers();
});

// ────────────────────────────────────
// extractUidFromHtml — Стратегия 1: RSC payload (escaped JSON)
// ────────────────────────────────────

describe('extractUidFromHtml', () => {
  const VALID_UUID = '5c6f5a4d-3740-4bdb-8e18-fc2ad6659410';

  test('извлекает UID из escaped wishlistOwnerId', () => {
    const html = `<script>self.__next_f.push([1,"{\\"wishlistOwnerId\\":\\"${VALID_UUID}\\"}"])</script>`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  test('извлекает UID из escaped targetUserId', () => {
    const html = `<script>data:\\"targetUserId\\":\\"${VALID_UUID}\\"</script>`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  test('извлекает UID из escaped userId', () => {
    const html = `some content \\"userId\\":\\"${VALID_UUID}\\" more content`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  test('извлекает UID из escaped ownerId', () => {
    const html = `\\"ownerId\\":\\"${VALID_UUID}\\"`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  // Стратегия 2: обычный JSON
  test('извлекает UID из обычного JSON wishlistOwnerId', () => {
    const html = `<script>{"wishlistOwnerId":"${VALID_UUID}"}</script>`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  test('извлекает UID из обычного JSON с пробелами', () => {
    const html = `"userId" : "${VALID_UUID}"`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  test('извлекает UID из обычного JSON uid', () => {
    const html = `{"uid":"${VALID_UUID}"}`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  // Стратегия 3: __NEXT_DATA__
  test('извлекает UID из __NEXT_DATA__', () => {
    const nextData = {
      props: {
        pageProps: {
          userId: VALID_UUID
        }
      }
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  test('извлекает вложенный UID из __NEXT_DATA__', () => {
    const nextData = {
      props: {
        pageProps: {
          data: {
            streamer: {
              wishlistOwnerId: VALID_UUID
            }
          }
        }
      }
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  // Стратегия 4: RSC chunks
  test('извлекает UID из self.__next_f.push chunks', () => {
    const html = `
      <script>self.__next_f.push([1,"some data"])</script>
      <script>self.__next_f.push([1,"${VALID_UUID}"])</script>
    `;
    // Стратегия 4 срабатывает если предыдущие не нашли
    // Но тут UUID может быть найден через стратегию 5 (все UUID)
    const result = fettaParser.extractUidFromHtml(html);
    expect(result).toBe(VALID_UUID);
  });

  // Стратегия 5: fallback — все UUID
  test('находит UUID как fallback', () => {
    const html = `<div>${VALID_UUID}</div><p>some other content</p>`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(VALID_UUID);
  });

  test('берёт первый уникальный UUID при нескольких', () => {
    const uuid1 = '11111111-1111-1111-1111-111111111111';
    const uuid2 = '22222222-2222-2222-2222-222222222222';
    const html = `<div>${uuid1} ${uuid2} ${uuid1}</div>`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(uuid1);
  });

  // Негативные кейсы
  test('возвращает null если нет UUID', () => {
    const html = '<html><body>No UUID here</body></html>';
    expect(fettaParser.extractUidFromHtml(html)).toBeNull();
  });

  test('возвращает null для пустой строки', () => {
    expect(fettaParser.extractUidFromHtml('')).toBeNull();
  });

  // Приоритет стратегий
  test('приоритет escaped wishlistOwnerId над обычным UUID', () => {
    const priorityUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const randomUuid = '11111111-2222-3333-4444-555555555555';
    const html = `<div>${randomUuid}</div><script>\\"wishlistOwnerId\\":\\"${priorityUuid}\\"</script>`;
    expect(fettaParser.extractUidFromHtml(html)).toBe(priorityUuid);
  });
});

// ────────────────────────────────────
// findUidInObject — рекурсивный поиск
// ────────────────────────────────────

describe('findUidInObject', () => {
  const UUID = '12345678-1234-1234-1234-123456789012';

  test('находит UID на верхнем уровне', () => {
    expect(fettaParser.findUidInObject({ userId: UUID })).toBe(UUID);
  });

  test('находит UID во вложенном объекте', () => {
    const obj = { level1: { level2: { wishlistOwnerId: UUID } } };
    expect(fettaParser.findUidInObject(obj)).toBe(UUID);
  });

  test('игнорирует не-UUID строки', () => {
    expect(fettaParser.findUidInObject({ userId: 'not-a-uuid' })).toBeNull();
  });

  test('возвращает null для null/undefined', () => {
    expect(fettaParser.findUidInObject(null)).toBeNull();
    expect(fettaParser.findUidInObject(undefined)).toBeNull();
  });

  test('возвращает null для пустого объекта', () => {
    expect(fettaParser.findUidInObject({})).toBeNull();
  });

  test('возвращает null для примитивов', () => {
    expect(fettaParser.findUidInObject(42)).toBeNull();
    expect(fettaParser.findUidInObject('string')).toBeNull();
  });
});

// ────────────────────────────────────
// parseStreamerProfile — парсинг HTML профиля
// ────────────────────────────────────

describe('parseStreamerProfile', () => {
  const mockHtml = `
    <html>
      <body>
        <img alt="Profile picture" src="https://cdn.fetta.app/avatar.jpg" />
        <h2>PersieQ</h2>
        <span>@persieq_twitch</span>
        <span class="text-tertiary">Стримерша, люблю аниме и рукоделие!</span>
        <a target="_blank" href="https://twitch.tv/persieq">Twitch</a>
        <a target="_blank" href="https://t.me/persieq_channel">Telegram</a>
        <a target="_blank" href="https://youtube.com/c/persieq">YouTube</a>
      </body>
    </html>
  `;

  test('извлекает аватар', () => {
    const profile = fettaParser.parseStreamerProfile(mockHtml, 'PersieQ', 'test-uid');
    expect(profile.avatar).toBe('https://cdn.fetta.app/avatar.jpg');
  });

  test('извлекает имя из h2', () => {
    const profile = fettaParser.parseStreamerProfile(mockHtml, 'PersieQ', 'test-uid');
    expect(profile.name).toBe('PersieQ');
  });

  test('извлекает username с @', () => {
    const profile = fettaParser.parseStreamerProfile(mockHtml, 'PersieQ', 'test-uid');
    expect(profile.username).toBe('@persieq_twitch');
  });

  test('извлекает описание из text-tertiary span', () => {
    const profile = fettaParser.parseStreamerProfile(mockHtml, 'PersieQ', 'test-uid');
    expect(profile.description).toContain('Стримерша');
  });

  test('извлекает социальные ссылки', () => {
    const profile = fettaParser.parseStreamerProfile(mockHtml, 'PersieQ', 'test-uid');
    expect(profile.socialLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'twitch' }),
        expect.objectContaining({ platform: 'telegram' }),
        expect.objectContaining({ platform: 'youtube' }),
      ])
    );
  });

  test('формирует fettaUrl', () => {
    const profile = fettaParser.parseStreamerProfile(mockHtml, 'PersieQ', 'test-uid');
    expect(profile.fettaUrl).toBe('https://fetta.app/u/PersieQ');
  });

  test('использует nickname как fallback имени', () => {
    const minimalHtml = '<html><body></body></html>';
    const profile = fettaParser.parseStreamerProfile(minimalHtml, 'TestStreamer', 'uid');
    expect(profile.name).toBe('TestStreamer');
    expect(profile.nickname).toBe('TestStreamer');
  });

  test('формирует дефолтный username', () => {
    const minimalHtml = '<html><body></body></html>';
    const profile = fettaParser.parseStreamerProfile(minimalHtml, 'TestStreamer', 'uid');
    expect(profile.username).toBe('@TestStreamer');
  });

  test('добавляет baseUrl к относительным аватарам', () => {
    const html = '<html><body><img alt="Profile picture" src="/images/avatar.jpg" /></body></html>';
    const profile = fettaParser.parseStreamerProfile(html, 'Test', 'uid');
    expect(profile.avatar).toBe('https://fetta.app/images/avatar.jpg');
  });
});

// ────────────────────────────────────
// getStreamerInfo — полный флоу (с моками)
// ────────────────────────────────────

describe('getStreamerInfo', () => {
  const MOCK_UID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  const mockHtmlPage = `
    <html>
      <body>
        <script>\\"wishlistOwnerId\\":\\"${MOCK_UID}\\"</script>
        <img alt="Profile picture" src="https://cdn.fetta.app/avatar.jpg" />
        <h2>TestStreamer</h2>
        <span>@test_streamer</span>
      </body>
    </html>
  `;

  const mockProducts = [
    { id: 'prod-1', externalId: 'ext-1', name: 'Нитки', price: 660, imageUrl: 'img1.jpg', isPinned: false, isUnavailable: false },
    { id: 'prod-2', externalId: 'ext-2', name: 'Тени', price: 202, imageUrl: 'img2.jpg', isPinned: true, isUnavailable: false },
  ];

  beforeEach(() => {
    // Мокаем внутренние методы чтобы обойти setTimeout задержки при пагинации
    jest.spyOn(fettaParser, 'fetchStreamerPage').mockResolvedValue(mockHtmlPage);
    jest.spyOn(fettaParser, 'verifyUid').mockResolvedValue(true);
    jest.spyOn(fettaParser, 'getWishlistFromAPI').mockResolvedValue(mockProducts);
    jest.spyOn(fettaParser, 'getCategoriesFromAPI').mockResolvedValue([{ id: 1, name: 'Рукоделие' }]);
  });

  test('возвращает success: true при валидных данных', async () => {
    const result = await fettaParser.getStreamerInfo('TestStreamer');
    expect(result.success).toBe(true);
  });

  test('возвращает профиль стримера', async () => {
    const result = await fettaParser.getStreamerInfo('TestStreamer');
    expect(result.profile.nickname).toBe('TestStreamer');
    expect(result.profile.uid).toBe(MOCK_UID);
  });

  test('возвращает отформатированный вишлист', async () => {
    const result = await fettaParser.getStreamerInfo('TestStreamer');
    expect(result.wishlist).toHaveLength(2);
    expect(result.wishlist[0].id).toBe('prod-1');
    expect(result.wishlist[0].name).toBe('Нитки');
  });

  test('цены увеличиваются на 8% с округлением вверх', async () => {
    const result = await fettaParser.getStreamerInfo('TestStreamer');
    // 660 * 1.08 = 712.8 → ceil = 713
    expect(result.wishlist[0].price).toBe('713 ₽');
    expect(result.wishlist[0].priceRaw).toBe(713);
    // 202 * 1.08 = 218.16 → ceil = 219
    expect(result.wishlist[1].price).toBe('219 ₽');
  });

  test('формирует ссылку на Ozon из externalId', async () => {
    const result = await fettaParser.getStreamerInfo('TestStreamer');
    expect(result.wishlist[0].productUrl).toBe('https://www.ozon.ru/product/ext-1');
  });

  test('возвращает категории', async () => {
    const result = await fettaParser.getStreamerInfo('TestStreamer');
    expect(result.categories).toHaveLength(1);
  });

  test('обрабатывает ошибку fetchStreamerPage', async () => {
    fettaParser.fetchStreamerPage.mockRejectedValue({ response: { status: 404 } });
    const result = await fettaParser.getStreamerInfo('NonExistent');
    expect(result.success).toBe(false);
  });

  test('фильтрует товары без ID', async () => {
    fettaParser.getWishlistFromAPI.mockResolvedValue([
      { id: 'prod-1', name: 'Valid', price: 100, imageUrl: '' },
      { id: null, name: 'Invalid', price: 200, imageUrl: '' },
    ]);
    fettaParser.getCategoriesFromAPI.mockResolvedValue([]);

    const result = await fettaParser.getStreamerInfo('Test');
    expect(result.wishlist).toHaveLength(1);
    expect(result.wishlist[0].name).toBe('Valid');
  });

  test('обрабатывает нулевую цену', async () => {
    fettaParser.getWishlistFromAPI.mockResolvedValue([
      { id: 'prod-1', name: 'Free', price: 0, imageUrl: '' },
    ]);
    fettaParser.getCategoriesFromAPI.mockResolvedValue([]);

    const result = await fettaParser.getStreamerInfo('Test');
    expect(result.wishlist[0].price).toBe('');
    expect(result.wishlist[0].priceRaw).toBe(0);
  });

  test('ищет другой UID если первый не прошёл проверку', async () => {
    const badUid = '11111111-1111-1111-1111-111111111111';
    const goodUid = '22222222-2222-2222-2222-222222222222';

    const htmlWithBadUid = `\\"wishlistOwnerId\\":\\"${badUid}\\" and also ${goodUid}`;
    fettaParser.fetchStreamerPage.mockResolvedValue(htmlWithBadUid);

    // Первый UID не проходит, второй — да
    fettaParser.verifyUid
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    fettaParser.getWishlistFromAPI.mockResolvedValue([]);
    fettaParser.getCategoriesFromAPI.mockResolvedValue([]);

    const result = await fettaParser.getStreamerInfo('Test');
    expect(result.success).toBe(true);
    expect(result.profile.uid).toBe(goodUid);
  });
});

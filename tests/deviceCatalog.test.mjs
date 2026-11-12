// Каталог электрики: метаданные, дерево разделов, поиск и UI-настройки.
// Запуск: node tests/deviceCatalog.test.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let passed = 0;
let failed = 0;
async function test(name, body) {
  try {
    await body();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n${error.stack ?? error}`);
  }
}

const SECTION_IDS = ['sockets', 'switches', 'lighting', 'power', 'lowvoltage', 'other'];
const CONNECTIONS = ['socket', 'terminal', 'direct', 'provision'];
const GLYPHS = [
  'socket',
  'switch_key',
  'switch_pass',
  'switch_cross',
  'switch_dimmer',
  'switch_motion',
  'switch_presence',
  'switch_provision',
  'light_ceiling',
  'light_surface',
  'light_recessed',
  'light_sconce',
  'light_wall_wet',
  'light_track',
  'light_strip',
  'light_outdoor',
  'light_provision',
];

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  const {
    DEVICE_CATALOG,
    DEVICE_CATALOG_TREE,
    DEVICE_SECTIONS,
    DEVICE_TYPES,
    buildDeviceCatalogTree,
    deviceCatalogPath,
    searchDeviceCatalog,
  } = await server.ssrLoadModule('/src/core/electrical/devices.ts');
  const {
    DEFAULT_DEVICE_UI_PREFERENCES,
    loadDeviceUiPreferences,
    rememberRecentDevice,
    saveDeviceUiPreferences,
    toggleFavoriteDevice,
  } = await server.ssrLoadModule('/src/core/electrical/devicePreferences.ts');

  await test('каждый тип прибора имеет полные метаданные', () => {
    assert.equal(DEVICE_TYPES.length, Object.keys(DEVICE_CATALOG).length);
    assert.equal(new Set(DEVICE_TYPES).size, DEVICE_TYPES.length, 'duplicate device types');
    for (const type of DEVICE_TYPES) {
      const entry = DEVICE_CATALOG[type];
      assert.ok(entry, `${type}: missing catalog entry`);
      assert.ok(entry.label.trim(), `${type}: empty label`);
      assert.ok(entry.shortLabel.trim(), `${type}: empty shortLabel`);
      assert.ok(SECTION_IDS.includes(entry.section), `${type}: bad section`);
      assert.ok(entry.subsection.trim(), `${type}: empty subsection`);
      assert.ok(Number.isFinite(entry.order), `${type}: non-finite order`);
      assert.ok(['wall', 'ceiling'].includes(entry.mounting), `${type}: bad mounting`);
      assert.ok(entry.defaultHeightMm >= 0, `${type}: negative height`);
      assert.ok(entry.defaultPowerWatts >= 0, `${type}: negative power`);
      assert.match(entry.ipRating, /^IP\d{2}$/, `${type}: bad IP rating`);
      assert.ok(CONNECTIONS.includes(entry.connection), `${type}: bad connection`);
      assert.ok(Array.isArray(entry.normRefs) && entry.normRefs.length > 0,
        `${type}: no norm references`);
      assert.ok(entry.normRefs.every((ref) => typeof ref === 'string' && ref.trim()),
        `${type}: empty norm reference`);
      assert.ok(Array.isArray(entry.keywords) && entry.keywords.length > 0,
        `${type}: no keywords`);
      assert.ok(entry.keywords.every((word) => typeof word === 'string' && word.trim()),
        `${type}: empty keyword`);
      assert.ok(entry.description.trim(), `${type}: empty description`);
      assert.ok(entry.badge.trim(), `${type}: empty badge`);
      assert.ok(GLYPHS.includes(entry.glyph), `${type}: bad glyph`);
      if (entry.glyph === 'socket') {
        assert.ok([1, 2, 3].includes(entry.outlets), `${type}: bad outlets`);
      }
      if (entry.glyph === 'switch_key' || entry.glyph === 'switch_pass') {
        assert.ok([1, 2, 3].includes(entry.keys), `${type}: bad keys`);
      }
      if (entry.mounting === 'ceiling') {
        assert.equal(entry.defaultHeightMm, 0, `${type}: ceiling height must be 0`);
      }
    }
  });

  await test('дерево содержит все разделы и каждый элемент ровно один раз', () => {
    assert.equal(DEVICE_CATALOG_TREE.length, DEVICE_SECTIONS.length);
    assert.deepEqual(
      DEVICE_CATALOG_TREE.map((view) => view.section.id),
      DEVICE_SECTIONS.map((section) => section.id)
    );
    const counts = Object.fromEntries(
      DEVICE_CATALOG_TREE.map((view) => [view.section.id, view.count])
    );
    assert.deepEqual(counts, {
      sockets: 13,
      switches: 11,
      lighting: 9,
      power: 0,
      lowvoltage: 0,
      other: 0,
    });
    const seen = [];
    for (const view of DEVICE_CATALOG_TREE) {
      assert.equal(view.count, view.subsections.reduce(
        (sum, subsection) => sum + subsection.leaves.length, 0
      ));
      for (const subsection of view.subsections) {
        assert.ok(subsection.label.trim(), 'empty subsection label');
        assert.equal(
          new Set(subsection.leaves.map((leaf) => leaf.type)).size,
          subsection.leaves.length,
          `${subsection.id}: duplicate leaves`
        );
        for (const leaf of subsection.leaves) {
          assert.equal(leaf.entry.section, view.section.id, `${leaf.type}: wrong section`);
          assert.equal(leaf.entry.subsection, subsection.label, `${leaf.type}: wrong subsection`);
          seen.push(leaf.type);
        }
      }
    }
    assert.equal(seen.length, DEVICE_TYPES.length);
    assert.deepEqual([...seen].sort(), [...DEVICE_TYPES].sort());
    assert.deepEqual(buildDeviceCatalogTree(), DEVICE_CATALOG_TREE);
  });

  await test('подразделы «Розетки» идут по количеству гнёзд', () => {
    const sockets = DEVICE_CATALOG_TREE.find((view) => view.section.id === 'sockets');
    assert.deepEqual(
      sockets.subsections.map((subsection) => subsection.label),
      ['1 гнездо', '2 гнезда', '3 гнезда', 'Специальные']
    );
    assert.deepEqual(
      sockets.subsections[0].leaves.map((leaf) => leaf.type),
      ['socket_single', 'socket_wet', 'socket_outdoor']
    );
    assert.deepEqual(
      sockets.subsections[1].leaves.map((leaf) => leaf.type),
      ['socket_double', 'socket_double_wet', 'socket_double_outdoor', 'socket_double_usb']
    );
  });

  await test('deviceCatalogPath строит полный путь', () => {
    const path = deviceCatalogPath('socket_wet');
    assert.equal(path.section.id, 'sockets');
    assert.equal(path.section.label, 'Розетки');
    assert.equal(path.subsection, '1 гнездо');
    assert.equal(path.leaf.entry.ipRating, 'IP44');
    assert.equal(path.leaf.type, 'socket_wet');

    const light = deviceCatalogPath('light_ceiling');
    assert.equal(light.section.id, 'lighting');
    assert.equal(light.leaf.entry.mounting, 'ceiling');
  });

  await test('поиск находит элементы по ключевым словам, IP и бейджу', () => {
    assert.deepEqual(
      searchDeviceCatalog('влаж').map((leaf) => leaf.type),
      ['socket_wet', 'socket_outdoor', 'socket_double_wet', 'socket_triple_wet', 'switch_wet', 'light_wall_wet']
    );
    assert.deepEqual(
      searchDeviceCatalog('IP44').map((leaf) => leaf.type),
      ['socket_wet', 'socket_double_wet', 'socket_triple_wet', 'socket_appliance', 'switch_wet', 'light_wall_wet']
    );
    assert.deepEqual(
      searchDeviceCatalog('люстра').map((leaf) => leaf.type),
      ['light_ceiling']
    );
    assert.deepEqual(
      searchDeviceCatalog('32 А').map((leaf) => leaf.type),
      ['socket_hob']
    );
    assert.equal(searchDeviceCatalog('розетка').length, 13);
    assert.deepEqual(
      searchDeviceCatalog('  ').map((leaf) => leaf.type),
      []
    );
    assert.deepEqual(
      searchDeviceCatalog('нет-такого').map((leaf) => leaf.type),
      []
    );
  });

  const { linePurposeFor } = await server.ssrLoadModule('/src/core/electrical/panel.ts');

  await test('назначение линии выводится из каталога для всех новых типов', () => {
    const room = (id, type) => ({ id, name: id, type, vertices: [] });
    const living = room('living', 'living');
    const kitchen = room('kitchen', 'kitchen');
    const bathroom = room('bathroom', 'bathroom');
    const device = (type) => ({
      id: `device-${type}`,
      type,
      name: type,
      anchor: { kind: 'room_point', roomId: living.id, x: 0, y: 0 },
      heightFromFloorMm: 0,
      powerWatts: 0,
      shared: false,
    });

    for (const type of ['light_sconce', 'light_recessed', 'light_provision', 'switch_motion', 'switch_pass_2k', 'switch_provision']) {
      assert.equal(linePurposeFor(device(type), living), 'lighting', `${type}: lighting`);
    }
    assert.equal(linePurposeFor(device('socket_hob'), kitchen), 'hob');
    assert.equal(linePurposeFor(device('socket_oven'), kitchen), 'oven');
    assert.equal(linePurposeFor(device('socket_appliance'), kitchen), 'washing');
    assert.equal(linePurposeFor(device('socket_double_wet'), living), 'wet');
    assert.equal(linePurposeFor(device('socket_outdoor'), living), 'wet');
    assert.equal(linePurposeFor(device('socket_triple_wet'), kitchen), 'wet');
    assert.equal(linePurposeFor(device('socket_double'), kitchen), 'kitchen');
    assert.equal(linePurposeFor(device('socket_fridge'), kitchen), 'kitchen');
    assert.equal(linePurposeFor(device('socket_single'), bathroom), 'wet');
    assert.equal(linePurposeFor(device('socket_double_usb'), living), 'sockets');
  });

  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };

  await test('недавние элементы без дублей и с ограничением', () => {
    let prefs = DEFAULT_DEVICE_UI_PREFERENCES;
    prefs = rememberRecentDevice('socket_single', prefs);
    prefs = rememberRecentDevice('switch_1k', prefs);
    prefs = rememberRecentDevice('socket_single', prefs);
    assert.deepEqual(prefs.recentDeviceTypes, ['socket_single', 'switch_1k']);

    for (const type of DEVICE_TYPES) prefs = rememberRecentDevice(type, prefs);
    assert.equal(prefs.recentDeviceTypes.length, 6);
    assert.equal(new Set(prefs.recentDeviceTypes).size, 6);
    assert.deepEqual(DEFAULT_DEVICE_UI_PREFERENCES.recentDeviceTypes, []);
  });

  await test('избранное добавляется и снимается', () => {
    let prefs = DEFAULT_DEVICE_UI_PREFERENCES;
    prefs = toggleFavoriteDevice('socket_double', prefs);
    prefs = toggleFavoriteDevice('light_ceiling', prefs);
    assert.deepEqual(prefs.favoriteDeviceTypes, ['light_ceiling', 'socket_double']);
    prefs = toggleFavoriteDevice('socket_double', prefs);
    assert.deepEqual(prefs.favoriteDeviceTypes, ['light_ceiling']);
  });

  await test('настройки сохраняются и читаются в отдельном ключе', () => {
    storage.clear();
    const prefs = {
      recentDeviceTypes: ['socket_wet', 'switch_2k'],
      favoriteDeviceTypes: ['socket_double'],
    };
    saveDeviceUiPreferences(prefs);
    assert.ok(storage.has('electrica-ui-prefs-v1'));
    assert.equal(storage.has('electrica-project-v1'), false);
    assert.deepEqual(loadDeviceUiPreferences(), prefs);
  });

  await test('битые и чужие значения отбрасываются', () => {
    storage.clear();
    storage.set('electrica-ui-prefs-v1', '{ broken json');
    assert.deepEqual(loadDeviceUiPreferences(), DEFAULT_DEVICE_UI_PREFERENCES);

    storage.set('electrica-ui-prefs-v1', JSON.stringify({
      recentDeviceTypes: ['socket_single', 'shaft', 'socket_single', 42],
      favoriteDeviceTypes: 'socket_double',
    }));
    assert.deepEqual(loadDeviceUiPreferences(), {
      recentDeviceTypes: ['socket_single'],
      favoriteDeviceTypes: [],
    });

    storage.set('electrica-ui-prefs-v1', JSON.stringify(['socket_single']));
    assert.deepEqual(loadDeviceUiPreferences(), DEFAULT_DEVICE_UI_PREFERENCES);
  });
} catch (error) {
  failed += 1;
  console.error(`FAIL test setup\n${error.stack ?? error}`);
} finally {
  if (server) {
    try {
      await server.close();
    } catch (error) {
      failed += 1;
      console.error(`FAIL Vite cleanup\n${error.stack ?? error}`);
    }
  }
}
console.log(`\n${passed} passed; ${failed} failed`);
if (failed > 0) process.exitCode = 1;

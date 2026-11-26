// Этап 4: замечания состава линий — общий вход проходных, свободные клавиши.
// Запуск: node tests/slotDiagnostics.test.mjs
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

const saved = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: (key) => saved.delete(key),
    clear: () => saved.clear(),
  },
});

const room = {
  id: 'room-1',
  name: 'Зал',
  type: 'living',
  nodeIds: [],
  vertices: [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ],
  color: '#334155',
  wallThicknessMm: 120,
};

function device(id, type, name, powerWatts) {
  return {
    id,
    type,
    name,
    anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 1, offsetMm: 1000 },
    heightFromFloorMm: 900,
    powerWatts,
    shared: false,
  };
}

function makeLine(id, patch = {}) {
  return {
    id,
    name: id,
    purpose: 'lighting',
    roomIds: ['room-1'],
    deviceIds: [],
    loadW: 500,
    cable: { sectionMm2: 1.5, cores: 3 },
    breaker: { poles: 1, ratingA: 10, curve: 'C' },
    rcd: null,
    ...patch,
  };
}

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const { defaultPanelSupply } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );
  const { assignDeviceSlots, collectLineCompositionWarnings } =
    await server.ssrLoadModule('/src/core/electrical/lineOps.ts');
  const { collectDevicesWithFreeSlots } = await server.ssrLoadModule(
    '/src/core/electrical/lineAssignment.ts'
  );

  // Двухклавишный обычный (slotCanShareFeed: false)
  const sw = device('sw1', 'switch_2k', 'Выключатель', 2000);
  // Проходной двухклавишный (slotCanShareFeed: true)
  const pass = device('pass1', 'switch_pass_2k', 'Проходной', 2000);
  const socket = device('soc1', 'socket_single', 'Розетка', 100);
  const devices = [sw, pass, socket];
  const ctx = { devices, rooms: [room], partitions: [] };

  function panel(lines) {
    return {
      id: 'panel-1',
      name: 'Щит',
      anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 0, offsetMm: 1500 },
      heightFromFloorMm: 1600,
      mounting: 'flush',
      strategy: 'custom',
      lines,
      supply: defaultPanelSupply(10000),
    };
  }

  const sharedById = (warnings) =>
    warnings.find((warning) => warning.id.startsWith('shared-feed-'));

  await test('общий вход: клавиши в разных линиях дают предупреждение', () => {
    let p = panel([makeLine('a'), makeLine('b')]);
    p = assignDeviceSlots(p, 'a', [{ deviceId: 'sw1', slots: [0] }], ctx);
    p = assignDeviceSlots(p, 'b', [{ deviceId: 'sw1', slots: [1] }], ctx);
    const warnings = collectLineCompositionWarnings(p, devices);
    const shared = sharedById(warnings);
    assert.ok(shared, 'предупреждение общего входа присутствует');
    assert.equal(shared.id, 'shared-feed-sw1');
    assert.equal(shared.severity, 'warning');
    assert.equal(shared.deviceId, 'sw1');
    assert.ok(shared.message.includes('Клавиша 1'), 'имя клавиши 1 в тексте');
    assert.ok(shared.message.includes('Клавиша 2'), 'имя клавиши 2 в тексте');
    assert.ok(shared.message.includes('сквозной ток'), 'пояснение про сквозной ток');
  });

  await test('общий вход: обе клавиши в одной линии — без предупреждения', () => {
    let p = panel([makeLine('a')]);
    p = assignDeviceSlots(p, 'a', [{ deviceId: 'sw1' }], ctx);
    const warnings = collectLineCompositionWarnings(p, devices);
    assert.equal(sharedById(warnings), undefined);
  });

  await test('общий вход: slotCanShareFeed true не ругается на разные линии', () => {
    let p = panel([makeLine('a'), makeLine('b')]);
    p = assignDeviceSlots(p, 'a', [{ deviceId: 'pass1', slots: [0] }], ctx);
    p = assignDeviceSlots(p, 'b', [{ deviceId: 'pass1', slots: [1] }], ctx);
    const warnings = collectLineCompositionWarnings(p, devices);
    assert.equal(sharedById(warnings), undefined);
  });

  await test('свободные клавиши: прибор в линии, но одна клавиша не назначена', () => {
    let p = panel([makeLine('a')]);
    p = assignDeviceSlots(p, 'a', [{ deviceId: 'sw1', slots: [0] }], ctx);
    const free = collectDevicesWithFreeSlots(devices, p);
    assert.equal(free.length, 1);
    assert.equal(free[0].device.id, 'sw1');
    assert.deepEqual(free[0].slots, [1]);
  });

  await test('свободные клавиши: полностью вне линий не попадает в список', () => {
    // Розетка и проходной нигде не назначены — это «прибор вне линий», не «свободная клавиша».
    let p = panel([makeLine('a')]);
    p = assignDeviceSlots(p, 'a', [{ deviceId: 'sw1' }], ctx);
    const free = collectDevicesWithFreeSlots(devices, p);
    assert.equal(free.length, 0, 'целый прибор без свободных клавиш, остальные вне линий');
  });

  await test('свободные клавиши: без щитка список пуст', () => {
    assert.deepEqual(collectDevicesWithFreeSlots(devices, null), []);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await server?.close();
}

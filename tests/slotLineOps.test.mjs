// Этап 2: операции состава линий по слотам и действия стора.
// Запуск: node tests/slotLineOps.test.mjs
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

const switch2 = {
  id: 'sw1',
  type: 'switch_2k',
  name: 'Выключатель двухклавишный',
  anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 1, offsetMm: 1000 },
  heightFromFloorMm: 900,
  powerWatts: 2000,
  shared: false,
};

const provision = {
  id: 'prov1',
  type: 'light_provision',
  name: 'Закладная под светильник',
  anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 2, offsetMm: 1000 },
  heightFromFloorMm: 0,
  powerWatts: 0,
  shared: false,
};

const socket = {
  id: 'soc1',
  type: 'socket_single',
  name: 'Розетка',
  anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 3, offsetMm: 1000 },
  heightFromFloorMm: 300,
  powerWatts: 100,
  shared: false,
};

const devices = [switch2, provision, socket];
const ctx = { devices, rooms: [room], partitions: [] };

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

function makePanel(lines) {
  return {
    id: 'panel-1',
    name: 'Щит',
    anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 0, offsetMm: 1500 },
    heightFromFloorMm: 1600,
    mounting: 'flush',
    strategy: 'custom',
    lines,
  };
}

function lineOf(panel, id) {
  return panel.lines.find((line) => line.id === id);
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
  const {
    assignDeviceSlots,
    unassignDeviceSlots,
    setLineComposition,
    createLineFromSlots,
    splitLineSlots,
    mergeLines,
    appendUnassignedDevices,
  } = await server.ssrLoadModule('/src/core/electrical/lineOps.ts');
  const { useProjectStore } = await server.ssrLoadModule(
    '/src/store/useProjectStore.ts'
  );

  const state = () => useProjectStore.getState();
  const history = () => useProjectStore.temporal.getState();

  function fullPanel(lines) {
    return { ...makePanel(lines), supply: defaultPanelSupply(10000) };
  }

  function splitPanel() {
    let panel = fullPanel([makeLine('a'), makeLine('b')]);
    panel = assignDeviceSlots(panel, 'a', [{ deviceId: 'sw1', slots: [0] }], ctx);
    panel = assignDeviceSlots(panel, 'b', [{ deviceId: 'sw1', slots: [1] }], ctx);
    return panel;
  }

  function fixture(panel) {
    useProjectStore.setState({
      panel,
      rooms: [room],
      devices,
      freePartitions: [],
      selection: null,
      lineAssignLineId: null,
      lineAssignStartPanel: null,
    });
  }

  await test('две клавиши расходятся по двум линиям без двойного счёта', () => {
    const panel = splitPanel();
    const a = lineOf(panel, 'a');
    const b = lineOf(panel, 'b');
    assert.deepEqual(a.deviceIds, ['sw1']);
    assert.deepEqual(a.slotMembers, { sw1: [0] });
    assert.equal(a.loadW, 1000);
    assert.deepEqual(b.deviceIds, ['sw1']);
    assert.deepEqual(b.slotMembers, { sw1: [1] });
    assert.equal(b.loadW, 1000);
  });

  await test('целый прибор забирает все свои слоты из второй линии', () => {
    let panel = splitPanel();
    panel = assignDeviceSlots(panel, 'a', [{ deviceId: 'sw1' }], ctx);
    const a = lineOf(panel, 'a');
    const b = lineOf(panel, 'b');
    assert.deepEqual(a.deviceIds, ['sw1']);
    assert.equal(a.slotMembers, undefined);
    assert.equal(a.loadW, 2000);
    assert.deepEqual(b.deviceIds, []);
    assert.equal(b.slotMembers, undefined);
    assert.equal(b.loadW, 500, 'линия без приборов возвращается к нагрузке пресета');
  });

  await test('из целого прибора можно забрать одну клавишу', () => {
    let panel = fullPanel([makeLine('a'), makeLine('b')]);
    panel = assignDeviceSlots(panel, 'a', [{ deviceId: 'sw1' }], ctx);
    panel = assignDeviceSlots(panel, 'b', [{ deviceId: 'sw1', slots: [1] }], ctx);
    const a = lineOf(panel, 'a');
    const b = lineOf(panel, 'b');
    assert.deepEqual(a.deviceIds, ['sw1']);
    assert.deepEqual(a.slotMembers, { sw1: [0] });
    assert.equal(a.loadW, 1000);
    assert.deepEqual(b.slotMembers, { sw1: [1] });
    assert.equal(b.loadW, 1000);
  });

  await test('снятие одной клавиши не трогает вторую линию', () => {
    let panel = splitPanel();
    panel = unassignDeviceSlots(panel, [{ deviceId: 'sw1', slots: [0] }], ctx);
    const a = lineOf(panel, 'a');
    const b = lineOf(panel, 'b');
    assert.deepEqual(a.deviceIds, []);
    assert.equal(a.slotMembers, undefined);
    assert.equal(a.loadW, 500);
    assert.deepEqual(b.slotMembers, { sw1: [1] });
    assert.equal(b.loadW, 1000);
  });

  await test('setLineComposition переводит клавишу и очищает прежнюю линию', () => {
    let panel = splitPanel();
    panel = setLineComposition(panel, 'a', [{ deviceId: 'sw1', slots: [1] }], ctx);
    const a = lineOf(panel, 'a');
    const b = lineOf(panel, 'b');
    assert.deepEqual(a.slotMembers, { sw1: [1] });
    assert.equal(a.loadW, 1000);
    assert.deepEqual(b.deviceIds, []);
    assert.equal(b.loadW, 500);
  });

  await test('setLineComposition без изменений возвращает тот же объект', () => {
    const panel = splitPanel();
    const next = setLineComposition(
      panel,
      'a',
      [{ deviceId: 'sw1', slots: [0] }],
      ctx
    );
    assert.equal(next, panel);
  });

  await test('createLineFromSlots забирает только выбранную клавишу', () => {
    let panel = fullPanel([makeLine('a')]);
    panel = assignDeviceSlots(panel, 'a', [{ deviceId: 'sw1' }], ctx);
    const result = createLineFromSlots(
      panel,
      [{ deviceId: 'sw1', slots: [1] }],
      { purpose: 'lighting' },
      ctx
    );
    const a = lineOf(result.panel, 'a');
    const created = result.panel.lines.find((line) => line.id === result.lineId);
    assert.deepEqual(a.slotMembers, { sw1: [0] });
    assert.equal(a.loadW, 1000);
    assert.deepEqual(created.slotMembers, { sw1: [1] });
    assert.equal(created.loadW, 1000);
    assert.equal(a.name, 'a', 'имя исходной линии не меняется');
  });

  await test('splitLineSlots оставляет остаток в источнике', () => {
    let panel = fullPanel([makeLine('a')]);
    panel = assignDeviceSlots(panel, 'a', [{ deviceId: 'sw1' }], ctx);
    const result = splitLineSlots(
      panel,
      'a',
      [{ deviceId: 'sw1', slots: [0] }],
      ctx
    );
    assert.ok(result);
    const source = lineOf(result.panel, 'a');
    const created = result.panel.lines.find((line) => line.id === result.lineId);
    assert.deepEqual(source.slotMembers, { sw1: [1] });
    assert.equal(source.loadW, 1000);
    assert.deepEqual(created.slotMembers, { sw1: [0] });
    assert.equal(created.loadW, 1000);
    assert.equal(source.deviceIds.length, 1);
  });

  await test('splitLineSlots отказывает, если переносится весь прибор', () => {
    let panel = fullPanel([makeLine('a')]);
    panel = assignDeviceSlots(panel, 'a', [{ deviceId: 'sw1' }], ctx);
    assert.equal(splitLineSlots(panel, 'a', [{ deviceId: 'sw1' }], ctx), null);
    assert.equal(
      splitLineSlots(panel, 'a', [{ deviceId: 'sw1', slots: [0, 1] }], ctx),
      null
    );
  });

  await test('mergeLines собирает клавиши в целый прибор', () => {
    const panel = splitPanel();
    const result = mergeLines(panel, ['a', 'b'], ctx);
    assert.ok(result);
    assert.equal(result.panel.lines.length, 1);
    const merged = lineOf(result.panel, 'a');
    assert.deepEqual(merged.deviceIds, ['sw1']);
    assert.equal(merged.slotMembers, undefined);
    assert.equal(merged.loadW, 2000);
  });

  await test('appendUnassignedDevices добавляет свободные клавиши и закладную', () => {
    let panel = fullPanel([makeLine('a')]);
    panel = assignDeviceSlots(panel, 'a', [{ deviceId: 'sw1', slots: [0] }], ctx);
    const first = appendUnassignedDevices(panel, ctx);
    const a = lineOf(first.panel, 'a');
    assert.equal(first.assigned, 2, 'свободная клавиша и закладная');
    assert.deepEqual(a.deviceIds, ['sw1', 'prov1']);
    assert.equal(a.slotMembers, undefined, 'вторая клавиша дополняет прибор до целого');
    assert.equal(a.loadW, 2000);
    const second = appendUnassignedDevices(first.panel, ctx);
    assert.equal(second.assigned, 0);
    assert.deepEqual(lineOf(second.panel, 'a').deviceIds, ['sw1', 'prov1']);
  });

  await test('store: назначение клавиши — один шаг undo', () => {
    fixture(splitPanel());
    state().assignDeviceSlotsToLine('b', [{ deviceId: 'sw1', slots: [0] }]);
    const b = lineOf(state().panel, 'b');
    assert.deepEqual(b.deviceIds, ['sw1']);
    assert.equal(b.slotMembers, undefined);
    assert.equal(b.loadW, 2000);
    assert.deepEqual(lineOf(state().panel, 'a').deviceIds, []);
    history().undo();
    assert.deepEqual(lineOf(state().panel, 'a').slotMembers, { sw1: [0] });
    assert.deepEqual(lineOf(state().panel, 'b').slotMembers, { sw1: [1] });
    history().redo();
    assert.equal(lineOf(state().panel, 'b').slotMembers, undefined);
  });

  await test('store: снятие клавиши с линий', () => {
    fixture(splitPanel());
    state().unassignDeviceSlotsFromLines([{ deviceId: 'sw1', slots: [1] }]);
    assert.equal(lineOf(state().panel, 'b').loadW, 500);
    assert.deepEqual(lineOf(state().panel, 'a').slotMembers, { sw1: [0] });
    assert.ok(state().toasts.at(-1)?.message.includes('Снято с линий'));
  });

  await test('store: деление одной клавишей и отмена', () => {
    fixture(fullPanel([makeLine('a')]));
    state().assignDeviceSlotsToLine('a', [{ deviceId: 'sw1' }]);
    const newId = state().splitPanelLineSlots('a', [
      { deviceId: 'sw1', slots: [1] },
    ]);
    assert.ok(newId);
    assert.deepEqual(lineOf(state().panel, 'a').slotMembers, { sw1: [0] });
    assert.deepEqual(
      lineOf(state().panel, newId).slotMembers,
      { sw1: [1] }
    );
    history().undo();
    assert.equal(state().panel.lines.length, 1);
    assert.equal(lineOf(state().panel, 'a').slotMembers, undefined);
  });

  await test('store: создание линии из клавиши', () => {
    fixture(fullPanel([makeLine('a')]));
    state().assignDeviceSlotsToLine('a', [{ deviceId: 'sw1' }]);
    const newId = state().createPanelLineFromSlots(
      [{ deviceId: 'sw1', slots: [1] }],
      'lighting'
    );
    assert.ok(newId);
    assert.deepEqual(lineOf(state().panel, 'a').slotMembers, { sw1: [0] });
    assert.deepEqual(lineOf(state().panel, newId).slotMembers, { sw1: [1] });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await server?.close();
}

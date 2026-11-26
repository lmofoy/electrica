// Электрические слоты приборов: клавиши, каналы и распределение по линиям.
// Запуск: node tests/deviceSlots.test.mjs
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

const settings = {
  defaultWallThicknessMm: 120,
  exteriorWallThicknessMm: 250,
  ceilingHeightMm: 2700,
  floorLevelMm: 0,
  cableMarginPercent: 15,
  defaultRouting: 'ceiling',
  showDimensions: true,
};

const room = {
  id: 'room-1',
  name: 'Зал',
  type: 'living',
  nodeIds: ['n1', 'n2', 'n3', 'n4'],
  vertices: [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ],
  color: '#334155',
  wallThicknessMm: 120,
};
const nodes = {
  n1: { id: 'n1', x: 0, y: 0 },
  n2: { id: 'n2', x: 4000, y: 0 },
  n3: { id: 'n3', x: 4000, y: 3000 },
  n4: { id: 'n4', x: 0, y: 3000 },
};
const walls = room.nodeIds.map((nodeId, index) => ({
  id: `w${index + 1}`,
  nodeAId: nodeId,
  nodeBId: room.nodeIds[(index + 1) % room.nodeIds.length],
  thicknessMm: 120,
  isExterior: true,
  roomIds: ['room-1'],
}));

const switch2 = {
  id: 'sw1',
  type: 'switch_2k',
  name: 'Выключатель двухклавишный',
  anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 1, offsetMm: 1000 },
  heightFromFloorMm: 900,
  powerWatts: 2000,
  shared: false,
};

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

function baseSnapshot(patch = {}) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    boundaryMode: 'manual',
    settings,
    apartment: null,
    rooms: [room],
    nodes,
    walls,
    openings: [],
    freePartitions: [],
    devices: [switch2],
    frames: [],
    panel: null,
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

  const { isProjectSnapshot, useProjectStore } =
    await server.ssrLoadModule('/src/store/useProjectStore.ts');
  const {
    DEVICE_CATALOG,
    deviceLineSlotCount,
    deviceSlotLabel,
    deviceSlotsPowerW,
    deviceWholeSlots,
  } = await server.ssrLoadModule('/src/core/electrical/devices.ts');
  const {
    freeDeviceSlots,
    lineDeviceSlots,
    linesOfDevice,
    prunePanelRefs,
    slotOwner,
  } = await server.ssrLoadModule('/src/core/electrical/lineAssignment.ts');
  const { normalizeLineAssignments } = await server.ssrLoadModule(
    '/src/core/electrical/lineOps.ts'
  );
  const { createEmptyPanel } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );

  const state = () => useProjectStore.getState();
  const device = { id: 'sw1', type: 'switch_2k' };

  // ---------------------------------------------------------------
  // Каталог: слоты и их ограничения
  // ---------------------------------------------------------------
  await test('catalog: slots match switch contacts and provision stubs', () => {
    assert.equal(DEVICE_CATALOG.switch_1k.lineSlots ?? 1, 1);
    assert.equal(DEVICE_CATALOG.switch_2k.lineSlots, 2);
    assert.equal(DEVICE_CATALOG.switch_3k.lineSlots, 3);
    assert.equal(DEVICE_CATALOG.switch_pass_2k.lineSlots, 2);
    assert.equal(DEVICE_CATALOG.switch_cross.lineSlots ?? 1, 1);
    assert.equal(DEVICE_CATALOG.switch_provision.lineSlots, 0);
    assert.equal(DEVICE_CATALOG.light_provision.lineSlots, 0);
    assert.equal(DEVICE_CATALOG.socket_double.lineSlots ?? 1, 1);
    assert.equal(DEVICE_CATALOG.switch_2k.slotCanShareFeed, false, 'common input');
    assert.equal(DEVICE_CATALOG.switch_pass_2k.slotCanShareFeed, true, 'split channels');
    assert.deepEqual(DEVICE_CATALOG.switch_2k.slotLabels, ['Клавиша 1', 'Клавиша 2']);

    assert.equal(deviceLineSlotCount({ type: 'socket_single' }), 1);
    assert.equal(deviceLineSlotCount({ type: 'switch_3k' }), 3);
    assert.deepEqual(deviceWholeSlots({ type: 'switch_2k' }), [0, 1]);
    assert.equal(deviceSlotLabel({ type: 'switch_2k' }, 1), 'Клавиша 2');
    assert.equal(deviceSlotLabel({ type: 'socket_single' }, 0), 'Слот 1');

    const twoKeys = { type: 'switch_2k', powerWatts: 1000 };
    assert.equal(deviceSlotsPowerW(twoKeys, [0]), 500);
    assert.equal(deviceSlotsPowerW(twoKeys, [0, 1]), 1000);
    assert.equal(deviceSlotsPowerW(twoKeys, []), 0);
    assert.equal(deviceSlotsPowerW(twoKeys, [5]), 0, 'out-of-range ignored');
  });

  // ---------------------------------------------------------------
  // prunePanelRefs: распределение по слотам
  // ---------------------------------------------------------------
  await test('prune: one device on two lines keeps disjoint keys and splits load', () => {
    const panel = makePanel([
      makeLine('line-a', {
        deviceIds: ['sw1'],
        slotMembers: { sw1: [0] },
        loadW: 1000,
      }),
      makeLine('line-b', {
        deviceIds: ['sw1'],
        slotMembers: { sw1: [1] },
        loadW: 1000,
      }),
    ]);
    const pruned = prunePanelRefs(panel, [switch2], ['room-1']);
    assert.ok(pruned);
    assert.deepEqual(pruned.lines[0].deviceIds, ['sw1']);
    assert.deepEqual(pruned.lines[1].deviceIds, ['sw1']);
    assert.deepEqual(pruned.lines[0].slotMembers, { sw1: [0] });
    assert.deepEqual(pruned.lines[1].slotMembers, { sw1: [1] });
    assert.equal(pruned.lines[0].loadW, 1000, 'half of 2000 W');
    assert.equal(pruned.lines[1].loadW, 1000);

    assert.deepEqual(lineDeviceSlots(pruned.lines[0], device), [0]);
    assert.deepEqual(lineDeviceSlots(pruned.lines[1], device), [1]);
    assert.equal(slotOwner(pruned, device, 0).id, 'line-a');
    assert.equal(slotOwner(pruned, device, 1).id, 'line-b');
    assert.deepEqual(freeDeviceSlots(pruned, device), []);
    assert.equal(linesOfDevice(pruned, device).length, 2);
  });

  await test('prune: duplicate key goes to the first line, free keys stay', () => {
    const panel = makePanel([
      makeLine('line-a', { deviceIds: ['sw1'], slotMembers: { sw1: [0] } }),
      makeLine('line-b', { deviceIds: ['sw1'], slotMembers: { sw1: [0, 1] } }),
    ]);
    const pruned = prunePanelRefs(panel, [switch2], ['room-1']);
    assert.deepEqual(pruned.lines[1].slotMembers, { sw1: [1] });
    assert.equal(pruned.lines[1].loadW, 1000);

    const duplicate = prunePanelRefs(
      makePanel([
        makeLine('line-a', { deviceIds: ['sw1'], slotMembers: { sw1: [0] } }),
        makeLine('line-b', { deviceIds: ['sw1'], slotMembers: { sw1: [0] } }),
      ]),
      [switch2],
      ['room-1']
    );
    assert.deepEqual(duplicate.lines[1].deviceIds, [], 'no free key left');
    assert.equal(duplicate.lines[1].slotMembers, undefined);
    assert.equal(duplicate.lines[1].loadW, 500, 'preset load only');
  });

  await test('prune: whole device claims every key and conflicts drop later', () => {
    const twoLines = prunePanelRefs(
      makePanel([
        makeLine('line-a', { deviceIds: ['sw1'], loadW: 2000 }),
        makeLine('line-b', { deviceIds: ['sw1'], loadW: 2000 }),
      ]),
      [switch2],
      ['room-1']
    );
    assert.deepEqual(twoLines.lines[0].deviceIds, ['sw1']);
    assert.equal(twoLines.lines[0].slotMembers, undefined, 'whole device stays implicit');
    assert.equal(twoLines.lines[0].loadW, 2000);
    assert.deepEqual(twoLines.lines[1].deviceIds, []);
    assert.equal(twoLines.lines[1].loadW, 500, 'preset after the device is removed');

    const fullExplicit = prunePanelRefs(
      makePanel([
        makeLine('line-a', {
          deviceIds: ['sw1'],
          slotMembers: { sw1: [1, 0] },
        }),
      ]),
      [switch2],
      ['room-1']
    );
    assert.equal(fullExplicit.lines[0].slotMembers, undefined, 'all keys canonicalize');
    assert.equal(fullExplicit.lines[0].loadW, 2000);
  });

  await test('prune: stale references and bad keys are cleaned without breaking the line', () => {
    const stale = prunePanelRefs(
      makePanel([
        makeLine('line-a', {
          deviceIds: ['sw1', 'ghost', 'sw1'],
          slotMembers: { sw1: [5], ghost: [0], dropped: [0] },
        }),
      ]),
      [switch2],
      ['room-1']
    );
    assert.deepEqual(stale.lines[0].deviceIds, []);
    assert.equal(stale.lines[0].slotMembers, undefined);
    assert.equal(stale.lines[0].loadW, 500);

    const legacy = makePanel([makeLine('line-a', { deviceIds: ['sw1'] })]);
    assert.equal(prunePanelRefs(legacy, [switch2], ['room-1']), legacy, 'no-op stays');
    assert.equal(linesOfDevice(legacy, device)[0].slots.join(','), '0,1');

    const provision = {
      ...switch2,
      id: 'prov',
      type: 'switch_provision',
      powerWatts: 0,
    };
    const twice = prunePanelRefs(
      makePanel([
        makeLine('line-a', { deviceIds: ['prov'] }),
        makeLine('line-b', { deviceIds: ['prov'] }),
      ]),
      [provision],
      ['room-1']
    );
    assert.deepEqual(twice.lines[0].deviceIds, ['prov']);
    assert.deepEqual(twice.lines[1].deviceIds, [], 'provision point feeds once');
  });

  // ---------------------------------------------------------------
  // normalizeLineAssignments: состав без потери второй линии
  // ---------------------------------------------------------------
  await test('normalize: disjoint keys survive, duplicates and repeats are cleaned', () => {
    const panel = makePanel([
      makeLine('line-a', { deviceIds: ['sw1'], slotMembers: { sw1: [0] } }),
      makeLine('line-b', { deviceIds: ['sw1'], slotMembers: { sw1: [1] } }),
    ]);
    const normalized = normalizeLineAssignments(panel);
    assert.deepEqual(normalized.lines[0].deviceIds, ['sw1']);
    assert.deepEqual(normalized.lines[1].deviceIds, ['sw1']);
    assert.deepEqual(normalized.lines[1].slotMembers, { sw1: [1] });

    const overlap = normalizeLineAssignments(
      makePanel([
        makeLine('line-a', { deviceIds: ['sw1'], slotMembers: { sw1: [0] } }),
        makeLine('line-b', { deviceIds: ['sw1'], slotMembers: { sw1: [0, 1] } }),
      ])
    );
    assert.deepEqual(overlap.lines[1].slotMembers, { sw1: [1] });

    const repeated = normalizeLineAssignments(
      makePanel([
        makeLine('line-a', { deviceIds: ['sw1', 'sw1'], slotMembers: { sw1: [0] } }),
      ])
    );
    assert.deepEqual(repeated.lines[0].deviceIds, ['sw1']);

    const wholeTwice = normalizeLineAssignments(
      makePanel([
        makeLine('line-a', { deviceIds: ['sw1'] }),
        makeLine('line-b', { deviceIds: ['sw1'] }),
      ])
    );
    assert.deepEqual(wholeTwice.lines[1].deviceIds, []);

    const orphan = normalizeLineAssignments(
      makePanel([
        makeLine('line-a', { deviceIds: [], slotMembers: { sw1: [0] } }),
      ])
    );
    assert.equal(orphan.lines[0].slotMembers, undefined);
  });

  // ---------------------------------------------------------------
  // Импорт: валидация границы и загрузка
  // ---------------------------------------------------------------
  await test('import: split switch survives load and old snapshots stay whole', () => {
    const split = baseSnapshot({
      panel: {
        ...createEmptyPanel({
          kind: 'room_edge',
          roomId: 'room-1',
          edgeIndex: 0,
          offsetMm: 1500,
        }),
        lines: [
          makeLine('line-a', {
            deviceIds: ['sw1'],
            slotMembers: { sw1: [0] },
            loadW: 1000,
          }),
          makeLine('line-b', {
            deviceIds: ['sw1'],
            slotMembers: { sw1: [1] },
            loadW: 1000,
          }),
        ],
      },
    });
    assert.ok(isProjectSnapshot(split), 'valid slot structure accepted');
    state().resetProject();
    state().loadProject(split);
    assert.equal(state().panel.lines.length, 2);
    assert.equal(state().panel.lines[0].deviceIds.includes('sw1'), true);
    assert.equal(state().panel.lines[1].deviceIds.includes('sw1'), true);
    assert.deepEqual(state().panel.lines[0].slotMembers, { sw1: [0] });
    assert.deepEqual(state().panel.lines[1].slotMembers, { sw1: [1] });
    assert.equal(state().panel.lines[0].loadW, 1000);
    assert.equal(state().panel.lines[1].loadW, 1000);
    assert.equal(state().frames.length, 1, 'mechanism wrapped into a frame');

    const legacy = baseSnapshot({
      panel: {
        ...createEmptyPanel({
          kind: 'room_edge',
          roomId: 'room-1',
          edgeIndex: 0,
          offsetMm: 1500,
        }),
        lines: [makeLine('line-a', { deviceIds: ['sw1'], loadW: 2000 })],
      },
    });
    assert.ok(isProjectSnapshot(legacy));
    state().resetProject();
    state().loadProject(legacy);
    assert.equal(state().panel.lines[0].slotMembers, undefined, 'old project stays whole');
    assert.equal(state().panel.lines[0].loadW, 2000);
    assert.equal(linesOfDevice(state().panel, state().devices[0])[0].slots.length, 2);
  });

  await test('import: corrupt slot structure is rejected atomically', () => {
    const valid = baseSnapshot({
      panel: {
        ...createEmptyPanel({
          kind: 'room_edge',
          roomId: 'room-1',
          edgeIndex: 0,
          offsetMm: 1500,
        }),
        lines: [makeLine('line-a', { deviceIds: ['sw1'] })],
      },
    });
    state().resetProject();
    state().loadProject(valid);
    const before = {
      rooms: state().rooms.length,
      devices: state().devices.map((item) => item.id),
      lines: state().panel.lines.map((line) => line.deviceIds.slice()),
      load: state().panel.lines.map((line) => line.loadW),
    };

    const negative = structuredClone(valid);
    negative.panel.lines[0].slotMembers = { sw1: [-1] };
    assert.equal(isProjectSnapshot(negative), false, 'negative slot rejected');

    const fractional = structuredClone(valid);
    fractional.panel.lines[0].slotMembers = { sw1: [1.5] };
    assert.equal(isProjectSnapshot(fractional), false, 'fractional slot rejected');

    const notArray = structuredClone(valid);
    notArray.panel.lines[0].slotMembers = { sw1: 0 };
    assert.equal(isProjectSnapshot(notArray), false, 'non-array rejected');

    const emptyKey = structuredClone(valid);
    emptyKey.panel.lines[0].slotMembers = { '  ': [0] };
    assert.equal(isProjectSnapshot(emptyKey), false, 'empty device id rejected');

    state().loadProject(negative);
    assert.deepEqual(
      {
        rooms: state().rooms.length,
        devices: state().devices.map((item) => item.id),
        lines: state().panel.lines.map((line) => line.deviceIds.slice()),
        load: state().panel.lines.map((line) => line.loadW),
      },
      before,
      'state untouched after rejected import'
    );
    assert.match(state().toasts.at(-1)?.message ?? '', /некорректные данные/);
  });

  await test('import: unknown device and out-of-range keys are pruned, not fatal', () => {
    const snapshot = baseSnapshot({
      panel: {
        ...createEmptyPanel({
          kind: 'room_edge',
          roomId: 'room-1',
          edgeIndex: 0,
          offsetMm: 1500,
        }),
        lines: [
          makeLine('line-a', {
            deviceIds: ['sw1', 'ghost'],
            slotMembers: { sw1: [9], ghost: [0] },
          }),
          makeLine('line-b', { deviceIds: ['sw1'], slotMembers: { sw1: [1] } }),
        ],
      },
    });
    assert.ok(isProjectSnapshot(snapshot));
    state().resetProject();
    state().loadProject(snapshot);
    assert.deepEqual(state().panel.lines[0].deviceIds, []);
    assert.equal(state().panel.lines[0].slotMembers, undefined);
    assert.equal(state().panel.lines[0].loadW, 500);
    assert.deepEqual(state().panel.lines[1].deviceIds, ['sw1']);
    assert.deepEqual(state().panel.lines[1].slotMembers, { sw1: [1] });
  });
} finally {
  await server?.close();
}

console.log(`\ndeviceSlots: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Импорт проекта: строгая валидация границы и нормализация электросхемы.
// Запуск: node tests/import.test.mjs
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

// Угловатая комната: тупой угол при (4000, 0), острый при (5200, 1800).
const room = {
  id: 'room-1',
  name: 'Зал',
  type: 'living',
  nodeIds: ['n1', 'n2', 'n3', 'n4', 'n5'],
  vertices: [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 5200, y: 1800 },
    { x: 3200, y: 3200 },
    { x: 0, y: 3000 },
  ],
  color: '#334155',
  wallThicknessMm: 120,
};
const nodes = Object.fromEntries(
  room.vertices.map((vertex, index) => [
    `n${index + 1}`,
    { id: `n${index + 1}`, x: vertex.x, y: vertex.y },
  ])
);
const walls = room.nodeIds.map((nodeId, index) => {
  const next = room.nodeIds[(index + 1) % room.nodeIds.length];
  return {
    id: `w${index + 1}`,
    nodeAId: nodeId,
    nodeBId: next,
    thicknessMm: 120,
    isExterior: true,
    roomIds: ['room-1'],
  };
});
const edgeAnchor = (edgeIndex = 0, offsetMm = 1000) => ({
  kind: 'room_edge',
  roomId: 'room-1',
  edgeIndex,
  offsetMm,
});
const frame = {
  id: 'f1',
  anchor: edgeAnchor(1, 900),
  heightFromFloorMm: 300,
  posts: 2,
  mounting: 'flush',
};
const socket = {
  id: 's1',
  type: 'socket_single',
  name: 'Розетка одинарная 1',
  anchor: edgeAnchor(1, 864.5),
  heightFromFloorMm: 300,
  powerWatts: 2200,
  shared: false,
  frameId: 'f1',
  seatIndex: 0,
};
const lamp = {
  id: 'lamp-1',
  type: 'light_ceiling',
  name: 'Светильник',
  anchor: { kind: 'room_point', roomId: 'room-1', x: 2000, y: 1500 },
  heightFromFloorMm: 2700,
  powerWatts: 60,
  shared: false,
};

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
    devices: [socket, lamp],
    frames: [frame],
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
    applyStrategy,
    createEmptyPanel,
    createLine,
    defaultPanelSupply,
    recalculateSupply,
    sanitizePanel,
  } = await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { prunePanelRefs } = await server.ssrLoadModule(
    '/src/core/electrical/lineAssignment.ts'
  );

  const state = () => useProjectStore.getState();
  const thickness = settings.defaultWallThicknessMm;

  // ---------------------------------------------------------------
  // Импорт снапшота
  // ---------------------------------------------------------------
  await test('import: angled room snapshot is valid and loads as-is', () => {
    const snapshot = baseSnapshot({
      panel: {
        ...createEmptyPanel(edgeAnchor(0, 1500)),
        lines: [createLine('sockets', ['room-1'], 'Зал', 0)],
      },
    });
    assert.ok(isProjectSnapshot(snapshot), 'pentagon room accepted');
    state().resetProject();
    state().loadProject(snapshot);

    assert.equal(state().rooms.length, 1);
    assert.equal(state().rooms[0].vertices.length, 5, 'angles preserved');
    assert.equal(state().panel?.lines.length, 1, 'panel line kept');

    const stored = state().devices.find((device) => device.id === 's1');
    assert.equal(stored.frameId, 'f1', 'frame reference kept');
    assert.equal(stored.seatIndex, 0);
    const storedLamp = state().devices.find((device) => device.id === 'lamp-1');
    assert.equal(storedLamp.frameId, undefined, 'ceiling lamp stays frameless');
  });

  await test('import: legacy snapshot without frames wraps mechanisms', () => {
    const legacy = baseSnapshot({ devices: [socket, lamp] });
    delete legacy.frames;
    legacy.devices = [socket, lamp].map((device) => {
      const copy = { ...device };
      delete copy.frameId;
      delete copy.seatIndex;
      return copy;
    });
    assert.ok(isProjectSnapshot(legacy), 'legacy JSON accepted');
    state().resetProject();
    state().loadProject(legacy);
    assert.equal(state().frames.length, 1, 'one-seat frame created');
    const stored = state().devices.find((device) => device.id === 's1');
    assert.equal(stored.seatIndex, 0);
    assert.equal(
      state().frames.find((candidate) => candidate.id === stored.frameId).posts,
      1
    );
  });

  await test('import: corrupt snapshot is rejected atomically', () => {
    state().resetProject();
    state().loadProject(baseSnapshot());
    const before = {
      rooms: state().rooms.length,
      devices: state().devices.map((device) => device.id).sort(),
      frames: state().frames.length,
    };

    const broken = baseSnapshot();
    broken.rooms = [
      { ...room, vertices: [room.vertices[0], room.vertices[0], ...room.vertices.slice(2)] },
    ];
    assert.equal(isProjectSnapshot(broken), false, 'zero-length edge rejected');
    state().loadProject(broken);
    assert.deepEqual(
      {
        rooms: state().rooms.length,
        devices: state().devices.map((device) => device.id).sort(),
        frames: state().frames.length,
      },
      before,
      'state untouched after rejected import'
    );
    assert.match(state().toasts.at(-1)?.message ?? '', /некорректные данные/);

    const badSeat = baseSnapshot();
    badSeat.devices = [{ ...socket, seatIndex: 9 }];
    assert.equal(isProjectSnapshot(badSeat), false, 'seatIndex 9 rejected');

    const badRef = baseSnapshot();
    badRef.devices = [{ ...socket, anchor: edgeAnchor(0, 500) }];
    badRef.frames = [{ ...frame, anchor: { kind: 'room_edge', roomId: 'missing', edgeIndex: 0, offsetMm: 500 } }];
    state().loadProject(badRef);
    assert.ok(
      state().devices.some((device) => device.id === 's1'),
      'device survives a dropped frame'
    );
  });

  await test('import: seat outside frame wraps into its own frame', () => {
    const snapshot = baseSnapshot();
    snapshot.devices = [{ ...socket, seatIndex: 2 }];
    assert.ok(isProjectSnapshot(snapshot), 'seat 2 passes boundary validation');
    state().resetProject();
    state().loadProject(snapshot);
    const stored = state().devices.find((device) => device.id === 's1');
    assert.notEqual(stored.frameId, 'f1', 'device moved to a new frame');
    assert.equal(stored.seatIndex, 0);
    assert.equal(
      state().frames.find((candidate) => candidate.id === stored.frameId).posts,
      1
    );
  });

  await test('import: negative load line is dropped by sanitize, not by import', () => {
    const snapshot = baseSnapshot({
      panel: {
        ...createEmptyPanel(edgeAnchor(0, 1500)),
        lines: [
          { ...createLine('sockets', ['room-1'], 'Зал', 0), id: 'line-bad', loadW: -5 },
        ],
      },
    });
    assert.ok(isProjectSnapshot(snapshot), 'negative load is sanitizable, not fatal');
    state().resetProject();
    state().loadProject(snapshot);
    assert.equal(state().panel?.lines.length, 0, 'broken line filtered');
  });

  // ---------------------------------------------------------------
  // Электросхема: трёхфазный ввод
  // ---------------------------------------------------------------
  await test('supply: 3-phase sanitize and recalculation give 4-pole devices', () => {
    const panel = {
      ...createEmptyPanel(edgeAnchor(0, 1500)),
      supply: {
        ...defaultPanelSupply(),
        phases: 3,
        inputBreaker: { poles: 1, ratingA: 40, curve: 'C' },
        mainRcd: { poles: 2, ratingA: 40, sensitivityMa: 100, type: 'A', selective: true },
      },
    };
    const sanitized = sanitizePanel(panel, [room], [], thickness);
    assert.equal(sanitized.supply.inputBreaker.poles, 4, 'input breaker is four-pole');
    assert.equal(sanitized.supply.mainRcd.poles, 4, 'main RCD is four-pole');

    const recalculated = recalculateSupply(sanitized.supply);
    assert.equal(recalculated.inputBreaker.poles, 4);
    assert.equal(recalculated.mainRcd.poles, 4);
    assert.equal(recalculated.inputCable.cores, 5, 'three-phase input cable has five cores');

    const single = sanitizePanel(
      { ...panel, supply: { ...panel.supply, phases: 1 } },
      [room],
      [],
      thickness
    );
    assert.equal(single.supply.inputBreaker.poles, 1, 'single-phase keeps user poles');
  });

  // ---------------------------------------------------------------
  // Стратегии защиты и АВДТ
  // ---------------------------------------------------------------
  const bathroom = { id: 'bath-1', type: 'bathroom' };
  const makePanel = () => ({
    ...createEmptyPanel(edgeAnchor(0, 1500)),
    lines: [
      createLine('lighting', ['room-1'], 'Зал', 0),
      createLine('lighting', ['bath-1'], 'Ванная', 1),
      createLine('sockets', ['room-1'], 'Зал', 2),
    ],
  });

  await test('strategy: budget removes line RCDs and the RCBO flag', () => {
    const panel = applyStrategy(makePanel(), 'budget');
    assert.ok(panel.lines.every((line) => line.rcd === null), 'no line RCDs');
    assert.ok(
      panel.lines.every((line) => line.combinedProtection === undefined),
      'no RCBO flags without an RCD'
    );
    assert.equal(panel.supply.mainRcd.sensitivityMa, 30, 'one common 30 mA RCD');
    assert.equal(panel.supply.voltageRelay, false);
    assert.equal(panel.supply.surgeProtection, false);
  });

  await test('strategy: optimal protects wet lighting and skips dry lighting', () => {
    const panel = applyStrategy(makePanel(), 'optimal', [room, bathroom]);
    const dryLight = panel.lines.find(
      (line) => line.purpose === 'lighting' && line.roomIds.includes('room-1')
    );
    const wetLight = panel.lines.find(
      (line) => line.purpose === 'lighting' && line.roomIds.includes('bath-1')
    );
    const sockets = panel.lines.find((line) => line.purpose === 'sockets');
    assert.equal(dryLight.rcd, null, 'dry lighting without RCD');
    assert.equal(dryLight.combinedProtection, undefined);
    assert.equal(wetLight.rcd?.sensitivityMa, 30, 'bathroom lighting gets 30 mA');
    assert.equal(sockets.rcd?.sensitivityMa, 30);
    assert.equal(panel.supply.mainRcd.sensitivityMa, 100);
    assert.equal(panel.supply.mainRcd.selective, true);
  });

  await test('strategy: maximum leaves an RCD on every line', () => {
    const panel = applyStrategy(makePanel(), 'maximum', [room, bathroom]);
    assert.ok(
      panel.lines.every((line) => line.rcd && line.rcd.sensitivityMa === 30),
      'every line is protected'
    );
  });

  // ---------------------------------------------------------------
  // Чистка ссылок после удаления приборов
  // ---------------------------------------------------------------
  await test('prune: deleting devices recomputes load, breaker and RCBO rating', () => {
    const panel = {
      ...createEmptyPanel(edgeAnchor(0, 1500)),
      lines: [
        {
          ...createLine('sockets', ['room-1'], 'Зал', 0),
          id: 'line-1',
          deviceIds: ['d1', 'd2'],
          loadW: 8000,
          cable: { sectionMm2: 2.5, cores: 3 },
          breaker: { poles: 1, ratingA: 20, curve: 'C' },
          rcd: { poles: 2, ratingA: 20, sensitivityMa: 30, type: 'A' },
          combinedProtection: true,
        },
      ],
    };
    const devices = [
      { ...socket, id: 'd1', powerWatts: 3000 },
      { ...socket, id: 'd2', powerWatts: 3000 },
    ];
    const pruned = prunePanelRefs(panel, devices, ['room-1']);
    assert.equal(pruned.lines[0].deviceIds.length, 2, 'nothing removed yet');

    const afterDelete = prunePanelRefs(panel, devices.slice(0, 1), ['room-1']);
    const line = afterDelete.lines[0];
    assert.deepEqual(line.deviceIds, ['d1']);
    assert.equal(line.loadW, 3000, 'load follows the remaining devices');
    assert.equal(line.breaker.ratingA, 16, 'breaker follows the cable and load');
    assert.equal(line.rcd.ratingA, 16, 'RCBO keeps a single rating');

    const empty = prunePanelRefs(panel, [], ['room-1']);
    assert.equal(empty.lines[0].loadW, 2000, 'empty line keeps the preset load');
    assert.deepEqual(empty.lines[0].deviceIds, []);

    const withoutRoom = prunePanelRefs(panel, devices, []);
    assert.deepEqual(withoutRoom.lines[0].roomIds, [], 'missing room refs pruned');
    assert.equal(withoutRoom.lines[0].loadW, 6000, 'load follows the remaining devices');
  });
} finally {
  await server?.close();
}

console.log(`\nimport: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

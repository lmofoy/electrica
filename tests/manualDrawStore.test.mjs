// Сохранение ручной трассы из сессии рисования: одно действие стора,
// очистка устаревших waypoints и откат одним шагом undo.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const LINE_ID = 'test-line';
const ROOM_ID = 'test-room';

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

const settings = {
  defaultWallThicknessMm: 120,
  exteriorWallThicknessMm: 250,
  ceilingHeightMm: 2700,
  floorLevelMm: 0,
  cableMarginPercent: 10,
  defaultRouting: 'ceiling',
  showDimensions: true,
};

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

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  const { buildAutoLayout } = await server.ssrLoadModule('/src/core/geometry/autoLayout.ts');
  const { createEmptyPanel, createLine } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { computeLineRoutes } = await server.ssrLoadModule('/src/core/electrical/routing.ts');
  const { useProjectStore: store } = await server.ssrLoadModule(
    '/src/store/useProjectStore.ts'
  );

  const vertices = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  const room = {
    id: ROOM_ID,
    name: 'Route test',
    type: 'living',
    nodeIds: [],
    vertices,
    holes: [],
    color: '#888888',
    wallThicknessMm: 120,
  };
  const layout = buildAutoLayout([room], [], [], settings.defaultWallThicknessMm);
  const device = {
    id: 'test-socket',
    type: 'socket_single',
    name: 'Розетка',
    anchor: { kind: 'room_edge', roomId: ROOM_ID, edgeIndex: 1, offsetMm: 1800 },
    heightFromFloorMm: 350,
    powerWatts: 2000,
    shared: false,
  };
  const line = {
    ...createLine('sockets', [ROOM_ID], room.name, 0),
    id: LINE_ID,
    deviceIds: [device.id],
    loadW: device.powerWatts,
  };
  const panel = {
    ...createEmptyPanel({
      kind: 'room_edge',
      roomId: ROOM_ID,
      edgeIndex: 3,
      offsetMm: 1200,
    }),
    id: 'test-panel',
    heightFromFloorMm: 1450,
    lines: [line],
  };

  const state = () => store.getState();
  const history = () => store.temporal.getState();
  const currentLine = () => state().panel.lines.find((candidate) => candidate.id === LINE_ID);

  state().loadProject({
    version: 1,
    savedAt: new Date(0).toISOString(),
    boundaryMode: 'auto',
    settings: { ...settings },
    apartment: layout.apartment,
    rooms: [room],
    nodes: layout.nodes,
    walls: layout.walls,
    openings: [],
    freePartitions: [],
    devices: [device],
    panel,
  });
  assert.ok(state().panel);

  const manual = {
    nodes: [
      { x: 0, y: 0 },
      { x: 1500, y: 0 },
      { x: 1500, y: 900 },
    ],
    paths: [[0, 1, 2]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 2, kind: 'device', deviceId: device.id },
    ],
  };

  await test('ручная трасса сохраняется одним шагом undo и очищает waypoints', () => {
    state().addLineWaypoint(LINE_ID, { x: 500, y: 500 });
    state().addLineWaypoint(LINE_ID, { x: 900, y: 500 });
    assert.equal(currentLine().waypoints.length, 2);
    const pastBefore = history().pastStates.length;

    state().setLineManualRoute(LINE_ID, manual);

    assert.deepEqual(currentLine().manualRoute, manual);
    assert.equal(currentLine().waypoints, undefined);
    assert.equal(history().pastStates.length, pastBefore + 1);

    history().undo();
    assert.equal(currentLine().manualRoute, undefined);
    assert.equal(currentLine().waypoints.length, 2);
  });

  await test('сборка трассы берёт пути ручной трассы', () => {
    state().setLineManualRoute(LINE_ID, manual);
    const routes = computeLineRoutes({
      panel: state().panel,
      devices: state().devices,
      rooms: state().rooms,
      partitions: state().freePartitions,
      nodes: state().nodes,
      walls: state().walls,
      settings: state().settings,
    });
    const route = routes.get(LINE_ID);
    assert.ok(route, 'нет трассы линии');
    assert.deepEqual(route.paths, [manual.nodes]);
    assert.equal(route.planLengthMm, 2400);
  });

  await test('очистка ручной трассы перед рисованием откатывается одним шагом', () => {
    const past = history().pastStates.length;
    state().setLineManualRoute(LINE_ID, undefined);
    assert.equal(currentLine().manualRoute, undefined);
    assert.equal(history().pastStates.length, past + 1);
    history().undo();
    assert.deepEqual(currentLine().manualRoute, manual);
  });
} finally {
  await server?.close();
}

console.log(`\nmanualDrawStore: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

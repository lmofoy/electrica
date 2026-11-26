// Этап 3a: клеммы клавиш — геометрия, автотрассы и якоря ручных трасс.
// Запуск: node tests/slotTerminals.test.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOM_ID = 'room-angled';
const LINE_ID = 'line-light';
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
function near(actual, expected, label, eps = 1e-6) {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
}
function span(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function pointNear(actual, expected, label, eps = 1e-6) {
  assert.ok(actual, `${label}: missing point`);
  near(actual.x, expected.x, `${label}.x`, eps);
  near(actual.y, expected.y, `${label}.y`, eps);
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
  ceilingHeightMm: 2800,
  floorLevelMm: -150,
  cableMarginPercent: 17.5,
  defaultRouting: 'ceiling',
  showDimensions: true,
};

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const devicesModule = await server.ssrLoadModule('/src/core/electrical/devices.ts');
  const {
    DEVICE_TERMINAL_LIFT_MM,
    DEVICE_TERMINAL_SPACING_MM,
    deviceLineSlotCount,
    deviceTerminalPoint,
    resolveDevice,
  } = devicesModule;
  const { buildAutoLayout } = await server.ssrLoadModule('/src/core/geometry/autoLayout.ts');
  const { isPointInPolygon } = await server.ssrLoadModule('/src/core/geometry/math.ts');
  const { createEmptyPanel, createLine } = await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { computeLineRoutes, materializeRouteForLine } =
    await server.ssrLoadModule('/src/core/electrical/routing.ts');
  const {
    manualRouteAnchorNode,
    materializeManualRoute,
    moveManualRouteAnchors,
    sanitizeManualRoute,
  } = await server.ssrLoadModule('/src/core/electrical/manualRoute.ts');

  // Трапеция: правый и левый лучи дают и острый, и тупой углы к основанию.
  const vertices = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4600, y: 3000 },
    { x: 400, y: 3000 },
  ];
  const room = {
    id: ROOM_ID,
    name: 'Зал',
    type: 'living',
    nodeIds: [],
    vertices,
    holes: [],
    color: '#334155',
    wallThicknessMm: 120,
  };
  const layout = buildAutoLayout([room], [], [], settings.defaultWallThicknessMm);

  function edgeAnchor(edgeIndex, offsetMm) {
    return { kind: 'room_edge', roomId: ROOM_ID, edgeIndex, offsetMm };
  }

  const panel = {
    ...createEmptyPanel(edgeAnchor(0, 1000)),
    id: 'panel-1',
    heightFromFloorMm: 1600,
    lines: [],
  };

  function makeLine(deviceIds, slotMembers) {
    return {
      ...createLine('lighting', [ROOM_ID], room.name, 0),
      id: LINE_ID,
      deviceIds,
      ...(slotMembers ? { slotMembers } : {}),
    };
  }

  function routeFor(device, slotMembers) {
    const input = {
      panel: { ...panel, lines: [makeLine([device.id], slotMembers)] },
      devices: [device],
      rooms: [room],
      partitions: [],
      nodes: layout.nodes,
      walls: layout.walls,
      settings: { ...settings },
    };
    const result = computeLineRoutes(input).get(LINE_ID);
    assert.ok(result, 'line route must exist');
    return { input, result };
  }

  function lastPoint(paths) {
    const path = paths[paths.length - 1];
    assert.ok(path && path.length > 0, 'route must have a path');
    return path[path.length - 1];
  }

  const switch2 = {
    id: 'sw2',
    type: 'switch_2k',
    name: 'Выключатель 2кл',
    anchor: edgeAnchor(1, 900),
    heightFromFloorMm: 900,
    powerWatts: 0,
    shared: false,
  };

  await test('клеммы 2 клавиш: 26 мм врозь и 120 мм в комнату на наклонной стене', () => {
    const resolved = resolveDevice(switch2, [room], [], settings.defaultWallThicknessMm);
    assert.ok(resolved);
    const pose = resolved.poses[0];
    const count = deviceLineSlotCount(switch2);
    assert.equal(count, 2);
    const first = deviceTerminalPoint(pose, 0, count);
    const second = deviceTerminalPoint(pose, 1, count);
    near(span(first, second), DEVICE_TERMINAL_SPACING_MM, 'terminal spacing');
    const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    near(span(mid, pose.position), DEVICE_TERMINAL_LIFT_MM, 'terminal lift');
    // Острый/тупой углы комнаты: обе клеммы всё равно внутри пола.
    assert.ok(isPointInPolygon(first, room.vertices), 'terminal 1 inside room');
    assert.ok(isPointInPolygon(second, room.vertices), 'terminal 2 inside room');
    // Клеммы лежат на линии, параллельной стене: смещение только вдоль ребра.
    const a = vertices[1];
    const b = vertices[2];
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const along = {
      x: second.x - first.x,
      y: second.y - first.y,
    };
    const cross = Math.abs(edge.x * along.y - edge.y * along.x);
    assert.ok(cross < 1e-6, `terminals must follow the wall, cross=${cross}`);
  });

  await test('частичная линия ведёт трассу к клемме своей клавиши', () => {
    const { input, result } = routeFor(switch2, { [switch2.id]: [1] });
    const resolved = resolveDevice(switch2, [room], [], settings.defaultWallThicknessMm);
    const pose = resolved.poses[0];
    const terminal = deviceTerminalPoint(pose, 1, 2);
    pointNear(lastPoint(result.paths), terminal, 'route end at key 2', 1);
    assert.ok(
      span(lastPoint(result.paths), pose.position) > 50,
      'route must not stay at the symbol center'
    );
    const routes = computeLineRoutes(input);
    assert.ok(routes.has(LINE_ID));
  });

  await test('весь прибор по одной линии заканчивается в центре символа', () => {
    const { result } = routeFor(switch2);
    const resolved = resolveDevice(switch2, [room], [], settings.defaultWallThicknessMm);
    pointNear(lastPoint(result.paths), resolved.poses[0].position, 'whole-device end', 1);
  });

  await test('две клавиши одной линии получают по клемме', () => {
    const switch3 = {
      ...switch2,
      id: 'sw3',
      type: 'switch_3k',
      anchor: edgeAnchor(2, 500),
    };
    const { result } = routeFor(switch3, { [switch3.id]: [0, 2] });
    const resolved = resolveDevice(switch3, [room], [], settings.defaultWallThicknessMm);
    const pose = resolved.poses[0];
    const expected = [0, 2].map((slot) =>
      deviceTerminalPoint(pose, slot, 3)
    );
    for (const terminal of expected) {
      const hit = result.paths.some((path) =>
        span(path[path.length - 1], terminal) <= 1
      );
      assert.ok(hit, `route must reach terminal ${terminal.x},${terminal.y}`);
    }
  });

  await test('materializeRouteForLine сохраняет слоты якорей', () => {
    const input = {
      panel: { ...panel, lines: [makeLine(['sw2'], { sw2: [1] })] },
      devices: [switch2],
      rooms: [room],
      partitions: [],
      nodes: layout.nodes,
      walls: layout.walls,
      settings: { ...settings },
    };
    const route = materializeRouteForLine(input, LINE_ID);
    assert.ok(route, 'materialized route');
    const anchor = route.anchors.find(
      (candidate) => candidate.kind === 'device'
    );
    assert.ok(anchor, 'device anchor exists');
    assert.equal(anchor.deviceId, 'sw2');
    assert.equal(anchor.slot, 1);
    const resolved = resolveDevice(switch2, [room], [], settings.defaultWallThicknessMm);
    const terminal = deviceTerminalPoint(resolved.poses[0], 1, 2);
    pointNear(route.nodes[anchor.nodeIndex], terminal, 'anchor at terminal', 1);
  });

  await test('sanitize сохраняет якоря разных клавиш одного прибора', () => {
    const raw = {
      nodes: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
        { x: 1000, y: 500 },
      ],
      paths: [
        [0, 1, 2],
        [1, 3],
      ],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 2, kind: 'device', deviceId: 'sw2', slot: 0 },
        { nodeIndex: 3, kind: 'device', deviceId: 'sw2', slot: 1 },
        { nodeIndex: 2, kind: 'device', deviceId: 'sw2' },
      ],
    };
    const route = sanitizeManualRoute(raw);
    assert.ok(route, 'route survives sanitize');
    const slotAnchors = route.anchors.filter(
      (anchor) => anchor.kind === 'device' && anchor.slot !== undefined
    );
    assert.equal(slotAnchors.length, 2);
    assert.deepEqual(
      slotAnchors.map((anchor) => anchor.slot).sort(),
      [0, 1]
    );
    assert.ok(
      route.anchors.some(
        (anchor) =>
          anchor.kind === 'device' &&
          anchor.deviceId === 'sw2' &&
          anchor.slot === undefined
      ),
      'whole-device anchor kept'
    );
  });

  await test('перемещение клавиши двигает только её клемму', () => {
    const route = materializeManualRoute(
      [
        [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
        [{ x: 1000, y: 0 }, { x: 1000, y: 500 }],
      ],
      {
        panelPoint: { x: 0, y: 0 },
        devicePoints: [
          { deviceId: 'sw2', point: { x: 2000, y: 0 }, slot: 0 },
          { deviceId: 'sw2', point: { x: 1000, y: 500 }, slot: 1 },
        ],
      }
    );
    assert.ok(route, 'manual route created');
    const before0 = manualRouteAnchorNode(route, 'device', 'sw2', 0);
    const before1 = manualRouteAnchorNode(route, 'device', 'sw2', 1);
    assert.ok(before0 !== null && before1 !== null);
    const result = moveManualRouteAnchors(route, [
      { kind: 'device', deviceId: 'sw2', slot: 1, point: { x: 1100, y: 500 } },
    ]);
    assert.ok(result.ok, result.ok ? '' : result.error);
    const after0 = manualRouteAnchorNode(result.route, 'device', 'sw2', 0);
    const after1 = manualRouteAnchorNode(result.route, 'device', 'sw2', 1);
    assert.ok(after0 !== null && after1 !== null);
    pointNear(result.route.nodes[after0], { x: 2000, y: 0 }, 'key 1 stays', 0.5);
    pointNear(result.route.nodes[after1], { x: 1100, y: 500 }, 'key 2 moves', 0.5);
  });

  await test('перемещение всего прибора не тянет якоря клавиш', () => {
    const route = materializeManualRoute(
      [
        [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
        [{ x: 1000, y: 0 }, { x: 1000, y: 500 }],
      ],
      {
        panelPoint: { x: 0, y: 0 },
        devicePoints: [
          { deviceId: 'sw2', point: { x: 2000, y: 0 } },
          { deviceId: 'sw2', point: { x: 1000, y: 500 }, slot: 1 },
        ],
      }
    );
    assert.ok(route, 'manual route created');
    const result = moveManualRouteAnchors(route, [
      { kind: 'device', deviceId: 'sw2', point: { x: 2100, y: 0 } },
    ]);
    assert.ok(result.ok, result.ok ? '' : result.error);
    const whole = result.route.anchors.find(
      (anchor) =>
        anchor.kind === 'device' &&
        anchor.deviceId === 'sw2' &&
        anchor.slot === undefined
    );
    const slot1 = manualRouteAnchorNode(result.route, 'device', 'sw2', 1);
    assert.ok(whole && slot1 !== null);
    pointNear(result.route.nodes[whole.nodeIndex], { x: 2100, y: 0 }, 'whole anchor moves', 0.5);
    pointNear(result.route.nodes[slot1], { x: 1000, y: 500 }, 'slot anchor stays', 0.5);
  });

  await test('store: переезд прибора переносит якорь клавиши на новую клемму', async () => {
    const { useProjectStore: store } = await server.ssrLoadModule(
      '/src/store/useProjectStore.ts'
    );
    {
      const oldAnchor = edgeAnchor(1, 900);
      const oldResolved = resolveDevice(
        { ...switch2, anchor: oldAnchor },
        [room],
        [],
        settings.defaultWallThicknessMm
      );
      const oldTerminal = deviceTerminalPoint(oldResolved.poses[0], 1, 2);
      const manualRoute = {
        nodes: [
          { x: oldTerminal.x - 500, y: oldTerminal.y },
          { x: oldTerminal.x, y: oldTerminal.y },
        ],
        paths: [[0, 1]],
        anchors: [
          { nodeIndex: 0, kind: 'panel' },
          { nodeIndex: 1, kind: 'device', deviceId: 'sw2', slot: 1 },
        ],
      };
      store.setState({
        settings: { ...settings },
        rooms: [room],
        freePartitions: [],
        devices: [{ ...switch2, anchor: oldAnchor }],
        frames: [],
        selection: null,
        panel: {
          ...panel,
          lines: [
            {
              ...makeLine(['sw2'], { sw2: [1] }),
              manualRoute,
            },
          ],
        },
      });
      const nextAnchor = edgeAnchor(1, 1200);
      const moved = store.getState().moveDevice('sw2', nextAnchor);
      assert.equal(moved, true, 'device move accepted');
      const nextResolved = resolveDevice(
        { ...switch2, anchor: nextAnchor },
        [room],
        [],
        settings.defaultWallThicknessMm
      );
      const expected = deviceTerminalPoint(nextResolved.poses[0], 1, 2);
      const route = store.getState().panel.lines[0].manualRoute;
      assert.ok(route, 'manual route preserved');
      const anchor = route.anchors.find(
        (candidate) => candidate.kind === 'device' && candidate.slot === 1
      );
      assert.ok(anchor, 'slot anchor preserved');
      pointNear(route.nodes[anchor.nodeIndex], expected, 'anchor at new terminal', 1);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await server?.close();
}

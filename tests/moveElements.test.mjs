// Перемещение элементов: якоря ручных трасс, подрозетник (рамка) и прибор.
// Запуск: node tests/moveElements.test.mjs
//
// Якорь трассы возвращается к соседу по прежней оси своего сегмента, поэтому
// первый изгиб ручной трассы стоит над/под СТАРЫМ положением якоря, а вторая
// вершина соединяется с новым положением (см. A2, A6).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const EPS = 1e-6;
const LINE_ID = 'move-line';
const ROOM_ID = 'move-room';
const FRAME_ID = 'move-frame';
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
function near(actual, expected, label, tolerance = EPS) {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`
  );
}
function pointNear(actual, expected, label, tolerance = EPS) {
  assert.ok(actual, `${label}: missing point`);
  near(actual.x, expected.x, `${label}.x`, tolerance);
  near(actual.y, expected.y, `${label}.y`, tolerance);
}
const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clone = (value) => structuredClone(value);
const jsonClone = (value) => JSON.parse(JSON.stringify(value));
const settings = {
  defaultWallThicknessMm: 120, exteriorWallThicknessMm: 250,
  ceilingHeightMm: 2800, floorLevelMm: -150, cableMarginPercent: 17.5,
  defaultRouting: 'ceiling', showDimensions: true,
};

// Реальное хранилище не трогаем: стор планирует таймеры уже при импорте.
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

function assertOrthogonal(route, label) {
  for (const path of route.paths) {
    for (let i = 1; i < path.length; i++) {
      const a = route.nodes[path[i - 1]];
      const b = route.nodes[path[i]];
      assert.ok(
        Math.abs(a.x - b.x) <= 0.5 || Math.abs(a.y - b.y) <= 0.5,
        `${label}: segment ${i} is not orthogonal (${a.x},${a.y})-(${b.x},${b.y})`
      );
    }
  }
}
// Проверяет, что все изломы прямых участков прямые, и возвращает число
// поворотов на 90°. На якорных вершинах угол не проверяется: сосед у самого
// щитка/прибора сдвигать нельзя, поэтому ветка там может развернуться.
function rightAngles(route, label) {
  let count = 0;
  const isAnchor = (index) => route.anchors.some((anchor) => anchor.nodeIndex === index);
  for (const path of route.paths) {
    for (let i = 1; i < path.length; i++) {
      assert.ok(
        span(route.nodes[path[i - 1]], route.nodes[path[i]]) > 0.5,
        `${label}: zero-length segment at ${i}`
      );
    }
    for (let i = 1; i < path.length - 1; i++) {
      const prev = route.nodes[path[i - 1]];
      const node = route.nodes[path[i]];
      const next = route.nodes[path[i + 1]];
      const a = { x: node.x - prev.x, y: node.y - prev.y };
      const b = { x: next.x - node.x, y: next.y - node.y };
      const lengthA = Math.hypot(a.x, a.y);
      const lengthB = Math.hypot(b.x, b.y);
      const unitA = { x: a.x / lengthA, y: a.y / lengthA };
      const unitB = { x: b.x / lengthB, y: b.y / lengthB };
      const dot = unitA.x * unitB.x + unitA.y * unitB.y;
      if (isAnchor(path[i]) || isAnchor(path[i - 1]) || isAnchor(path[i + 1])) continue;
      assert.ok(Math.abs(dot) <= 1e-6, `${label}: turn at ${i} is not a right angle`);
      count += 1;
    }
  }
  return count;
}
function findNode(route, point) {
  return route.nodes.findIndex((candidate) => span(candidate, point) <= 0.5);
}

// Ручная трасса: щиток слева, прибор справа, один прямой участок по оси X.
function straightAnchors() {
  return {
    nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
    paths: [[0, 1, 2]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
    ],
  };
}
// Ветка прибора идёт вверх от низа плана (щиток оставлен слева от неё).
function verticalAnchors() {
  return {
    nodes: [{ x: 2000, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }],
    paths: [[0, 1, 2]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
    ],
  };
}
// Якорь прибора примыкает наклонным участком.
function slantedAnchors() {
  return {
    nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1500, y: 500 }],
    paths: [[0, 1, 2]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
    ],
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
  const {
    isManualRouteOrthogonal,
    manualRouteAnchorNode,
    manualRouteLength,
    materializeManualRoute,
    moveManualRouteAnchors,
    sanitizeManualRoute,
    validateManualRoute,
  } = await server.ssrLoadModule('/src/core/electrical/manualRoute.ts');
  const { materializeRouteForLine } =
    await server.ssrLoadModule('/src/core/electrical/routing.ts');
  const { buildAutoLayout } = await server.ssrLoadModule('/src/core/geometry/autoLayout.ts');
  const { createEmptyPanel, createLine } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { resolveDevice } = await server.ssrLoadModule('/src/core/electrical/devices.ts');
  const {
    framePlateWidthMm,
    frameSeatAnchor,
    FRAME_WALL_MARGIN_MM,
    resolveFramePose,
    sanitizeElectrical,
  } = await server.ssrLoadModule('/src/core/electrical/frames.ts');
  const { useProjectStore: store, getProjectSnapshot, isProjectSnapshot } =
    await server.ssrLoadModule('/src/store/useProjectStore.ts');

  const state = () => store.getState();
  const history = () => store.temporal.getState();
  const line = () => state().panel?.lines.find((candidate) => candidate.id === LINE_ID);
  const deviceById = (id) => state().devices.find((candidate) => candidate.id === id);
  const mechanisms = () => state().devices.filter((device) => device.frameId === FRAME_ID);
  const historySize = () => [history().pastStates.length, history().futureStates.length];
  const lastToast = () => state().toasts.at(-1);
  const thickness = settings.defaultWallThicknessMm;

  // Косая комната: острый и тупой углы, левая стена (грань 3) под наклоном.
  // Вершины: 0 (0,0), 1 (5000,0), 2 (4400,3000), 3 (440,3000): трапеция с
  // наклонными боковыми гранями; верхняя стена (грань 1) остаётся прямой.
  const rectVertices = [
    { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 4400, y: 3000 }, { x: 440, y: 3000 },
  ];
  const edgeLength = (vertices, edge) => span(vertices[edge], vertices[(edge + 1) % 4]);
  const seatDevice = (seatIndex) => ({
    id: `seat-${seatIndex}`,
    type: seatIndex === 1 ? 'switch_1k' : 'socket_single',
    name: `Механизм ${seatIndex}`,
    anchor: { kind: 'room_edge', roomId: ROOM_ID, edgeIndex: 3, offsetMm: 0 },
    heightFromFloorMm: 900,
    powerWatts: 1800,
    shared: false,
    frameId: FRAME_ID,
    seatIndex,
  });
  const lamp = {
    id: 'lamp-1',
    type: 'light_ceiling',
    name: 'Светильник',
    anchor: { kind: 'room_point', roomId: ROOM_ID, x: 3000, y: 1300 },
    heightFromFloorMm: 2800,
    powerWatts: 80,
    shared: false,
  };

  function fixture({
    frameEdge = 3,
    frameOffsetMm = 600,
    skew = 400,
    seatIndexes = [0, 1],
    panelEdge = 0,
    panelFraction = 0.3,
  } = {}) {
    const vertices = rectVertices.map((point) => ({ ...point }));
    vertices[2].x -= skew;
    vertices[3].x += skew;
    const room = {
      id: ROOM_ID, name: 'Move test', type: 'living', nodeIds: [],
      vertices, holes: [], color: '#888888', wallThicknessMm: 120,
    };
    const frame = {
      id: FRAME_ID,
      anchor: { kind: 'room_edge', roomId: ROOM_ID, edgeIndex: frameEdge, offsetMm: frameOffsetMm },
      heightFromFloorMm: 900,
      posts: 3,
      mounting: 'flush',
    };
    const devices = seatIndexes.map((seat) => ({
      ...seatDevice(seat),
      anchor: frameSeatAnchor(frame, seat),
    }));
    const panelAnchor = {
      kind: 'room_edge', roomId: ROOM_ID, edgeIndex: panelEdge,
      offsetMm: edgeLength(vertices, panelEdge) * panelFraction,
    };
    const lineModel = {
      ...createLine('sockets', [ROOM_ID], room.name, 0),
      id: LINE_ID,
      deviceIds: [...devices.map((device) => device.id), lamp.id],
      loadW: devices.reduce((sum, device) => sum + device.powerWatts, 0) + lamp.powerWatts,
    };
    const panel = {
      ...createEmptyPanel(panelAnchor),
      id: 'move-panel',
      heightFromFloorMm: 1500,
      lines: [lineModel],
    };
    const layout = buildAutoLayout([room], [], [], thickness);
    return {
      room,
      vertices,
      frame,
      devices,
      panel,
      nodes: layout.nodes,
      walls: layout.walls,
      probe: frameProbe(frame),
    };
  }

  // Рамка на одном месте: строится из привязки без вызова стора.
  function frameProbe(frame) {
    const s = state();
    return resolveFramePose(frame, s.rooms, s.freePartitions, thickness);
  }
  function poseOf(device) {
    const s = state();
    const resolved = resolveDevice(device, s.rooms, s.freePartitions, s.settings.defaultWallThicknessMm);
    assert.ok(resolved, `device ${device.id} resolves`);
    return resolved.poses[0].position;
  }

  function snapshot(f, patch = {}) {
    return {
      version: 1, savedAt: new Date(0).toISOString(), boundaryMode: 'auto',
      settings: clone(settings), apartment: buildAutoLayout([f.room], [], [], thickness).apartment,
      rooms: clone([f.room]), nodes: clone(f.nodes), walls: clone(f.walls),
      openings: [], freePartitions: [],
      devices: clone([...f.devices, lamp]),
      frames: clone([f.frame]),
      panel: clone(f.panel),
      ...patch,
    };
  }
  function loadFresh(f) {
    state().loadProject(snapshot(f));
    assert.ok(state().panel, 'panel kept');
    assert.equal(state().frames.length, 1, 'frame kept');
    assert.equal(state().devices.length, f.devices.length + 1, 'all devices kept');
    assert.equal(state().rooms.length, 1, 'room kept');
    assert.deepEqual(historySize(), [0, 0]);
  }
  function routeInput() {
    const s = state();
    return {
      panel: s.panel, devices: s.devices, rooms: s.rooms,
      partitions: s.freePartitions, nodes: s.nodes, walls: s.walls, settings: s.settings,
    };
  }
  // Трасса ручного режима строится заново из опорных точек: автотрасса косой
  // комнаты содержит наклонные сегменты, которых ручной редактор не допускает.
  // Геометрия: от щитка вниз на 80 мм, общая горизонталь, от неё вниз/вверх
  // «колено» по X прибора и подъём до прибора — только прямые углы.
  function orthogonalManualRoute(f) {
    const panelPoint = resolvePose(state().panel);
    const devicePoints = f.devices.map((device) => resolvePose(device));
    const panelBack = { x: panelPoint.x, y: panelPoint.y + 80 };
    assert.ok(
      Math.abs(panelBack.y - devicePoints[0].y) > 200,
      'manual route keeps a hidden corner between panel and devices'
    );
    const feeders = [];
    const paths = [[panelPoint, panelBack]];
    f.devices.forEach((device, index) => {
      const point = devicePoints[index];
      feeders.push({ x: point.x, y: panelBack.y });
      const knee = { x: point.x, y: point.y >= panelBack.y ? panelBack.y + 400 : panelBack.y - 400 };
      // Ветка идёт по общей горизонтали только до своего прибора, иначе
      // обратный ход к колену вышел бы диагональным.
      const lanes = feeders
        .filter((entry) => entry.x <= point.x)
        .sort((a, b) => a.x - b.x);
      paths.push([panelBack, ...lanes, knee, point]);
    });
    const route = materializeManualRoute(paths, {
      panelPoint,
      devicePoints: f.devices.map((device, index) => ({
        deviceId: device.id,
        point: devicePoints[index],
      })),
    });
    assert.ok(route, 'manual variant materializes');
    assert.equal(validateManualRoute(route), null, 'manual variant validates');
    assert.equal(isManualRouteOrthogonal(route), true, 'manual variant is orthogonal');
    assert.equal(manualRouteAnchorNode(route, 'panel'), 0, 'panel anchor kept');
    for (const device of f.devices) {
      assert.ok(
        manualRouteAnchorNode(route, 'device', device.id) !== null,
        `${device.id} keeps its anchor`
      );
    }
    assert.ok(route.nodes.length > 2 * f.devices.length, 'route keeps hidden corners');
    return route;
  }

  function resolvePose(anchorOwner) {
    const s = state();
    if (anchorOwner.lines) {
      return resolveFramePose(anchorOwner, s.rooms, s.freePartitions, thickness).position;
    }
    const resolved = resolveDevice(
      anchorOwner, s.rooms, s.freePartitions, s.settings.defaultWallThicknessMm
    );
    assert.ok(resolved, `device ${anchorOwner.id} resolves`);
    return resolved.poses[0].position;
  }
  await test('A1 anchors: device slides along the same axis, other vertices stay', () => {
    const result = moveManualRouteAnchors(verticalAnchors(), [
      { kind: 'device', deviceId: 'device-a', point: { x: 1000, y: 1400 } },
    ]);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    const anchorNode = manualRouteAnchorNode(moved, 'device', 'device-a');
    assert.ok(anchorNode !== null, 'device anchor kept');
    pointNear(moved.nodes[anchorNode], { x: 1000, y: 1400 }, 'device anchor moved');
    // Угол полки ложится на ось якоря — сосед якоря остаётся на прямой.
    assert.ok(findNode(moved, { x: 1000, y: 0 }) >= 0, 'corner vertex untouched');
    assert.ok(findNode(moved, { x: 2000, y: 0 }) >= 0, 'panel-side vertex untouched');
    assert.equal(manualRouteAnchorNode(moved, 'panel'), 0, 'panel anchor index kept');
    assert.equal(moved.nodes.length, 3, 'no extra vertex on the same axis');
    assert.equal((moved.bendNodes ?? []).length, 0, 'no hidden bends needed');
    near(manualRouteLength(moved), 2400, 'length follows the moved anchor');
    assert.equal(validateManualRoute(moved), null);
    assert.equal(isManualRouteOrthogonal(moved), true);

    // Обратно по той же оси: вершина возвращается без остатков.
    const back = moveManualRouteAnchors(moved, [
      { kind: 'device', deviceId: 'device-a', point: { x: 1000, y: 1000 } },
    ]);
    assert.equal(back.ok, true, back.ok ? '' : back.error);
    assert.equal(back.route.nodes.length, 3);
    near(manualRouteLength(back.route), 2000, 'back on the original span');
    assertOrthogonal(back.route, 'returned along the axis');
  });

  await test('A2 anchors: diagonal move inserts a hidden 90° bend, angles stay right', () => {
    const result = moveManualRouteAnchors(straightAnchors(), [
      { kind: 'device', deviceId: 'device-a', point: { x: 2000, y: 600 } },
    ]);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    const anchorNode = manualRouteAnchorNode(moved, 'device', 'device-a');
    pointNear(moved.nodes[anchorNode], { x: 2000, y: 600 }, 'device anchor');
    const bends = new Set(moved.bendNodes ?? []);
    assert.equal(bends.size, 1, 'exactly one hidden bend');
    const bendPoint = moved.nodes[[...bends][0]];
    pointNear(bendPoint, { x: 1000, y: 600 }, 'elbow under the neighbour vertex');
    assert.ok(findNode(moved, { x: 0, y: 0 }) >= 0, 'panel untouched');
    assert.ok(findNode(moved, { x: 1000, y: 0 }) >= 0, 'mid vertex untouched');
    assert.equal(moved.nodes.length, 4, 'three real points plus one elbow');
    assert.equal(moved.nodes.length - bends.size, 3, 'no new editable points');
    assertOrthogonal(moved, 'diagonal anchor move');
    // Ветка идёт вниз к скрытому изгибу и обратно вправо к прибору; оба
    // соседа якоря — якорная вершина и изгиб, поэтому сам поворот у изгиба
    // считается прямым, а у щитка ветка разворачивается.
    assert.equal(rightAngles(moved, 'diagonal anchor move'), 0, 'single run to the elbow');
    near(manualRouteLength(moved), 2600, 'elbow adds the offset to the planar length');
    assert.equal(validateManualRoute(moved), null);

    // Повторный перенос заменяет изгиб, а не копит точки.
    const again = moveManualRouteAnchors(moved, [
      { kind: 'device', deviceId: 'device-a', point: { x: 2400, y: 900 } },
    ]);
    assert.equal(again.ok, true, again.ok ? '' : again.error);
    const repeat = again.route;
    pointNear(
      repeat.nodes[manualRouteAnchorNode(repeat, 'device', 'device-a')],
      { x: 2400, y: 900 },
      'anchor after the second move'
    );
    assert.equal((repeat.bendNodes ?? []).length, 1, 'one fresh elbow instead of a staircase');
    assert.equal(repeat.nodes.length - repeat.bendNodes.length, 3, 'still three real points');
    assertOrthogonal(repeat, 'repeated anchor move');
    rightAngles(repeat, 'repeated anchor move');
    assert.equal(validateManualRoute(repeat), null);
  });

  await test('A3 anchors: batch of two devices (one socket frame) moves in a single call', () => {
    const route = {
      nodes: [
        { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }, { x: 3000, y: 0 },
      ],
      // Общая магистраль 0-1, дальше приборный участок 1-2 и продолжение 2-3.
      paths: [[0, 1, 2], [1, 2, 3]],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
        { nodeIndex: 3, kind: 'device', deviceId: 'device-b' },
      ],
    };
    const result = moveManualRouteAnchors(route, [
      { kind: 'device', deviceId: 'device-a', point: { x: 2000, y: 400 } },
      { kind: 'device', deviceId: 'device-b', point: { x: 3000, y: 400 } },
    ]);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    for (const [id, point] of [
      ['device-a', { x: 2000, y: 400 }],
      ['device-b', { x: 3000, y: 400 }],
    ]) {
      const index = manualRouteAnchorNode(moved, 'device', id);
      assert.ok(index !== null, `${id} anchor kept`);
      pointNear(moved.nodes[index], point, `${id} anchor moved`);
    }
    assert.equal(manualRouteAnchorNode(moved, 'panel'), 0, 'panel anchor kept');
    assert.ok(findNode(moved, { x: 0, y: 0 }) >= 0, 'panel vertex stays');
    assert.ok(findNode(moved, { x: 1000, y: 0 }) >= 0, 'junction vertex stays');
    assert.equal(moved.paths.length, 2, 'both branches survive');
    assert.equal(
      (moved.bendNodes ?? []).length > 0,
      true,
      'the reconnected branch uses a hidden elbow'
    );
    assertOrthogonal(moved, 'batch move');
    assert.equal(validateManualRoute(moved), null);

    // Два якоря в одной точке недопустимы.
    const collide = moveManualRouteAnchors(route, [
      { kind: 'device', deviceId: 'device-a', point: { x: 2000, y: 400 } },
      { kind: 'device', deviceId: 'device-b', point: { x: 2000, y: 400 } },
    ]);
    assert.equal(collide.ok, false);
    assert.match(collide.error, /одной точке/);
  });

  await test('A4 anchors: slanted incident segment is refused', () => {
    const result = moveManualRouteAnchors(slantedAnchors(), [
      { kind: 'device', deviceId: 'device-a', point: { x: 1700, y: 700 } },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error, /Наклонный/);
  });

  await test('A5 anchors: target coinciding with a foreign vertex is refused', () => {
    const ownNeighbour = moveManualRouteAnchors(straightAnchors(), [
      { kind: 'device', deviceId: 'device-a', point: { x: 1000, y: 0 } },
    ]);
    assert.equal(ownNeighbour.ok, false);
    assert.match(ownNeighbour.error, /совпал/);

    const foreign = moveManualRouteAnchors(straightAnchors(), [
      { kind: 'device', deviceId: 'device-a', point: { x: 0, y: 0 } },
    ]);
    assert.equal(foreign.ok, false, 'panel vertex is someone else’s point');
    assert.match(foreign.error, /совпал/);

    const unknownDevice = moveManualRouteAnchors(straightAnchors(), [
      { kind: 'device', deviceId: 'ghost', point: { x: 500, y: 500 } },
    ]);
    assert.equal(unknownDevice.ok, true, 'unknown device is ignored');
    assert.deepEqual(unknownDevice.route.nodes, straightAnchors().nodes, 'route untouched');

    const badPoint = moveManualRouteAnchors(straightAnchors(), [
      { kind: 'device', deviceId: 'device-a', point: { x: Number.NaN, y: 10 } },
    ]);
    assert.equal(badPoint.ok, false);
    assert.match(badPoint.error, /координата/);
  });

  await test('A6 anchors: panel anchor moves and reroutes the first span', () => {
    const result = moveManualRouteAnchors(verticalAnchors(), [
      { kind: 'panel', point: { x: 2000, y: 300 } },
    ]);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    const panelNode = manualRouteAnchorNode(moved, 'panel');
    pointNear(moved.nodes[panelNode], { x: 2000, y: 300 }, 'panel anchor');
    assert.ok(manualRouteAnchorNode(moved, 'device', 'device-a') !== null, 'device kept');
    assert.ok(findNode(moved, { x: 1000, y: 0 }) >= 0, 'corner vertex untouched');
    assert.ok(findNode(moved, { x: 1000, y: 1000 }) >= 0, 'device vertex untouched');
    assert.equal(findNode(moved, { x: 2000, y: 0 }), -1, 'old panel point is gone');
    assert.equal((moved.bendNodes ?? []).length, 1, 'one hidden elbow for the panel span');
    assert.ok(findNode(moved, { x: 1000, y: 300 }) >= 0, 'elbow stays on the corner axis');
    assertOrthogonal(moved, 'panel anchor move');
    assert.equal(rightAngles(moved, 'panel anchor move'), 0, 'the span has no bends');
    assert.equal(validateManualRoute(moved), null);

    const empty = moveManualRouteAnchors(straightAnchors(), []);
    assert.equal(empty.ok, true, 'empty batch is valid');
    assert.deepEqual(
      sanitizeManualRoute(empty.route),
      sanitizeManualRoute(straightAnchors()),
      'empty batch keeps the route'
    );
  });

  // ---------------------------------------------------------------
  // B. Стор: подрозетник на косой стене
  // ---------------------------------------------------------------
  await test('B1 store: socket frame with two mechanisms slides along the oblique wall', () => {
    const f = fixture({ frameEdge: 3, frameOffsetMm: 600, skew: 400, seatIndexes: [0, 2] });
    const oblique = { x: f.vertices[3].x - f.vertices[0].x, y: f.vertices[3].y - f.vertices[0].y };
    assert.ok(Math.abs(oblique.x) > 100 && Math.abs(oblique.y) > 100, 'edge 3 is really oblique');
    loadFresh(f);
    const delta = 250;
    const target = { ...state().frames[0].anchor, offsetMm: 600 + delta };
    assert.ok(target.offsetMm < edgeLength(f.vertices, 3), 'new seat is still on the wall');

    const frameBefore = clone(state().frames[0]);
    const devicesBefore = clone(mechanisms());
    const pointsBefore = devicesBefore.map((device) => poseOf(device));
    const lineBefore = clone(line());
    const panelBefore = clone(state().panel.anchor);

    assert.equal(state().moveFrame(FRAME_ID, target), true);
    assert.equal(history().pastStates.length, 1, 'one undo step for the whole frame');

    const frame = state().frames[0];
    assert.equal(frame.anchor.offsetMm, target.offsetMm, 'frame offset moved along the wall');
    assert.equal(frame.anchor.edgeIndex, 3, 'same oblique wall');
    assert.equal(frame.heightFromFloorMm, frameBefore.heightFromFloorMm, 'height kept');
    assert.equal(frame.posts, frameBefore.posts, 'posts kept');
    const moved = mechanisms();
    assert.equal(moved.length, devicesBefore.length, 'both mechanisms moved');
    for (const before of devicesBefore) {
      const after = moved.find((device) => device.id === before.id);
      assert.ok(after, `${before.id} still exists`);
      assert.equal(after.seatIndex, before.seatIndex, 'seatIndex kept');
      assert.equal(after.powerWatts, before.powerWatts, 'powerWatts kept');
      assert.equal(after.type, before.type, 'type kept');
      assert.equal(after.note, before.note, 'note kept');
      assert.equal(after.heightFromFloorMm, frame.heightFromFloorMm, 'height follows the frame');
      assert.deepEqual(
        after.anchor,
        frameSeatAnchor(frame, before.seatIndex),
        'mechanism sits on its seat'
      );
      assert.equal(
        after.anchor.offsetMm - before.anchor.offsetMm,
        delta,
        'every mechanism received the same delta'
      );
      const previous = pointsBefore[devicesBefore.indexOf(before)];
      const point = poseOf(after);
      near(span(point, previous), delta, `${before.id} physically slid by the delta`, 0.01);
      // Косая стена: смещение идёт по направлению грани 3, а не вдоль осей.
      const a = f.vertices[3];
      const b = f.vertices[0];
      const length = span(a, b);
      const along = ((point.x - previous.x) * (b.x - a.x) + (point.y - previous.y) * (b.y - a.y)) / length;
      near(along, delta, `${before.id} slid along the oblique wall`, 0.01);
    }
    // Порядок и содержимое линии сохраняются.
    assert.deepEqual(line().deviceIds, lineBefore.deviceIds, 'line composition untouched');
    assert.equal(line().name, lineBefore.name, 'line name kept');
    assert.equal(line().loadW, lineBefore.loadW, 'line load kept');
    assert.deepEqual(state().panel.anchor, panelBefore, 'panel untouched');
    assert.deepEqual(
      state().devices.filter((device) => !device.frameId).map((device) => device.id),
      [lamp.id],
      'frameless device untouched'
    );
  });

  await test('B2 store: frame jumps to the opposite wall, notes and seats survive', () => {
    const f = fixture({ frameEdge: 3, frameOffsetMm: 600, skew: 400, seatIndexes: [0, 1] });
    loadFresh(f);
    state().setFrameHeight(FRAME_ID, 900);
    const before = clone(mechanisms());
    const toTop = { kind: 'room_edge', roomId: ROOM_ID, edgeIndex: 1, offsetMm: 1500 };
    const expectedOffset = 1500; // плата 3 места: 224 мм, запас 30 мм — на 4860 мм помещается

    assert.equal(state().moveFrame(FRAME_ID, toTop), true);
    const frame = state().frames[0];
    assert.equal(frame.anchor.edgeIndex, 1, 'frame left the oblique wall');
    assert.equal(frame.anchor.offsetMm, expectedOffset, 'offset kept away from the wall ends');
    assert.equal(frame.anchor.roomId, ROOM_ID, 'same room');
    const topLength = edgeLength(f.vertices, 1);
    assert.ok(
      expectedOffset - framePlateWidthMm(3) / 2 - FRAME_WALL_MARGIN_MM >= 0,
      'plate fits the wall with its margin'
    );
    assert.ok(expectedOffset + framePlateWidthMm(3) / 2 <= topLength, 'plate stays on the wall');
    for (const device of mechanisms()) {
      const previous = before.find((candidate) => candidate.id === device.id);
      assert.deepEqual(device.anchor, frameSeatAnchor(frame, device.seatIndex));
      assert.equal(device.anchor.edgeIndex, 1, 'mechanism on the new wall');
      assert.equal(device.seatIndex, previous.seatIndex);
      assert.equal(device.heightFromFloorMm, 900);
      assert.equal(device.note, previous.note, 'note kept');
      // Высота механизма — высота рамки, даже если раньше значения расходились.
      state().setFrameHeight(FRAME_ID, 1200);
      assert.equal(deviceById(device.id).heightFromFloorMm, 1200, 'height follows the frame');
    }
    assert.deepEqual(
      state().panel.lines[0].deviceIds.length,
      f.panel.lines[0].deviceIds.length,
      'line untouched'
    );
  });

  // ---------------------------------------------------------------
  // B. Стор: одиночный прибор и запрет на механизм
  // ---------------------------------------------------------------
  await test('B3 store: frameless ceiling lamp moves through moveDevice', () => {
    const f = fixture({ seatIndexes: [0] });
    loadFresh(f);
    const lampBefore = clone(deviceById('lamp-1'));
    assert.equal(lampBefore.frameId, undefined, 'lamp is frameless');
    assert.equal(
      state().moveDevice('lamp-1', { kind: 'room_point', roomId: ROOM_ID, x: 2200, y: 2400 }),
      true
    );
    const lampAfter = deviceById('lamp-1');
    assert.deepEqual(lampAfter.anchor, {
      kind: 'room_point', roomId: ROOM_ID, x: 2200, y: 2400,
    });
    assert.equal(lampAfter.heightFromFloorMm, lampBefore.heightFromFloorMm);
    assert.equal(lampAfter.powerWatts, lampBefore.powerWatts);
    assert.equal(lampAfter.type, lampBefore.type);
    assert.notDeepEqual(lampAfter.anchor, lampBefore.anchor, 'position really changed');
    assert.deepEqual(state().frames, [f.frame], 'frames untouched');
    assert.equal(history().pastStates.length, 1, 'one undo step');
    history().undo();
    assert.deepEqual(deviceById('lamp-1').anchor, lampBefore.anchor, 'undo returns the lamp');
  });

  await test('B4 store: a mechanism cannot be moved through moveDevice', () => {
    const f = fixture({ seatIndexes: [0, 1] });
    loadFresh(f);
    const before = clone(state().devices);
    const counts = historySize();
    const target = { kind: 'room_edge', roomId: ROOM_ID, edgeIndex: 1, offsetMm: 1000 };
    assert.equal(state().moveDevice('seat-0', target), false);
    assert.deepEqual(state().devices, before, 'mechanism stays put');
    assert.deepEqual(
      mechanisms().map((device) => clone(device)),
      before.filter((device) => device.frameId === FRAME_ID),
      'whole frame untouched'
    );
    assert.deepEqual(historySize(), counts, 'refusal leaves no undo step');
    assert.match(lastToast()?.message ?? '', /подрозетник/i);
    assert.equal(lastToast()?.type, 'info');
    assert.equal(state().moveDevice('ghost-device', target), false, 'unknown device');
    assert.deepEqual(historySize(), counts);
  });

  // ---------------------------------------------------------------
  // B. Стор: undo, отказ, перезагрузка, трассы
  // ---------------------------------------------------------------
  await test('B5 store: one undo restores frame, mechanisms and the manual route', () => {
    const f = fixture({ frameEdge: 3, frameOffsetMm: 600, skew: 400, seatIndexes: [0, 2] });
    loadFresh(f);
    const base = orthogonalManualRoute(f);
    line().manualRoute = clone(base);
    const manualBefore = jsonClone(base);
    const frameBefore = clone(state().frames[0]);
    const devicesBefore = clone(mechanisms());
    const counts = historySize();

    const toTop = { kind: 'room_edge', roomId: ROOM_ID, edgeIndex: 1, offsetMm: 2200 };
    assert.equal(state().moveFrame(FRAME_ID, toTop), true);
    assert.equal(history().pastStates.length, counts[0] + 1, 'single undo step');
    // Автотрасса косой комнаты содержит наклонные сегменты, поэтому
    // переподключение отвергается целиком; решение фиксирует B8b, а здесь
    // важно, что всё это — одна ступень undo.
    assert.equal(validateManualRoute(line().manualRoute), null);

    history().undo();
    assert.deepEqual(state().frames[0], frameBefore, 'frame restored');
    assert.deepEqual(mechanisms(), devicesBefore, 'mechanisms restored');
    assert.deepEqual(jsonClone(line().manualRoute), manualBefore, 'manual route restored');
    assert.equal(manualBefore.nodes.length > 0, true);

    history().redo();
    assert.equal(state().frames[0].anchor.edgeIndex, 1, 'redo moves the plate again');
    for (const device of mechanisms()) {
      assert.deepEqual(device.anchor, frameSeatAnchor(state().frames[0], device.seatIndex));
    }
    if (jsonClone(line().manualRoute) !== null) {
      assert.equal(validateManualRoute(line().manualRoute), null, 'redo keeps a valid route');
    }
  });

  await test('B6 store: unknown frame is refused without a new undo step', () => {
    const f = fixture({ seatIndexes: [0] });
    loadFresh(f);
    state().setFrameHeight(FRAME_ID, 1200);
    const counts = historySize();
    const devicesBefore = clone(state().devices);
    const frameBefore = clone(state().frames[0]);

    assert.equal(state().moveFrame('ghost-frame', frameBefore.anchor), false);
    assert.equal(state().moveFrame(FRAME_ID, frameBefore.anchor), true, 'same anchor is a no-op');
    assert.deepEqual(state().frames[0], frameBefore, 'frame unchanged');
    assert.deepEqual(state().devices, devicesBefore, 'mechanisms unchanged');
    assert.deepEqual(historySize(), counts, 'no new undo step');

    history().undo();
    assert.equal(state().frames[0].heightFromFloorMm, 900, 'undo rolls back the last valid step');
    assert.equal(history().pastStates.length, 0);
  });

  await test('B6b store: frame that cannot resolve is refused without history', () => {
    // Перегородка известна только на плане: рамку на неё не перенести.
    const f = fixture({ seatIndexes: [0] });
    loadFresh(f);
    const counts = historySize();
    const devicesBefore = clone(state().devices);
    const frameBefore = clone(state().frames[0]);
    const rejected = [
      { kind: 'room_edge', roomId: 'ghost-room', edgeIndex: 0, offsetMm: 500 },
      { kind: 'partition', partitionId: 'ghost-partition', offsetMm: 500, side: 1 },
    ];
    for (const anchor of rejected) {
      assert.equal(state().moveFrame(FRAME_ID, anchor), false);
    }
    assert.deepEqual(state().frames[0], frameBefore, 'frame unchanged');
    assert.deepEqual(state().devices, devicesBefore, 'mechanisms unchanged');
    assert.deepEqual(historySize(), counts, 'no new undo step');
    assert.match(lastToast()?.message ?? '', /подрозетник/i);
  });

  await test('B6c store: out-of-room targets are reachable (edges are clamped and wrapped)', () => {
    // Регрессия (см. отчёт о дефекте): clampFrameOffset и wallLength
    // нормализуют edgeIndex по модулю числа граней, а resolveFramePose —
    // тоже. Значит привязка edgeIndex 9 на комнате из четырёх граней попадает
    // на грань 1, и плата обязана остаться на этой стене целиком.
    const f = fixture({ frameEdge: 3, frameOffsetMm: 300, skew: 400, seatIndexes: [0] });
    loadFresh(f);
    const result = state().moveFrame(FRAME_ID, {
      kind: 'room_edge', roomId: ROOM_ID, edgeIndex: 9, offsetMm: 500,
    });
    const frame = state().frames[0];
    if (!result) {
      assert.deepEqual(frame, f.frame, 'refused move changes nothing');
      return;
    }
    const wallLength = edgeLength(f.vertices, 1);
    assert.ok(
      Math.abs(frame.anchor.edgeIndex % 4) === 1 || frame.anchor.edgeIndex === 1,
      `edgeIndex must normalise to edge 1, got ${frame.anchor.edgeIndex}`
    );
    assert.ok(
      frame.anchor.offsetMm >= 0 && frame.anchor.offsetMm <= wallLength,
      `plate centre stays on the wall, got ${frame.anchor.offsetMm}`
    );
    // Рамка у самого края: центр не должен вылезти за конец стены.
    const edgeTarget = state().moveFrame(FRAME_ID, {
      kind: 'room_edge', roomId: ROOM_ID, edgeIndex: 1, offsetMm: 10,
    });
    assert.equal(edgeTarget, true, 'edge target is accepted');
    const edgeFrame = state().frames[0];
    const margin = framePlateWidthMm(3) / 2;
    assert.ok(
      edgeFrame.anchor.offsetMm >= margin,
      `plate must not hang off the wall start, got ${edgeFrame.anchor.offsetMm}`
    );
    assert.ok(
      edgeFrame.anchor.offsetMm + margin <= wallLength + 1e-6,
      `plate must not hang off the wall end, got ${edgeFrame.anchor.offsetMm}`
    );
    void FRAME_WALL_MARGIN_MM;
  });

  await test('B7 store: snapshot round-trip keeps the moved frame and its mechanisms', () => {
    const f = fixture({ frameEdge: 3, frameOffsetMm: 600, skew: 400, seatIndexes: [0, 2] });
    loadFresh(f);
    const toTop = { kind: 'room_edge', roomId: ROOM_ID, edgeIndex: 1, offsetMm: 2500 };
    assert.equal(state().moveFrame(FRAME_ID, toTop), true);
    deviceById('seat-0').note = undefined;
    state().devices = state().devices.map((device) =>
      device.id === 'seat-0' ? { ...device, note: 'Стиральная машина' } : device
    );
    const frameAfter = clone(state().frames[0]);
    const devicesAfter = clone(mechanisms());

    const exported = jsonClone(getProjectSnapshot());
    assert.equal(isProjectSnapshot(exported), true, 'snapshot validates');
    assert.deepEqual(exported.frames[0], frameAfter, 'snapshot holds the moved frame');

    const sanitized = sanitizeElectrical(
      exported.devices, exported.frames, exported.rooms, exported.freePartitions, thickness
    );
    assert.equal(sanitized.frames.length, 1, 'frame survives sanitizeElectrical');
    assert.deepEqual(sanitized.frames[0], frameAfter, 'frame stays where it was moved');
    assert.equal(sanitized.devices.length, state().devices.length, 'no device is lost');
    for (const device of sanitized.devices.filter((item) => item.frameId === FRAME_ID)) {
      const expected = devicesAfter.find((item) => item.id === device.id);
      assert.ok(expected, `${device.id} sanitized`);
      assert.deepEqual(device.anchor, frameSeatAnchor(frameAfter, expected.seatIndex));
      assert.equal(device.seatIndex, expected.seatIndex, 'seatIndex kept');
      assert.equal(device.heightFromFloorMm, frameAfter.heightFromFloorMm);
    }
    assert.ok(
      sanitized.devices.some((device) => device.note === 'Стиральная машина'),
      'mechanism note survives'
    );
    assert.equal(sanitized.frames.length, 1, 'no extra one-seat frames were invented');

    state().loadProject(exported);
    assert.deepEqual(state().frames[0], frameAfter, 'reloaded frame sits on the new wall');
    assert.deepEqual(
      mechanisms().map((device) => poseOf(device)),
      sanitized.devices
        .filter((device) => device.frameId === FRAME_ID)
        .map((device) => poseOf(device)),
      'reloaded mechanisms keep their places'
    );
    assert.equal(state().frames.length, 1, 'reload does not duplicate frames');
    assert.deepEqual(historySize(), [0, 0], 'loading clears history');
  });

  await test('B8b store: refusals leave the manual line untouched and toast once', () => {
    // Косая комната: автотрасса содержит наклонные сегменты, и moveManualRouteAnchors
    // их отвергает. Подрозетник при этом переезжает, а трасса должна остаться
    // прежней и получить тост (без нового шага undo для трассы).
    const f = fixture({ frameEdge: 3, frameOffsetMm: 600, skew: 400, seatIndexes: [0, 2] });
    loadFresh(f);
    const base = materializeRouteForLine(routeInput(), LINE_ID);
    assert.ok(base, 'auto route materializes');
    line().manualRoute = clone(base);
    const manualBefore = jsonClone(base);
    const counts = historySize();

    const frame = state().frames[0];
    assert.equal(
      state().moveFrame(FRAME_ID, { ...frame.anchor, offsetMm: frame.anchor.offsetMm + 150 }),
      true
    );
    assert.deepEqual(jsonClone(line().manualRoute), manualBefore, 'route geometry is frozen');
    assert.match(lastToast()?.message ?? '', /не удалось переподключить/);
    assert.equal(history().pastStates.length, counts[0] + 1, 'only the frame move is recorded');

    history().undo();
    assert.deepEqual(state().frames[0], f.frame, 'undo moves the frame back');
    assert.deepEqual(mechanisms().map((device) => device.anchor), f.devices.map((device) => device.anchor));
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
console.log(`\nmoveElements: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

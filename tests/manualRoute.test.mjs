import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const EPS = 1e-6;
const LINE_ID = 'mr-line';
const ROOM_ID = 'mr-room';
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
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= EPS, `${label}: expected ${expected}, got ${actual}`);
}
function pointNear(actual, expected, label) {
  assert.ok(actual, `${label}: missing point`);
  near(actual.x, expected.x, `${label}.x`);
  near(actual.y, expected.y, `${label}.y`);
}
const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clone = (value) => structuredClone(value);
const jsonClone = (value) => JSON.parse(JSON.stringify(value));
const settings = {
  defaultWallThicknessMm: 120, exteriorWallThicknessMm: 250,
  ceilingHeightMm: 2800, floorLevelMm: -150, cableMarginPercent: 17.5,
  defaultRouting: 'ceiling', showDimensions: true,
};
const cableLength = (plan, vertical) => (plan + vertical) * 1.175 + 1500;

// Never touch real user storage (the store may schedule timers on import).
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
function findNode(route, point) {
  return route.nodes.findIndex(
    (candidate) => Math.abs(candidate.x - point.x) < 0.5 && Math.abs(candidate.y - point.y) < 0.5
  );
}
function bendPoints(route) {
  return (route.bendNodes ?? []).map((index) => route.nodes[index]);
}
function visibleNodeCount(route) {
  return route.nodes.length - new Set(route.bendNodes ?? []).size;
}
// Точка лежит на любом сегменте трассы (соседняя вершина могла стать
// промежуточной и схлопнуться, геометрия при этом не изменилась).
function pointOnRoute(route, point) {
  return route.paths.some((path) => {
    for (let i = 1; i < path.length; i++) {
      const a = route.nodes[path[i - 1]];
      const b = route.nodes[path[i]];
      const length = span(a, b);
      if (length <= 0.5) continue;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
            (length * length)
        )
      );
      const projected = {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
      };
      if (span(projected, point) <= 0.5) return true;
    }
    return false;
  });
}
function straightRoute() {
  return {
    nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
    paths: [[0, 1, 2]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
    ],
  };
}
function cornerRoute() {
  return {
    nodes: [
      { x: 0, y: 0 }, { x: 1000, y: 0 },
      { x: 1000, y: 1000 }, { x: 2000, y: 1000 },
    ],
    paths: [[0, 1, 2, 3]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 3, kind: 'device', deviceId: 'device-a' },
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
    MANUAL_ROUTE_ANCHOR_TOLERANCE_MM,
    isManualRouteOrthogonal,
    insertManualRouteNode,
    manualRouteAnchorNode,
    manualRouteLength,
    materializeManualRoute,
    moveManualRouteNode,
    removeManualRouteNode,
    sanitizeManualRoute,
    validateManualRoute,
  } = await server.ssrLoadModule('/src/core/electrical/manualRoute.ts');
  const { computeLineRoutes, PANEL_CABLE_RESERVE_MM } =
    await server.ssrLoadModule('/src/core/electrical/routing.ts');
  const { buildAutoLayout } = await server.ssrLoadModule('/src/core/geometry/autoLayout.ts');
  const { createEmptyPanel, createLine, resolvePanelPose, sanitizePanel } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { resolveDevice } = await server.ssrLoadModule('/src/core/electrical/devices.ts');

  // --- Fixtures: rectangle, acute/obtuse parallelogram (±1500), L-shape. ---
  function buildFixture({
    vertices,
    reverse = false,
    roomType = 'living',
    panelEdge = 3,
    panelFraction = 0.37,
    deviceSpecs,
  }) {
    const ring = reverse ? [...vertices].reverse() : [...vertices];
    const room = {
      id: ROOM_ID, name: 'Manual route test', type: roomType, nodeIds: [],
      vertices: ring, holes: [], color: '#888888', wallThicknessMm: 120,
    };
    const edgeIndexOf = (edge) => {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % vertices.length];
      const index = ring.findIndex((point, i) => {
        const next = ring[(i + 1) % ring.length];
        return (point === a && next === b) || (point === b && next === a);
      });
      assert.ok(index >= 0, `edge ${edge} not found in ring`);
      return index;
    };
    const anchor = (edge, fraction) => {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % vertices.length];
      return {
        kind: 'room_edge', roomId: ROOM_ID, edgeIndex: edgeIndexOf(edge),
        offsetMm: span(a, b) * (reverse ? 1 - fraction : fraction),
      };
    };
    const edgePoint = (edge, fraction) => {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % vertices.length];
      return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
    };

    const devices = deviceSpecs.map((spec) => ({
      id: spec.id,
      type: spec.type ?? 'socket_single',
      name: spec.id,
      anchor: anchor(spec.edge, spec.fraction),
      heightFromFloorMm: spec.height ?? 350,
      powerWatts: spec.power ?? 2000,
      shared: false,
    }));
    const line = {
      ...createLine('sockets', [ROOM_ID], room.name, 0),
      id: LINE_ID,
      deviceIds: devices.map((device) => device.id),
      loadW: devices.reduce((total, device) => total + device.powerWatts, 0),
    };
    const panel = {
      ...createEmptyPanel(anchor(panelEdge, panelFraction)),
      id: 'mr-panel',
      heightFromFloorMm: 1450,
      lines: [line],
    };
    const layout = buildAutoLayout([room], [], [], [], settings.defaultWallThicknessMm);
    const input = {
      panel, devices, rooms: [room], partitions: [],
      nodes: layout.nodes, walls: layout.walls, settings: { ...settings },
    };
    return { input, room, anchor, edgePoint, panelPoint: edgePoint(panelEdge, panelFraction) };
  }

  function rectangleFixture(options = {}) {
    return buildFixture({
      vertices: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }],
      panelEdge: 3, panelFraction: 0.37,
      deviceSpecs: [{ id: 'socket-a', edge: 1, fraction: 0.61 }],
      ...options,
    });
  }
  function parallelogramFixture(skew, reverse) {
    return buildFixture({
      vertices: [
        { x: 0, y: 0 }, { x: 4000, y: 0 },
        { x: 4000 + skew, y: 3000 }, { x: skew, y: 3000 },
      ],
      reverse,
      panelEdge: 3, panelFraction: 0.37,
      deviceSpecs: [{ id: 'socket-a', edge: 1, fraction: 0.61 }],
    });
  }
  function lShapedFixture() {
    return buildFixture({
      vertices: [
        { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 },
        { x: 3000, y: 3000 }, { x: 3000, y: 6000 }, { x: 0, y: 6000 },
      ],
      panelEdge: 0, panelFraction: 0.3,
      deviceSpecs: [{ id: 'socket-a', edge: 4, fraction: 0.4 }],
    });
  }

  function poses(input) {
    const thickness = settings.defaultWallThicknessMm;
    const panelPose = resolvePanelPose(input.panel, input.rooms, input.partitions, thickness);
    assert.ok(panelPose, 'panel pose must resolve');
    const devicePoints = input.devices.map((device) => {
      const resolved = resolveDevice(device, input.rooms, input.partitions, thickness);
      assert.ok(resolved && resolved.poses[0], `device ${device.id} pose must resolve`);
      return { deviceId: device.id, point: resolved.poses[0].position };
    });
    return { panelPoint: panelPose.position, devicePoints };
  }
  function autoRoute(input) {
    const route = computeLineRoutes(input).get(LINE_ID);
    assert.ok(route, 'auto route must exist');
    return route;
  }
  function manualFromAuto(input) {
    const route = autoRoute(input);
    return materializeManualRoute(route.paths, poses(input));
  }
  function withManual(input, manual) {
    const next = clone(input);
    next.panel.lines[0].manualRoute = clone(manual);
    return next;
  }
  function expectedVertical(input) {
    const runHeight = settings.ceilingHeightMm;
    return input.devices.reduce(
      (total, device) =>
        total + Math.abs((device.type === 'light_ceiling' ? runHeight : device.heightFromFloorMm) - runHeight),
      Math.abs(input.panel.heightFromFloorMm - runHeight)
    );
  }

  // ---------------------------------------------------------------
  // Материализация и валидация
  // ---------------------------------------------------------------
  await test('materialize: shared corner stored once, panel/device anchors attached', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1000, y: 0 };
    const c = { x: 1000, y: 1000 };
    const route = materializeManualRoute(
      [[a, b], [b, c]],
      { panelPoint: a, devicePoints: [{ deviceId: 'd1', point: c }] }
    );
    assert.ok(route);
    assert.equal(route.nodes.length, 3);
    assert.equal(route.paths.length, 2);
    assert.deepEqual(route.paths, [[0, 1], [1, 2]]);
    assert.equal(manualRouteAnchorNode(route, 'panel'), 0);
    assert.equal(manualRouteAnchorNode(route, 'device', 'd1'), 2);
    assert.equal(validateManualRoute(route), null);
    near(manualRouteLength(route), 2000, 'length');
  });

  await test('materialize: three-way branch marks junction anchor', () => {
    const center = { x: 1000, y: 0 };
    const route = materializeManualRoute(
      [[{ x: 0, y: 0 }, center], [center, { x: 1000, y: 1000 }], [center, { x: 1000, y: -1000 }]],
      { panelPoint: { x: 0, y: 0 } }
    );
    assert.ok(route);
    assert.ok(route.anchors.some((anchor) => anchor.kind === 'junction' && anchor.nodeIndex === 1));
  });

  await test('materialize: null for empty or degenerate paths', () => {
    assert.equal(materializeManualRoute([]), null);
    assert.equal(materializeManualRoute([[]]), null);
    assert.equal(materializeManualRoute([[{ x: 0, y: 0 }]]), null);
  });

  await test('materialize: rectangle auto-route is valid, orthogonal and keeps length', () => {
    const { input } = rectangleFixture();
    const route = autoRoute(input);
    const manual = manualFromAuto(input);
    assert.ok(manual);
    assert.equal(validateManualRoute(manual), null);
    near(manualRouteLength(manual), route.planLengthMm, 'auto plan length preserved');
    assert.equal(isManualRouteOrthogonal(manual), true);
    assert.equal(route.paths.length, manual.paths.length);
    pointNear(route.paths[0][0], poses(input).panelPoint, 'auto starts at panel');
    assert.ok(manualRouteAnchorNode(manual, 'panel') !== null, 'panel anchor');
    assert.ok(manualRouteAnchorNode(manual, 'device', 'socket-a') !== null, 'device anchor');
  });

  for (const skew of [1500, -1500]) {
    for (const reverse of [false, true]) {
      await test(`materialize: parallelogram skew ${skew}, reverse ${reverse} — acute/obtuse, slanted segments`, () => {
        const { input } = parallelogramFixture(skew, reverse);
        const route = autoRoute(input);
        const manual = manualFromAuto(input);
        assert.ok(manual, 'manual route must materialize');
        assert.equal(validateManualRoute(manual), null);
        near(manualRouteLength(manual), route.planLengthMm, 'plan length preserved');
        assert.equal(isManualRouteOrthogonal(manual), false, 'angled walls must keep slanted segments');
        assert.ok(manualRouteAnchorNode(manual, 'panel') !== null);
        assert.ok(manualRouteAnchorNode(manual, 'device', 'socket-a') !== null);
      });
    }
  }

  await test('materialize: L-shaped room auto-route is valid and orthogonal', () => {
    const { input } = lShapedFixture();
    const route = autoRoute(input);
    const manual = manualFromAuto(input);
    assert.ok(manual);
    assert.equal(validateManualRoute(manual), null);
    near(manualRouteLength(manual), route.planLengthMm, 'plan length preserved');
    assert.equal(isManualRouteOrthogonal(manual), true);
  });

  await test('materialize: multi-device route keeps all device anchors', () => {
    const fixture = buildFixture({
      vertices: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }],
      panelEdge: 3, panelFraction: 0.5,
      deviceSpecs: [
        { id: 'socket-a', edge: 0, fraction: 0.2 },
        { id: 'socket-b', edge: 0, fraction: 0.75 },
      ],
    });
    const route = autoRoute(fixture.input);
    const manual = manualFromAuto(fixture.input);
    assert.ok(manual);
    assert.equal(validateManualRoute(manual), null);
    near(manualRouteLength(manual), route.planLengthMm, 'plan length preserved');
    assert.ok(manualRouteAnchorNode(manual, 'device', 'socket-a') !== null);
    assert.ok(manualRouteAnchorNode(manual, 'device', 'socket-b') !== null);
  });

  await test('length: sums every path, shared segments counted per path', () => {
    const route = {
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }],
      paths: [[0, 1], [0, 1, 2]],
      anchors: [],
    };
    near(manualRouteLength(route), 1000 + 1500, 'both path lengths');
  });

  await test('validate: rejects zero-length segments, bad indices, anchors and bends', () => {
    assert.ok(validateManualRoute({
      nodes: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      paths: [[0, 1]],
      anchors: [],
    }));
    assert.ok(validateManualRoute({
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
      paths: [[0, 5]],
      anchors: [],
    }));
    assert.ok(validateManualRoute({
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
      paths: [[0, 1]],
      anchors: [{ nodeIndex: 4, kind: 'panel' }],
    }));
    assert.ok(validateManualRoute({
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
      paths: [[0, 1]],
      anchors: [],
      bendNodes: [7],
    }));
  });

  // ---------------------------------------------------------------
  // Перемещение одной вершины: соседи остаются на месте
  // ---------------------------------------------------------------
  await test('move: corner moves alone, bends are service geometry, not points', () => {
    const route = cornerRoute();
    const result = moveManualRouteNode(route, 1, { x: 1300, y: 300 });
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    pointNear(moved.nodes[result.nodeIndex], { x: 1300, y: 300 }, 'moved corner');
    assert.ok(findNode(moved, { x: 0, y: 0 }) >= 0, 'panel neighbour unchanged');
    assert.ok(findNode(moved, { x: 1000, y: 1000 }) >= 0, 'device-side neighbour unchanged');
    assert.ok(findNode(moved, { x: 2000, y: 1000 }) >= 0, 'device unchanged');
    assert.equal(findNode(moved, { x: 1000, y: 0 }), -1, 'old corner is gone');
    assert.ok(findNode(moved, { x: 0, y: 300 }) >= 0, 'horizontal-edge bend exists in geometry');
    assert.ok(findNode(moved, { x: 1300, y: 1000 }) >= 0, 'vertical-edge bend exists in geometry');
    assert.equal(moved.nodes.length, 6, 'corner + two service bends');
    assert.equal(bendPoints(moved).length, 2, 'both bends are service-only');
    assert.ok(
      bendPoints(moved).some((point) => Math.abs(point.x) < 0.5 && Math.abs(point.y - 300) < 0.5),
      'first bend is not a user point'
    );
    assert.ok(
      bendPoints(moved).some((point) => Math.abs(point.x - 1300) < 0.5 && Math.abs(point.y - 1000) < 0.5),
      'second bend is not a user point'
    );
    assert.equal(visibleNodeCount(moved), 4, 'only original points plus the moved one stay visible');
    assert.ok(
      !(moved.bendNodes ?? []).includes(result.nodeIndex),
      'moved point stays a normal editable point'
    );
    assert.deepEqual(
      moved.paths[0].map((index) => moved.nodes[index]),
      [
        { x: 0, y: 0 },
        { x: 0, y: 300 },
        { x: 1300, y: 300 },
        { x: 1300, y: 1000 },
        { x: 1000, y: 1000 },
        { x: 2000, y: 1000 },
      ],
      'stair-step path'
    );
    assertOrthogonal(moved, 'after corner move');
    near(manualRouteLength(moved), 3600, 'elbows add the offset');
    assert.equal(validateManualRoute(moved), null);
    assert.equal(manualRouteAnchorNode(moved, 'panel'), 0, 'panel anchor kept');
    assert.ok(manualRouteAnchorNode(moved, 'device', 'device-a') !== null, 'device anchor kept');
  });

  await test('move: horizontal shift keeps one edge straight, elbows the other', () => {
    const route = cornerRoute();
    const result = moveManualRouteNode(route, 1, { x: 1300, y: 0 });
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    pointNear(moved.nodes[result.nodeIndex], { x: 1300, y: 0 }, 'moved corner');
    assert.ok(findNode(moved, { x: 1000, y: 1000 }) >= 0, 'vertical neighbour unchanged');
    assert.ok(findNode(moved, { x: 1300, y: 1000 }) >= 0, 'vertical edge bend');
    assert.equal(findNode(moved, { x: 0, y: 0 }), 0, 'horizontal edge stays straight');
    assert.equal(moved.nodes.length, 5);
    assert.equal(bendPoints(moved).length, 1, 'one service bend only');
    assert.equal(visibleNodeCount(moved), 4);
    assertOrthogonal(moved, 'horizontal shift');
    near(manualRouteLength(moved), 3600, 'length');
  });

  await test('move: vertical shift keeps one edge straight, elbows the other', () => {
    const route = cornerRoute();
    const result = moveManualRouteNode(route, 1, { x: 1000, y: 300 });
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    pointNear(moved.nodes[result.nodeIndex], { x: 1000, y: 300 }, 'moved corner');
    assert.ok(findNode(moved, { x: 0, y: 300 }) >= 0, 'horizontal edge bend');
    assert.ok(findNode(moved, { x: 1000, y: 1000 }) >= 0, 'vertical edge stays straight');
    assert.equal(moved.nodes.length, 5);
    assert.equal(bendPoints(moved).length, 1, 'one service bend only');
    assert.equal(visibleNodeCount(moved), 4);
    assertOrthogonal(moved, 'vertical shift');
    near(manualRouteLength(moved), 3000, 'length');
  });

  await test('move: inside and outside drags never move the neighbours', () => {
    for (const target of [{ x: 800, y: 500 }, { x: 1400, y: -400 }]) {
      const result = moveManualRouteNode(cornerRoute(), 1, target);
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      pointNear(result.route.nodes[result.nodeIndex], target, 'moved corner');
      assert.ok(findNode(result.route, { x: 0, y: 0 }) >= 0, 'panel unchanged');
      assert.ok(
        pointOnRoute(result.route, { x: 1000, y: 1000 }),
        'neighbour position stays on the route'
      );
      assert.ok(findNode(result.route, { x: 2000, y: 1000 }) >= 0, 'device unchanged');
      assertOrthogonal(result.route, 'free drag');
      assert.equal(validateManualRoute(result.route), null);
      assert.equal(visibleNodeCount(result.route), 4, 'no new editable points');
    }
  });

  await test('move: panel and device connection points are fixed', () => {
    const panel = moveManualRouteNode(cornerRoute(), 0, { x: 200, y: 0 });
    assert.equal(panel.ok, false);
    assert.match(panel.error, /закреплена/);
    const device = moveManualRouteNode(cornerRoute(), 3, { x: 2200, y: 1000 });
    assert.equal(device.ok, false);
    assert.match(device.error, /закреплена/);
  });

  await test('move: straight point dragged sideways forms a U, then returns to the line', () => {
    const route = straightRoute();
    const jog = moveManualRouteNode(route, 1, { x: 1000, y: 400 });
    assert.equal(jog.ok, true, jog.ok ? '' : jog.error);
    assert.equal(jog.route.nodes.length, 5);
    assert.equal(bendPoints(jog.route).length, 2, 'both U-bends are service-only');
    assert.equal(visibleNodeCount(jog.route), 3, 'only the three real points stay visible');
    assertOrthogonal(jog.route, 'jog');
    near(manualRouteLength(jog.route), 2800, 'jog adds twice the offset');
    assert.deepEqual(
      jog.route.paths[0].map((index) => jog.route.nodes[index].y),
      [0, 400, 400, 400, 0],
      'U-shaped path'
    );
    assert.ok(findNode(jog.route, { x: 0, y: 0 }) >= 0, 'panel unchanged');
    assert.ok(findNode(jog.route, { x: 2000, y: 0 }) >= 0, 'device unchanged');

    const back = moveManualRouteNode(jog.route, jog.nodeIndex, { x: 1000, y: 0 });
    assert.equal(back.ok, true, back.ok ? '' : back.error);
    pointNear(back.route.nodes[back.nodeIndex], { x: 1000, y: 0 }, 'point back on the line');
    assert.equal(findNode(back.route, { x: 0, y: 400 }), -1, 'service U-bends collapse');
    assert.equal(findNode(back.route, { x: 2000, y: 400 }), -1, 'no stale bend points');
    assert.equal(back.route.nodes.length, 3, 'three real points only');
    assert.equal(back.route.bendNodes, undefined, 'no service bends left');
    assert.ok(findNode(back.route, { x: 0, y: 0 }) >= 0, 'panel unchanged');
    assert.ok(findNode(back.route, { x: 2000, y: 0 }) >= 0, 'device unchanged');
    assertOrthogonal(back.route, 'returned to the line');
    near(manualRouteLength(back.route), 2000, 'straight again');
    assert.equal(validateManualRoute(back.route), null);
  });

  await test('move: straight point dragged along the line keeps three nodes', () => {
    const result = moveManualRouteNode(straightRoute(), 1, { x: 1600, y: 0 });
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.equal(result.route.nodes.length, 3);
    pointNear(result.route.nodes[result.nodeIndex], { x: 1600, y: 0 }, 'moved point');
    near(manualRouteLength(result.route), 2000, 'length along the line');
    assert.equal(validateManualRoute(result.route), null);
  });

  await test('move: repeated drag replaces service bends instead of stacking points', () => {
    const first = moveManualRouteNode(cornerRoute(), 1, { x: 1300, y: 300 });
    assert.equal(first.ok, true, first.ok ? '' : first.error);
    const second = moveManualRouteNode(first.route, first.nodeIndex, {
      x: -700,
      y: 1200,
    });
    assert.equal(second.ok, true, second.ok ? '' : second.error);
    const moved = second.route;
    pointNear(moved.nodes[second.nodeIndex], { x: -700, y: 1200 }, 'moved corner');
    assert.equal(visibleNodeCount(moved), 4, 'still the same four editable points');
    assert.equal(bendPoints(moved).length, 2, 'two fresh service bends');
    assert.equal(findNode(moved, { x: 0, y: 300 }), -1, 'old bend is replaced');
    assert.equal(findNode(moved, { x: 1300, y: 1000 }), -1, 'old bend is replaced');
    assertOrthogonal(moved, 'repeated drag');
    assert.equal(validateManualRoute(moved), null);
  });

  await test('move: junction is movable and reconnects every branch independently', () => {
    const junction = {
      nodes: [
        { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 1000, y: -1000 },
      ],
      paths: [[0, 1], [1, 2], [1, 3]],
      anchors: [{ nodeIndex: 1, kind: 'junction' }],
    };
    const result = moveManualRouteNode(junction, 1, { x: 1200, y: 200 });
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    pointNear(moved.nodes[result.nodeIndex], { x: 1200, y: 200 }, 'moved junction');
    assert.equal(moved.nodes.length, 7, 'junction plus three service bends');
    assert.equal(bendPoints(moved).length, 3, 'three service-only bends');
    assert.equal(visibleNodeCount(moved), 4, 'junction and branch ends stay the only points');
    assert.ok(findNode(moved, { x: 0, y: 200 }) >= 0, 'branch to panel reconnects');
    assert.ok(findNode(moved, { x: 1200, y: 1000 }) >= 0, 'branch up reconnects');
    assert.ok(findNode(moved, { x: 1200, y: -1000 }) >= 0, 'branch down reconnects');
    assert.ok(findNode(moved, { x: 0, y: 0 }) >= 0, 'panel end unchanged');
    assert.ok(findNode(moved, { x: 1000, y: 1000 }) >= 0, 'first branch end unchanged');
    assert.ok(findNode(moved, { x: 1000, y: -1000 }) >= 0, 'second branch end unchanged');
    assert.equal(manualRouteAnchorNode(moved, 'junction'), result.nodeIndex, 'junction anchor follows');
    assertOrthogonal(moved, 'junction move');
    assert.equal(validateManualRoute(moved), null);
  });

  await test('move: slanted vertex slides along its line', () => {
    const route = {
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }],
      paths: [[0, 1, 2]],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
      ],
    };
    const result = moveManualRouteNode(route, 1, { x: 1500, y: 300 });
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    pointNear(moved.nodes[result.nodeIndex], { x: 900, y: 900 }, 'projected onto slant');
    assert.ok(findNode(moved, { x: 900, y: 0 }) >= 0, 'orthogonal branch gets a bend');
    assert.equal(bendPoints(moved).length, 1, 'bend is service-only');
    assert.equal(visibleNodeCount(moved), 3, 'no new editable points on the slant');
    assert.ok(findNode(moved, { x: 0, y: 0 }) >= 0, 'panel unchanged');
    assert.ok(findNode(moved, { x: 1000, y: 0 }) >= 0, 'device unchanged');
    assert.equal(validateManualRoute(moved), null);
  });

  await test('move: junction of two non-collinear slants is refused', () => {
    const route = {
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 2000, y: 0 }],
      paths: [[0, 1], [1, 2]],
      anchors: [{ nodeIndex: 1, kind: 'junction' }],
    };
    const result = moveManualRouteNode(route, 1, { x: 1200, y: 800 });
    assert.equal(result.ok, false);
    assert.match(result.error, /наклонных/);
  });

  await test('move: coincidence with another vertex is refused', () => {
    const result = moveManualRouteNode(straightRoute(), 1, { x: 2000, y: 0 });
    assert.equal(result.ok, false);
    assert.match(result.error, /совпала/);
  });

  await test('move: crossing another path is allowed', () => {
    const route = {
      nodes: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: -500, y: 800 },
        { x: 500, y: 800 },
      ],
      paths: [[0, 1, 2], [3, 4]],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
      ],
    };
    const result = moveManualRouteNode(route, 1, { x: 0, y: 600 });
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.equal(validateManualRoute(result.route), null);
    assert.ok(findNode(result.route, { x: -500, y: 800 }) >= 0, 'other path untouched');
    assert.ok(findNode(result.route, { x: 500, y: 800 }) >= 0, 'other path untouched');
  });

  // ---------------------------------------------------------------
  // Вставка только на линии
  // ---------------------------------------------------------------
  await test('insert: projects a nearby click onto the segment', () => {
    const result = insertManualRouteNode(straightRoute(), 0, 1, { x: 1200, y: 30 }, 100);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.equal(result.route.nodes.length, 4);
    pointNear(result.route.nodes[result.nodeIndex], { x: 1200, y: 0 }, 'projected vertex');
    assert.deepEqual(result.route.paths[0], [0, 1, result.nodeIndex, 2]);
    near(manualRouteLength(result.route), 2000, 'insertion does not change length');
  });

  await test('insert: rejects clicks away from the line and near existing vertices', () => {
    const far = insertManualRouteNode(straightRoute(), 0, 0, { x: 1200, y: 300 }, 100);
    assert.equal(far.ok, false);
    assert.match(far.error, /только на линии/);

    const nearVertex = insertManualRouteNode(straightRoute(), 0, 0, { x: 0.2, y: 0 }, 100);
    assert.equal(nearVertex.ok, false);
    assert.match(nearVertex.error, /слишком близко/);
  });

  await test('insert: shared segment is split in every path that uses it', () => {
    const route = {
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
      paths: [[0, 1, 2], [1, 2]],
      anchors: [],
    };
    const result = insertManualRouteNode(route, 0, 1, { x: 1500, y: 0 });
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.equal(result.route.paths[0].length, 4);
    assert.equal(result.route.paths[1].length, 3);
    assert.ok(result.route.paths[1].includes(result.nodeIndex));
  });

  await test('insert: slanted projection stays on the line and can be deleted', () => {
    const route = {
      nodes: [{ x: 0, y: 0 }, { x: 1043, y: 2311 }],
      paths: [[0, 1]],
      anchors: [],
    };
    const middle = { x: 521.5, y: 1155.5 };
    const inserted = insertManualRouteNode(route, 0, 0, middle, 10);
    assert.equal(inserted.ok, true, inserted.ok ? '' : inserted.error);
    const point = inserted.route.nodes[inserted.nodeIndex];
    pointNear(point, middle, 'exact unrounded projection');
    const beforeLength = manualRouteLength(route);
    near(manualRouteLength(inserted.route), beforeLength, 'slanted insertion keeps length');

    const removed = removeManualRouteNode(inserted.route, inserted.nodeIndex);
    assert.equal(removed.ok, true, removed.ok ? '' : removed.error);
    const rebuilt = removed.route;
    assert.equal(rebuilt.nodes.length, 3, 'diagonal is rebuilt as a hidden step');
    assert.equal((rebuilt.bendNodes ?? []).length, 1, 'the step is not an editable point');
    assert.equal(
      rebuilt.nodes.length - rebuilt.bendNodes.length,
      2,
      'one visible point fewer'
    );
    const points = rebuilt.paths[0].map((index) => rebuilt.nodes[index]);
    pointNear(points[1], { x: 1043, y: 0 }, 'orthogonal elbow');
    pointNear(points[2], { x: 1043, y: 2311 }, 'endpoint intact');
    assertOrthogonal(rebuilt, 'deletion on a slanted span');
    assert.equal(validateManualRoute(rebuilt), null);
  });

  // ---------------------------------------------------------------
  // Удаление
  // ---------------------------------------------------------------
  await test('remove: collinear middle point is deleted without changing geometry', () => {
    const result = removeManualRouteNode(straightRoute(), 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.equal(result.route.nodes.length, 2);
    near(manualRouteLength(result.route), 2000, 'length unchanged');
  });

  await test('remove: corner is rebuilt as an orthogonal step, not refused', () => {
    const result = removeManualRouteNode(cornerRoute(), 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const route = result.route;
    assert.equal(route.nodes.length, 4, 'two neighbours plus one hidden elbow');
    assert.equal((route.bendNodes ?? []).length, 1);
    assert.equal(route.nodes.length - route.bendNodes.length, 3, 'visible points');
    assert.deepEqual(
      route.paths[0].map((index) => route.nodes[index]),
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: 2000, y: 1000 },
      ],
      'diagonal replaced by a right-angle staircase'
    );
    assertOrthogonal(route, 'corner deletion');
    near(manualRouteLength(route), 3000, 'Manhattan span between the neighbours');
    assert.equal(validateManualRoute(route), null);
  });

  await test('remove: only the affected path changes, other spans stay intact', () => {
    const route = {
      nodes: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: -500, y: 800 },
        { x: 500, y: 800 },
      ],
      paths: [[0, 1, 2], [3, 4]],
      anchors: [],
    };
    const result = removeManualRouteNode(route, 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    assert.equal(moved.paths.length, 2);
    assert.deepEqual(
      moved.paths[1].map((index) => moved.nodes[index]),
      [{ x: -500, y: 800 }, { x: 500, y: 800 }],
      'unrelated path is untouched'
    );
    assert.deepEqual(
      moved.paths[0].map((index) => moved.nodes[index]),
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
      ],
      'the local span is rebuilt as an orthogonal step'
    );
    assert.equal((moved.bendNodes ?? []).length, 1, 'the elbow is not a point');
    assertOrthogonal(moved, 'local rebuild');
  });

  await test('remove: anchor and free endpoint rules', () => {
    const anchor = removeManualRouteNode(cornerRoute(), 0);
    assert.equal(anchor.ok, false);
    assert.match(anchor.error, /[Зз]акреплённую/);

    const freeEnd = removeManualRouteNode({
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
      paths: [[0, 1, 2]],
      anchors: [{ nodeIndex: 0, kind: 'panel' }],
    }, 2);
    assert.equal(freeEnd.ok, true, freeEnd.ok ? '' : freeEnd.error);
    assert.equal(freeEnd.route.nodes.length, 2);
    near(manualRouteLength(freeEnd.route), 1000, 'route is shortened locally');
  });

  await test('remove: point outside its neighbours rebuilds its span', () => {
    const result = removeManualRouteNode({
      nodes: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 2000, y: 0 }],
      paths: [[0, 1, 2]],
      anchors: [],
    }, 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.deepEqual(
      result.route.paths[0].map((index) => result.route.nodes[index]),
      [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
      'neighbours connected directly'
    );
    near(manualRouteLength(result.route), 2000, 'shortest span');
  });

  await test('remove: deleted point takes its service bends with it', () => {
    const moved = moveManualRouteNode(cornerRoute(), 1, { x: 1300, y: 300 });
    assert.equal(moved.ok, true, moved.ok ? '' : moved.error);
    const movedIndex = moved.nodeIndex;
    assert.equal(bendPoints(moved.route).length, 2);
    const result = removeManualRouteNode(moved.route, movedIndex);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const route = result.route;
    assert.equal(
      (route.bendNodes ?? []).length,
      1,
      'old service bends collapsed, one orthogonal step remains'
    );
    assert.equal(route.nodes.length - route.bendNodes.length, 3);
    assert.deepEqual(
      route.paths[0].map((index) => route.nodes[index]),
      [
        { x: 0, y: 0 },
        { x: 0, y: 1000 },
        { x: 1000, y: 1000 },
        { x: 2000, y: 1000 },
      ],
      'the affected span is rebuilt as a staircase, the device-side span is untouched'
    );
    assertOrthogonal(route, 'deletion of a dragged point');
    assert.equal(validateManualRoute(route), null);
  });

  await test('remove: point shared by two paths merges them and keeps anchors', () => {
    const route = {
      nodes: [
        { x: 0, y: 0 },
        { x: 500, y: 400 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
      ],
      paths: [[0, 1], [1, 2, 3]],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 3, kind: 'device', deviceId: 'device-a' },
      ],
    };
    const result = removeManualRouteNode(route, 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    assert.equal(moved.paths.length, 1, 'both branches became one path');
    assert.deepEqual(
      moved.paths[0].map((index) => moved.nodes[index]),
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
      ],
      'nearest visible points are connected directly'
    );
    assert.ok(manualRouteAnchorNode(moved, 'panel') !== null, 'panel anchor survived');
    assert.ok(
      manualRouteAnchorNode(moved, 'device', 'device-a') !== null,
      'device anchor survived'
    );
    near(manualRouteLength(moved), 2000, 'only the local span changed');
    assert.equal(validateManualRoute(moved), null);
  });

  await test('remove: merge across two paths collapses bends on both sides', () => {
    const route = {
      nodes: [
        { x: 0, y: 0 },
        { x: 0, y: 400 },
        { x: 500, y: 400 },
        { x: 500, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
      ],
      paths: [[0, 1, 2], [2, 3, 4, 5]],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 5, kind: 'device', deviceId: 'device-a' },
      ],
      bendNodes: [1, 3],
    };
    const result = removeManualRouteNode(route, 2);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const moved = result.route;
    assert.equal(moved.paths.length, 1);
    assert.deepEqual(
      moved.paths[0].map((index) => moved.nodes[index]),
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 2000, y: 0 },
      ],
      'both service bends disappeared with the deleted point'
    );
    assert.equal(moved.bendNodes, undefined);
    assert.ok(manualRouteAnchorNode(moved, 'panel') !== null);
    assert.ok(manualRouteAnchorNode(moved, 'device', 'device-a') !== null);
    assert.equal(validateManualRoute(moved), null);
  });

  await test('remove: leaf point that would detach an anchor is refused', () => {
    const result = removeManualRouteNode({
      nodes: [
        { x: 0, y: 0 },
        { x: 0, y: 400 },
        { x: 500, y: 400 },
      ],
      paths: [[0, 1, 2]],
      anchors: [{ nodeIndex: 0, kind: 'panel' }],
      bendNodes: [1],
    }, 2);
    assert.equal(result.ok, false);
    assert.match(result.error, /схлопнется/);
  });

  // ---------------------------------------------------------------
  // Sanitization
  // ---------------------------------------------------------------
  await test('sanitize: drops garbage, remaps nodes and anchors, idempotent', () => {
    const raw = {
      nodes: [
        { x: 0, y: 0 }, { x: 777, y: 777 },
        { x: 1000, y: 0 }, { x: 1000, y: 1000 },
      ],
      paths: [[0, 2], [2, 3], [0, 99], [3]],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 3, kind: 'device', deviceId: 'd1' },
        { nodeIndex: 1, kind: 'junction' },
        { nodeIndex: 9, kind: 'panel' },
      ],
    };
    const route = sanitizeManualRoute(raw);
    assert.ok(route);
    assert.equal(route.nodes.length, 3);
    assert.deepEqual(route.paths, [[0, 1], [1, 2]]);
    assert.equal(manualRouteAnchorNode(route, 'panel'), 0);
    assert.equal(manualRouteAnchorNode(route, 'device', 'd1'), 2);
    assert.deepEqual(sanitizeManualRoute(jsonClone(route)), route);
  });

  await test('sanitize: returns undefined for broken data', () => {
    assert.equal(sanitizeManualRoute(null), undefined);
    assert.equal(sanitizeManualRoute({ paths: [[0, 1]] }), undefined);
    assert.equal(sanitizeManualRoute({ nodes: [{ x: 0, y: 0 }, { x: 'a', y: 1 }], paths: [[0, 1]] }), undefined);
    assert.equal(sanitizeManualRoute({
      nodes: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      paths: [[0, 1]],
    }), undefined);
  });

  await test('sanitize: keeps explicit collinear user points', () => {
    const route = sanitizeManualRoute(straightRoute());
    assert.ok(route);
    assert.equal(route.nodes.length, 3);
  });

  await test('sanitize: service bends are remapped and stay idempotent', () => {
    const raw = {
      nodes: [
        { x: 0, y: 0 }, { x: 0, y: 300 }, { x: 1300, y: 300 },
        { x: 1300, y: 1000 }, { x: 1000, y: 1000 }, { x: 2000, y: 1000 },
      ],
      paths: [[0, 1, 2, 3, 4, 5]],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 5, kind: 'device', deviceId: 'd1' },
      ],
      bendNodes: [1, 3, 99],
    };
    const route = sanitizeManualRoute(raw);
    assert.ok(route);
    assert.deepEqual(route.bendNodes, [1, 3]);
    assert.deepEqual(sanitizeManualRoute(jsonClone(route)), route);
    assert.equal(visibleNodeCount(route), 4);
  });

  // ---------------------------------------------------------------
  // Интеграция маршрутизации
  // ---------------------------------------------------------------
  await test('routing: manual route takes precedence over auto geometry', () => {
    const { input } = rectangleFixture();
    const manual = manualFromAuto(input);
    const manually = computeLineRoutes(withManual(input, manual)).get(LINE_ID);
    assert.ok(manually);
    assert.equal(manually.planLengthMm, manualRouteLength(manual));
    near(manually.verticalMm, expectedVertical(input), 'vertical runs');
    near(manually.cableLengthMm,
      cableLength(manualRouteLength(manual), expectedVertical(input)),
      'panel reserve and margin formula');
    assert.equal(PANEL_CABLE_RESERVE_MM, 1500);
    assert.equal(manually.deviceCount, 1);
    assert.equal(manually.warning, null);
    assert.deepEqual(
      manually.paths,
      manual.paths.map((path) => path.map((index) => manual.nodes[index]))
    );
  });

  await test('routing: invalid manual route is reported and falls back', () => {
    const { input } = rectangleFixture();
    const broken = clone(input);
    broken.panel.lines[0].manualRoute = { nodes: [{ x: 0, y: 0 }], paths: [[0, 7]], anchors: [] };
    const result = computeLineRoutes(broken).get(LINE_ID);
    assert.ok(result);
    assert.match(result.warning, /повреждена и проигнорирована/);
    assert.ok(result.cableLengthMm > 0, 'auto fallback still builds a route');
  });

  await test('routing: manual route ignores legacy waypoints', () => {
    const { input } = rectangleFixture();
    const manual = manualFromAuto(input);
    const both = withManual(input, manual);
    both.panel.lines[0].waypoints = [{ x: 100, y: 100 }];
    const result = computeLineRoutes(both).get(LINE_ID);
    assert.ok(result);
    assert.equal(result.planLengthMm, manualRouteLength(manual));
    assert.deepEqual(
      result.paths,
      manual.paths.map((path) => path.map((index) => manual.nodes[index]))
    );
  });

  await test('routing: moved panel warns about detached manual route', () => {
    const fixture = rectangleFixture();
    const manual = manualFromAuto(fixture.input);
    const moved = withManual(fixture.input, manual);
    moved.panel = { ...moved.panel, anchor: fixture.anchor(2, 0.2) };
    const result = computeLineRoutes(moved).get(LINE_ID);
    assert.ok(result);
    assert.match(result.warning, /щитка/);
    assert.equal(result.planLengthMm, manualRouteLength(manual), 'geometry stays frozen');
  });

  await test('routing: moved device warns about detached manual route', () => {
    const fixture = rectangleFixture();
    const manual = manualFromAuto(fixture.input);
    const moved = withManual(fixture.input, manual);
    moved.devices[0] = { ...moved.devices[0], anchor: fixture.anchor(2, 0.5) };
    const result = computeLineRoutes(moved).get(LINE_ID);
    assert.ok(result);
    assert.match(result.warning, /приборам линии/);
  });

  await test('routing: missing device is counted and warned in manual mode', () => {
    const fixture = rectangleFixture();
    const manual = manualFromAuto(fixture.input);
    const missing = withManual(fixture.input, manual);
    missing.panel.lines[0].deviceIds = ['socket-a', 'ghost'];
    const result = computeLineRoutes(missing).get(LINE_ID);
    assert.ok(result);
    assert.equal(result.deviceCount, 1);
    assert.match(result.warning, /приборов линии не найдена/);
  });

  await test('routing: anchor tolerance is one millimetre', () => {
    assert.equal(MANUAL_ROUTE_ANCHOR_TOLERANCE_MM, 1);
    const fixture = rectangleFixture();
    const manual = manualFromAuto(fixture.input);
    const nudged = clone(manual);
    const panelNode = manualRouteAnchorNode(nudged, 'panel');
    nudged.nodes[panelNode] = {
      x: nudged.nodes[panelNode].x + MANUAL_ROUTE_ANCHOR_TOLERANCE_MM,
      y: nudged.nodes[panelNode].y,
    };
    const result = computeLineRoutes(withManual(fixture.input, nudged)).get(LINE_ID);
    assert.ok(result);
    assert.equal(result.warning, null, 'at tolerance the route is still attached');
  });

  // ---------------------------------------------------------------
  // Сохранение
  // ---------------------------------------------------------------
  await test('persistence: JSON round-trip survives sanitizePanel', () => {
    const fixture = rectangleFixture();
    const manual = manualFromAuto(fixture.input);
    const panel = clone(fixture.input.panel);
    panel.lines[0].manualRoute = clone(manual);
    const restored = sanitizePanel(
      jsonClone(panel),
      fixture.input.rooms,
      fixture.input.partitions,
      settings.defaultWallThicknessMm
    );
    assert.ok(restored);
    assert.ok(restored.lines[0].manualRoute);
    assert.deepEqual(restored.lines[0].manualRoute, sanitizeManualRoute(manual));
  });

  await test('persistence: broken manual route is dropped on load', () => {
    const fixture = rectangleFixture();
    const panel = clone(fixture.input.panel);
    panel.lines[0].manualRoute = { nodes: [], paths: [[0, 1]], anchors: [] };
    const restored = sanitizePanel(
      panel,
      fixture.input.rooms,
      fixture.input.partitions,
      settings.defaultWallThicknessMm
    );
    assert.ok(restored);
    assert.equal(restored.lines[0].manualRoute, undefined);
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

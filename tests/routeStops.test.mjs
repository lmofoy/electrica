// Короткий набор тестов списка порядка: ветви трассы и перестановка остановок.
// Запуск: node tests/routeStops.test.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const EPS = 1e-6;
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
const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clone = (value) => structuredClone(value);
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= EPS, `${label}: expected ${expected}, got ${actual}`);
}
function pointNear(actual, expected, label) {
  assert.ok(actual, `${label}: missing point`);
  near(actual.x, expected.x, `${label}.x`);
  near(actual.y, expected.y, `${label}.y`);
}
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
const visibleCount = (route) => route.nodes.length - new Set(route.bendNodes ?? []).size;
const pathPoints = (route, pathIndex) => route.paths[pathIndex].map((i) => route.nodes[i]);
const stopPoints = (route, branch) => branch.stops.map((stop) => route.nodes[stop.nodeIndex]);
function hasEdge(route, a, b) {
  return route.paths.some((path) =>
    path.some((index, i) => {
      if (i === 0) return false;
      const p = route.nodes[path[i - 1]];
      const q = route.nodes[index];
      return (
        (span(p, a) <= 0.5 && span(q, b) <= 0.5) ||
        (span(p, b) <= 0.5 && span(q, a) <= 0.5)
      );
    })
  );
}
function anchorPoint(route, kind, deviceId) {
  const anchor = route.anchors.find(
    (candidate) => candidate.kind === kind && (kind !== 'device' || candidate.deviceId === deviceId)
  );
  assert.ok(anchor, `anchor ${kind}${deviceId ? `:${deviceId}` : ''} must survive`);
  return route.nodes[anchor.nodeIndex];
}

// Цепочка: щиток → точка → прибор A → точка → прибор B, всё под 90°.
function chainRoute() {
  return {
    nodes: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 2000, y: 800 },
      { x: 2000, y: 1600 },
    ],
    paths: [[0, 1, 2, 3, 4]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
      { nodeIndex: 4, kind: 'device', deviceId: 'device-b' },
    ],
  };
}

// Ветвление: щиток → стык, от стыка прибор A вниз и прибор B вправо.
function branchedRoute() {
  return {
    nodes: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 2400, y: 0 },
    ],
    paths: [[0, 1, 2], [1, 3]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 1, kind: 'junction' },
      { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
      { nodeIndex: 3, kind: 'device', deviceId: 'device-b' },
    ],
  };
}

// Наклонная цепочка (острые/тупые углы): точки не на одной оси.
function slantedRoute() {
  return {
    nodes: [
      { x: 0, y: 0 },
      { x: 1043, y: 2311 },
      { x: 2600, y: 1700 },
      { x: 3100, y: 4200 },
    ],
    paths: [[0, 1, 2, 3]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 2, kind: 'device', deviceId: 'device-a' },
      { nodeIndex: 3, kind: 'device', deviceId: 'device-b' },
    ],
  };
}

// Как строит автопрокладка: подводка от щитка, отвод к прибору, участок
// по стене до следующего прибора и снова отвод. Кусков много, линия одна.
function autoChainRoute() {
  return {
    nodes: [
      { x: 0, y: 0 },
      { x: 0, y: 1000 },
      { x: 1000, y: 1000 },
      { x: 1200, y: 1000 },
      { x: 3000, y: 1000 },
      { x: 3000, y: 2000 },
      { x: 3200, y: 2000 },
    ],
    paths: [[0, 1, 2], [2, 3], [2, 4, 5], [5, 6]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 2, kind: 'junction' },
      { nodeIndex: 3, kind: 'device', deviceId: 'device-a' },
      { nodeIndex: 6, kind: 'device', deviceId: 'device-b' },
    ],
  };
}

// Ветвление с длинной ветвью: стык → точка → прибор A, и два прибора-тупика.
function forkChainRoute() {
  return {
    nodes: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 1800, y: 800 },
      { x: 2400, y: 0 },
      { x: 1000, y: -900 },
    ],
    paths: [[0, 1], [1, 2, 3], [1, 4], [1, 5]],
    anchors: [
      { nodeIndex: 0, kind: 'panel' },
      { nodeIndex: 1, kind: 'junction' },
      { nodeIndex: 3, kind: 'device', deviceId: 'device-a' },
      { nodeIndex: 4, kind: 'device', deviceId: 'device-b' },
      { nodeIndex: 5, kind: 'device', deviceId: 'device-c' },
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
    manualRouteBranches,
    manualRouteLength,
    materializeManualRoute,
    reorderManualRouteStops,
    validateManualRoute,
  } = await server.ssrLoadModule('/src/core/electrical/manualRoute.ts');

  // ---------------------------------------------------------------
  // Ветви и список остановок
  // ---------------------------------------------------------------
  await test('branches: one chain lists panel, points and devices in path order', () => {
    const route = chainRoute();
    const branches = manualRouteBranches(route);
    assert.equal(branches.length, 1);
    assert.deepEqual(branches[0].nodes, [0, 1, 2, 3, 4]);
    assert.deepEqual(
      branches[0].stops.map((stop) => stop.kind),
      ['panel', 'point', 'device', 'point', 'device']
    );
    assert.deepEqual(
      branches[0].stops.map((stop) => stop.deviceId ?? null),
      [null, null, 'device-a', null, 'device-b']
    );
    near(branches[0].lengthMm, manualRouteLength(route), 'branch length');
  });

  await test('branches: service bends are not stops', () => {
    const route = chainRoute();
    route.nodes.push({ x: 1500, y: 0 });
    route.paths = [[0, 1, 5, 2, 3, 4]];
    route.bendNodes = [5];
    const branches = manualRouteBranches(route);
    assert.equal(branches[0].stops.length, 5, 'bend stays out of the list');
    assert.equal(
      branches[0].stops.some((stop) => stop.nodeIndex === 5),
      false
    );
  });

  await test('branches: auto-routing pieces stay one list, devices are inline', () => {
    const route = autoChainRoute();
    assert.equal(route.paths.length, 4, 'fixture really is split into pieces');
    const branches = manualRouteBranches(route);
    assert.equal(branches.length, 1, 'one cable line — one list');
    assert.deepEqual(
      branches[0].stops.map((stop) => stop.deviceId ?? stop.kind),
      ['panel', 'point', 'junction', 'device-a', 'point', 'point', 'device-b']
    );
    near(
      branches.reduce((sum, branch) => sum + branch.lengthMm, 0),
      manualRouteLength(route),
      'every piece is counted once'
    );
  });

  await test('branches: a fork gives one list per branch, junction shared', () => {
    const route = branchedRoute();
    const branches = manualRouteBranches(route);
    assert.equal(branches.length, 3);
    assert.deepEqual(
      branches[0].stops.map((stop) => stop.kind),
      ['panel', 'junction']
    );
    assert.deepEqual(
      branches[1].stops.map((stop) => stop.kind),
      ['junction', 'device']
    );
    assert.deepEqual(
      branches[2].stops.map((stop) => stop.kind),
      ['junction', 'device']
    );
    assert.equal(branches[0].stops[1].nodeIndex, branches[1].stops[0].nodeIndex);
    assert.equal(branches[0].stops[1].nodeIndex, branches[2].stops[0].nodeIndex);
    near(
      branches.reduce((sum, branch) => sum + branch.lengthMm, 0),
      manualRouteLength(route),
      'branch lengths add up to the cable length'
    );
  });

  await test('branches: materialized fork marks the branching point as junction', () => {
    const route = materializeManualRoute(
      [
        [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }],
        [{ x: 1000, y: 0 }, { x: 2400, y: 0 }],
      ],
      {
        panelPoint: { x: 0, y: 0 },
        devicePoints: [
          { deviceId: 'device-a', point: { x: 1000, y: 800 } },
          { deviceId: 'device-b', point: { x: 2400, y: 0 } },
        ],
      }
    );
    assert.ok(route);
    const branches = manualRouteBranches(route);
    assert.equal(branches.length, 3);
    assert.equal(branches[0].stops[1].kind, 'junction');
    assert.equal(branches[1].stops[0].kind, 'junction');
    assert.equal(branches[2].stops[0].kind, 'junction');
  });

  // ---------------------------------------------------------------
  // Перестановка
  // ---------------------------------------------------------------
  await test('reorder: moving a device up rebuilds the chain in the new order', () => {
    const route = chainRoute();
    const before = clone(route);
    const result = reorderManualRouteStops(route, 0, 4, 2);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const next = result.route;
    assert.equal(validateManualRoute(next), null);
    assertOrthogonal(next, 'reordered chain');
    const branches = manualRouteBranches(next);
    assert.deepEqual(
      branches[0].stops.map((stop) => stop.deviceId ?? stop.kind),
      ['panel', 'point', 'device-b', 'device-a', 'point']
    );
    assert.equal(visibleCount(next), visibleCount(before), 'no new editable points');
    assert.ok((next.bendNodes ?? []).length > 0, 'diagonal gaps become hidden steps');
    assert.deepEqual(route, before, 'source route is not mutated');
  });

  await test('reorder: every stop keeps its coordinates, elements are not moved', () => {
    const route = chainRoute();
    const points = stopPoints(route, manualRouteBranches(route)[0]);
    const result = reorderManualRouteStops(route, 0, 3, 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const next = result.route;
    for (const point of points) {
      assert.ok(
        next.nodes.some((candidate) => span(candidate, point) <= 0.5),
        `stop (${point.x},${point.y}) keeps its place`
      );
    }
    pointNear(anchorPoint(next, 'panel'), { x: 0, y: 0 }, 'panel');
    pointNear(anchorPoint(next, 'device', 'device-a'), { x: 1000, y: 800 }, 'device A');
    pointNear(anchorPoint(next, 'device', 'device-b'), { x: 2000, y: 1600 }, 'device B');
  });

  await test('reorder: a diagonal gap is rebuilt as a hidden 90° step', () => {
    const route = chainRoute();
    const result = reorderManualRouteStops(route, 0, 4, 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const next = result.route;
    assertOrthogonal(next, 'step after reorder');
    const bends = (next.bendNodes ?? []).map((index) => next.nodes[index]);
    assert.ok(
      bends.some((point) => span(point, { x: 2000, y: 0 }) <= 0.5),
      'elbow sits on the horizontal-first corner'
    );
    assert.equal(visibleCount(next), 5, 'the step is not an editable point');
    const branches = manualRouteBranches(next);
    assert.equal(branches[0].stops.length, 5);
  });

  await test('reorder: only the chosen branch changes', () => {
    const route = forkChainRoute();
    const untouched = [
      [route.nodes[0], route.nodes[1]],
      [route.nodes[1], route.nodes[4]],
      [route.nodes[1], route.nodes[5]],
    ];
    const result = reorderManualRouteStops(route, 1, 2, 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const next = result.route;
    for (const [a, b] of untouched) {
      assert.ok(hasEdge(next, a, b), `untouched span (${a.x},${a.y})-(${b.x},${b.y}) survives`);
    }
    const branches = manualRouteBranches(next);
    assert.equal(branches.length, 4, 'the fork keeps its branches');
    assert.deepEqual(
      branches[1].stops.map((stop) => stop.deviceId ?? stop.kind),
      ['junction', 'device-a', 'point'],
      'the edited branch follows the new order'
    );
    assertOrthogonal(next, 'fork after reorder');
    assert.equal(validateManualRoute(next), null);
  });

  await test('reorder: the shared junction stays at the same place for all branches', () => {
    const route = branchedRoute();
    const junction = route.nodes[1];
    const result = reorderManualRouteStops(route, 1, 1, 0);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const next = result.route;
    const branches = manualRouteBranches(next);
    const listed = branches
      .map((branch) => branch.stops.find((stop) => stop.kind === 'junction'))
      .filter(Boolean);
    assert.equal(listed.length, branches.length, 'junction is listed in every branch');
    assert.ok(
      listed.every((stop) => stop.nodeIndex === listed[0].nodeIndex),
      'all branches share one junction node'
    );
    pointNear(next.nodes[listed[0].nodeIndex], junction, 'junction coordinates');
    assert.equal(validateManualRoute(next), null);
  });

  await test('reorder: a device moved along an auto chain follows the list', () => {
    const route = autoChainRoute();
    const stops = manualRouteBranches(route)[0].stops;
    const last = stops.length - 1;
    const result = reorderManualRouteStops(route, 0, last, 3);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const next = result.route;
    assert.equal(validateManualRoute(next), null);
    assertOrthogonal(next, 'auto chain after reorder');
    assert.deepEqual(
      manualRouteBranches(next)[0].stops
        .filter((stop) => stop.kind === 'device')
        .map((stop) => stop.deviceId),
      ['device-b', 'device-a'],
      'the moved device is visited first'
    );
    assert.equal(visibleCount(next), visibleCount(route), 'no new editable points');
    pointNear(anchorPoint(next, 'panel'), { x: 0, y: 0 }, 'panel');
    pointNear(anchorPoint(next, 'device', 'device-a'), { x: 1200, y: 1000 }, 'device A');
    pointNear(anchorPoint(next, 'device', 'device-b'), { x: 3200, y: 2000 }, 'device B');
  });

  await test('reorder: slanted stops are rebuilt orthogonally without new points', () => {
    const route = slantedRoute();
    const result = reorderManualRouteStops(route, 0, 3, 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const next = result.route;
    assert.equal(validateManualRoute(next), null);
    assertOrthogonal(next, 'slanted chain after reorder');
    assert.equal(visibleCount(next), 4, 'visible stops are preserved');
    pointNear(anchorPoint(next, 'device', 'device-b'), { x: 3100, y: 4200 }, 'device B');
    const branches = manualRouteBranches(next);
    assert.deepEqual(
      branches[0].stops.map((stop) => stop.deviceId ?? stop.kind),
      ['panel', 'device-b', 'point', 'device-a']
    );
  });

  await test('reorder: swapping back restores the original geometry', () => {
    const route = chainRoute();
    const original = pathPoints(route, 0);
    const first = reorderManualRouteStops(route, 0, 4, 2);
    assert.equal(first.ok, true, first.ok ? '' : first.error);
    const second = reorderManualRouteStops(first.route, 0, 2, 4);
    assert.equal(second.ok, true, second.ok ? '' : second.error);
    const restored = pathPoints(second.route, 0);
    assert.deepEqual(
      restored.map((point) => [Math.round(point.x), Math.round(point.y)]),
      original.map((point) => [Math.round(point.x), Math.round(point.y)]),
      'round trip returns the same polyline'
    );
    near(manualRouteLength(second.route), manualRouteLength(route), 'round trip length');
  });

  await test('reorder: repeated moves do not accumulate points or bends', () => {
    let route = chainRoute();
    for (let i = 0; i < 6; i++) {
      const result = reorderManualRouteStops(route, 0, 4, 1);
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      route = result.route;
      const back = reorderManualRouteStops(route, 0, 1, 4);
      assert.equal(back.ok, true, back.ok ? '' : back.error);
      route = back.route;
    }
    assert.equal(visibleCount(route), 5, 'visible points stay constant');
    assert.equal(validateManualRoute(route), null);
    assertOrthogonal(route, 'after repeated reorders');
    near(manualRouteLength(route), manualRouteLength(chainRoute()), 'length is stable');
  });

  // ---------------------------------------------------------------
  // Отказы и граничные случаи
  // ---------------------------------------------------------------
  await test('reorder: the panel cannot be moved from the first place', () => {
    const route = chainRoute();
    const moved = reorderManualRouteStops(route, 0, 0, 2);
    assert.equal(moved.ok, false);
    assert.match(moved.error, /Щиток/);
    const beforePanel = reorderManualRouteStops(route, 0, 2, 0);
    assert.equal(beforePanel.ok, false);
    assert.match(beforePanel.error, /щиток/i);
  });

  await test('reorder: a two-stop branch keeps its cable and stays valid', () => {
    const route = branchedRoute();
    const result = reorderManualRouteStops(route, 1, 0, 1);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const next = result.route;
    assert.equal(validateManualRoute(next), null);
    assertOrthogonal(next, 'two-stop branch');
    assert.ok(hasEdge(next, route.nodes[1], route.nodes[2]), 'the span is still there');
    assert.deepEqual(
      manualRouteBranches(next)[1].stops.map((stop) => stop.kind),
      ['junction', 'device'],
      'a branch is read from the junction to its dead end'
    );
  });

  await test('reorder: wrong branch or stop index is refused', () => {
    const route = chainRoute();
    for (const args of [
      [9, 1, 2],
      [-1, 1, 2],
      [0, 9, 2],
      [0, 1, 9],
      [0, -1, 2],
      [0, 1.5, 2],
    ]) {
      const result = reorderManualRouteStops(route, ...args);
      assert.equal(result.ok, false, `args ${args.join(',')} must fail`);
      assert.ok(result.error.length > 0);
    }
  });

  await test('reorder: the same position is a no-op', () => {
    const route = chainRoute();
    const result = reorderManualRouteStops(route, 0, 2, 2);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.deepEqual(pathPoints(result.route, 0), pathPoints(route, 0));
  });

  await test('reorder: a damaged route is refused', () => {
    const result = reorderManualRouteStops({ nodes: [], paths: [], anchors: [] }, 0, 0, 1);
    assert.equal(result.ok, false);
    assert.match(result.error, /повреждена/);
  });
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  await server?.close();
}

console.log(`\nrouteStops: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
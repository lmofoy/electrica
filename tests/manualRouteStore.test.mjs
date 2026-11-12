import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const EPS = 1e-6;
const LINE_ID = 'test-line';
const ROOM_ID = 'test-room';
const STORAGE_KEY = 'electrica-project-v1';
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
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}
const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clone = (value) => structuredClone(value);
const jsonClone = (value) => JSON.parse(JSON.stringify(value));
function pointOnRoute(route, point) {
  return route.paths.some((path) => {
    for (let i = 1; i < path.length; i++) {
      const a = route.nodes[path[i - 1]];
      const b = route.nodes[path[i]];
      const length = span(a, b);
      if (length <= EPS) continue;
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
      if (span(projected, point) <= EPS) return true;
    }
    return false;
  });
}
const settings = {
  defaultWallThicknessMm: 120, exteriorWallThicknessMm: 250,
  ceilingHeightMm: 2800, floorLevelMm: -150, cableMarginPercent: 17.5,
  defaultRouting: 'ceiling', showDimensions: true,
};

const saved = new Map();
const saveWaiters = new Set();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => {
      saved.set(key, String(value));
      for (const notify of saveWaiters) notify(key, String(value));
    },
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
  });
  const { computeLineRoutes, materializeRouteForLine } =
    await server.ssrLoadModule('/src/core/electrical/routing.ts');
  const { buildAutoLayout } = await server.ssrLoadModule('/src/core/geometry/autoLayout.ts');
  const { createEmptyPanel, createLine } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const {
    isManualRouteOrthogonal,
    manualRouteAnchorNode,
    manualRouteBranches,
    manualRouteLength,
    validateManualRoute,
  } = await server.ssrLoadModule('/src/core/electrical/manualRoute.ts');
  const { useProjectStore: store, getProjectSnapshot, isProjectSnapshot } =
    await server.ssrLoadModule('/src/store/useProjectStore.ts');

  function fixture(skew) {
    const vertices = [
      { x: 0, y: 0 }, { x: 4000, y: 0 },
      { x: 4000 + skew, y: 3000 }, { x: skew, y: 3000 },
    ];
    const room = {
      id: ROOM_ID, name: 'Route test', type: 'living', nodeIds: [],
      vertices, holes: [], color: '#888888', wallThicknessMm: 120,
    };
    const layout = buildAutoLayout([room], [], [], [], settings.defaultWallThicknessMm);
    function anchor(edge, fraction) {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % vertices.length];
      return {
        kind: 'room_edge', roomId: ROOM_ID, edgeIndex: edge,
        offsetMm: span(a, b) * fraction,
      };
    }
    const device = {
      id: 'test-socket', type: 'socket_single', name: 'Socket',
      anchor: anchor(1, 0.61), heightFromFloorMm: 350, powerWatts: 2000, shared: false,
    };
    const line = {
      ...createLine('sockets', [ROOM_ID], room.name, 0),
      id: LINE_ID, deviceIds: [device.id], loadW: device.powerWatts,
    };
    const panel = {
      ...createEmptyPanel(anchor(3, 0.37)),
      id: 'test-panel', heightFromFloorMm: 1450, lines: [line],
    };
    return {
      input: {
        panel, devices: [device], rooms: [room], partitions: [],
        nodes: layout.nodes, walls: layout.walls, settings: { ...settings },
      },
      layout,
    };
  }

  function snapshot(f) {
    return {
      version: 1, savedAt: new Date(0).toISOString(), boundaryMode: 'auto',
      settings: clone(f.input.settings), apartment: clone(f.layout.apartment),
      rooms: clone(f.input.rooms), nodes: clone(f.input.nodes), walls: clone(f.input.walls),
      openings: [], freePartitions: [], shafts: [],
      devices: clone(f.input.devices), panel: clone(f.input.panel),
    };
  }

  const rectangle = fixture(0);
  const parallelogram = fixture(1500);
  const state = () => store.getState();
  const history = () => store.temporal.getState();
  const line = () => state().panel.lines.find((candidate) => candidate.id === LINE_ID);
  const historySize = () => [history().pastStates.length, history().futureStates.length];
  const lastToast = () => state().toasts.at(-1);

  function routeInput() {
    const s = state();
    return {
      panel: s.panel, devices: s.devices, rooms: s.rooms,
      partitions: s.freePartitions, nodes: s.nodes, walls: s.walls, settings: s.settings,
    };
  }
  function storeRoute() {
    const s = state();
    return computeLineRoutes({
      panel: s.panel, devices: s.devices, rooms: s.rooms, partitions: s.freePartitions,
      nodes: s.nodes, walls: s.walls, settings: s.settings,
    }).get(LINE_ID);
  }
  function baseRoute() {
    const route = materializeRouteForLine(routeInput(), LINE_ID);
    assert.ok(route, 'materialized base route must exist');
    return route;
  }
  function loadFresh(f) {
    state().loadProject(snapshot(f));
    assert.ok(state().panel);
    assert.deepEqual(historySize(), [0, 0]);
  }
  function degreeOf(route, idx) {
    const neighbors = new Set();
    for (const path of route.paths) {
      for (let i = 0; i < path.length; i++) {
        if (path[i] !== idx) continue;
        if (i > 0) neighbors.add(path[i - 1]);
        if (i < path.length - 1) neighbors.add(path[i + 1]);
      }
    }
    return neighbors.size;
  }
  function orientation(a, b) {
    if (Math.abs(a.y - b.y) <= EPS) return 'h';
    if (Math.abs(a.x - b.x) <= EPS) return 'v';
    return 's';
  }
  function findSlantedSegment(route) {
    for (let pathIndex = 0; pathIndex < route.paths.length; pathIndex++) {
      const path = route.paths[pathIndex];
      for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex++) {
        const start = route.nodes[path[segmentIndex]];
        const end = route.nodes[path[segmentIndex + 1]];
        if (orientation(start, end) === 's') {
          return { pathIndex, segmentIndex, start, end };
        }
      }
    }
    return null;
  }
  function findLongestSlantedSegment(route) {
    let best = null;
    for (let pathIndex = 0; pathIndex < route.paths.length; pathIndex++) {
      const path = route.paths[pathIndex];
      for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex++) {
        const start = route.nodes[path[segmentIndex]];
        const end = route.nodes[path[segmentIndex + 1]];
        if (orientation(start, end) !== 's') continue;
        const length = span(start, end);
        if (!best || length > best.length) {
          best = { pathIndex, segmentIndex, start, end, length };
        }
      }
    }
    return best;
  }
  function findNodeIndex(route, point) {
    return route.nodes.findIndex((candidate) => span(candidate, point) <= 0.5);
  }
  function findCorner(route) {
    const anchors = new Set(route.anchors.map((anchor) => anchor.nodeIndex));
    const endpoints = new Set();
    for (const path of route.paths) {
      endpoints.add(path[0]);
      endpoints.add(path[path.length - 1]);
    }
    for (let i = 0; i < route.nodes.length; i++) {
      if (anchors.has(i) || endpoints.has(i) || degreeOf(route, i) !== 2) continue;
      const neighbors = [];
      for (const path of route.paths) {
        const pos = path.indexOf(i);
        if (pos < 0) continue;
        if (pos > 0) neighbors.push(route.nodes[path[pos - 1]]);
        if (pos < path.length - 1) neighbors.push(route.nodes[path[pos + 1]]);
      }
      const kinds = new Set(neighbors.map((point) => orientation(route.nodes[i], point)));
      if (kinds.size === 2 && kinds.has('h') && kinds.has('v')) return i;
    }
    return -1;
  }

  await test('store move: freely moves only the selected corner, one undo step', () => {
    loadFresh(rectangle);
    const automatic = storeRoute();
    const base = baseRoute();
    const corner = findCorner(base);
    assert.ok(corner >= 0, 'rectangle route has a movable corner');
    const origin = base.nodes[corner];
    const panelBefore = clone(state().panel);
    const deviceBefore = clone(state().devices);
    const candidates = [
      { x: 400, y: 300 },
      { x: -400, y: 300 },
      { x: 300, y: -300 },
      { x: -300, y: -300 },
    ];
    let delta = null;
    let newIndex = null;
    for (const candidate of candidates) {
      const before = clone(state().panel);
      const result = state().moveLineRouteNode(LINE_ID, corner, {
        x: origin.x + candidate.x,
        y: origin.y + candidate.y,
      });
      if (line().manualRoute) {
        delta = candidate;
        newIndex = result;
        break;
      }
      assert.equal(result, null, 'refused move reports null');
      assert.deepEqual(state().panel, before, 'refused move leaves panel intact');
    }
    assert.ok(delta !== null, 'at least one free 2D move is valid');
    assert.equal(history().pastStates.length, 1, 'one history entry per committed move');
    const manual = line().manualRoute;
    assert.equal(validateManualRoute(manual), null);
    assert.equal(isManualRouteOrthogonal(manual), true);
    assert.ok(Number.isInteger(newIndex), 'store returns the moved vertex index');
    near(manual.nodes[newIndex].x, origin.x + delta.x, 'moved corner x');
    near(manual.nodes[newIndex].y, origin.y + delta.y, 'moved corner y');
    assert.ok((manual.bendNodes ?? []).length > 0, 'drag adds service bends');
    assert.equal(
      manual.bendNodes.includes(newIndex),
      false,
      'the moved point itself stays editable'
    );
    assert.equal(
      manual.nodes.length - manual.bendNodes.length,
      base.nodes.length,
      'service bends do not add editable points'
    );
    assert.equal(
      manual.nodes.some((point) => span(point, origin) <= EPS),
      false,
      'old corner position is gone'
    );
    base.nodes.forEach((point, index) => {
      if (index === corner) return;
      assert.ok(
        pointOnRoute(manual, point),
        `neighbour ${index} keeps its position on the route`
      );
    });
    assert.deepEqual(state().devices, deviceBefore, 'devices are not moved');
    assert.deepEqual(
      state().panel.anchor,
      panelBefore.anchor,
      'panel position is untouched'
    );
    const preview = storeRoute();
    assert.equal(preview.warning, null);
    near(preview.planLengthMm, manualRouteLength(manual), 'route uses manual geometry');
    const manualCopy = clone(manual);
    history().undo();
    assert.equal(line().manualRoute, undefined, 'undo removes materialized route');
    assert.deepEqual(storeRoute(), automatic, 'undo restores exact auto route');
    history().redo();
    assert.deepEqual(line().manualRoute, manualCopy, 'redo restores manual route');
  });

  await test('store move: anchored panel vertex is refused without history', () => {
    loadFresh(rectangle);
    const base = baseRoute();
    const panelIndex = base.anchors.find((anchor) => anchor.kind === 'panel')?.nodeIndex;
    assert.ok(panelIndex !== undefined, 'panel anchor index is known');
    const before = clone(state().panel);
    const counts = historySize();
    const result = state().moveLineRouteNode(LINE_ID, panelIndex, {
      x: base.nodes[panelIndex].x + 300,
      y: base.nodes[panelIndex].y,
    });
    assert.equal(result, null);
    assert.deepEqual(state().panel, before);
    assert.deepEqual(historySize(), counts);
    assert.match(lastToast()?.message ?? '', /закреплена/);
  });

  await test('store insert: splits a slanted segment of the acute/obtuse fixture', () => {
    loadFresh(parallelogram);
    const base = baseRoute();
    const slanted = findSlantedSegment(base);
    assert.ok(slanted, 'fixture really has a slanted segment');
    const { pathIndex, segmentIndex, start, end } = slanted;
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const beforeLength = manualRouteLength(base);
    state().insertLineRouteNode(LINE_ID, pathIndex, segmentIndex, middle, 10);
    const manual = line().manualRoute;
    assert.ok(manual, 'insert materializes the manual route');
    assert.equal(history().pastStates.length, 1);
    assert.equal(manual.nodes.length, base.nodes.length + 1);
    assert.equal(validateManualRoute(manual), null);
    near(manualRouteLength(manual), beforeLength, 'insertion keeps length', 0.01);
    assert.ok(manual.nodes.some((point) => span(point, middle) <= 0.5), 'projected point stored');
    const middleIndex = findNodeIndex(manual, middle);
    assert.ok(middleIndex >= 0, 'projected vertex is stored');
    let pathUsers = 0;
    base.paths.forEach((basePath, pathIndex) => {
      const usesEdge = basePath.some((_, i) => i > 0 && (
        (span(base.nodes[basePath[i - 1]], start) <= EPS
          && span(base.nodes[basePath[i]], end) <= EPS)
        || (span(base.nodes[basePath[i - 1]], end) <= EPS
          && span(base.nodes[basePath[i]], start) <= EPS)
      ));
      if (!usesEdge) return;
      pathUsers += 1;
      const candidate = manual.paths[pathIndex];
      assert.ok(candidate?.includes(middleIndex), 'path using the edge receives the vertex');
      const position = candidate.indexOf(middleIndex);
      assert.ok(position > 0 && position < candidate.length - 1, 'new vertex is internal');
    });
    assert.ok(pathUsers >= 1, 'slanted edge is used by at least one path');
    history().undo();
    assert.equal(line().manualRoute, undefined);
  });

  await test('store insert: click away from the line is refused silently in geometry', () => {
    loadFresh(parallelogram);
    const base = baseRoute();
    const path = base.paths[0];
    const start = base.nodes[path[0]];
    const end = base.nodes[path[1]];
    const length = span(start, end);
    const perpendicular = {
      x: (start.x + end.x) / 2 + ((end.y - start.y) / length) * 200,
      y: (start.y + end.y) / 2 - ((end.x - start.x) / length) * 200,
    };
    const before = clone(state().panel);
    const counts = historySize();
    state().insertLineRouteNode(LINE_ID, 0, 0, perpendicular, 10);
    assert.deepEqual(state().panel, before);
    assert.deepEqual(historySize(), counts);
    assert.match(lastToast()?.message ?? '', /только на линии/);
  });

  await test('store remove: straight inserted point and corner both rebuild locally', () => {
    loadFresh(parallelogram);
    const base = baseRoute();
    // Longest slanted edge exposes rounding drift of the projection (browser case).
    const slanted = findLongestSlantedSegment(base);
    assert.ok(slanted, 'fixture really has a slanted segment');
    const middle = {
      x: (slanted.start.x + slanted.end.x) / 2,
      y: (slanted.start.y + slanted.end.y) / 2,
    };
    state().insertLineRouteNode(
      LINE_ID,
      slanted.pathIndex,
      slanted.segmentIndex,
      middle,
      10
    );
    assert.equal(line().manualRoute.nodes.length, base.nodes.length + 1);
    assert.equal(history().pastStates.length, 1);
    const insertedIndex = findNodeIndex(line().manualRoute, middle);
    assert.ok(insertedIndex >= 0, 'inserted vertex is found by coordinates');
    assert.equal(state().removeLineRouteNode(LINE_ID, insertedIndex), true);
    assert.doesNotMatch(
      lastToast()?.message ?? '',
      /нельзя удалить|диагональ/,
      'straight slanted point must not be reported as a corner'
    );
    assert.equal(history().pastStates.length, 2, 'removal is one more undo step');
    const afterSlanted = line().manualRoute;
    const slantedBends = new Set(afterSlanted.bendNodes ?? []);
    assert.equal(
      afterSlanted.nodes.length - slantedBends.size,
      base.nodes.length,
      'only the inserted visible point disappeared'
    );
    assert.equal(slantedBends.size, 1, 'diagonal was replaced by a hidden step');
    assert.equal(validateManualRoute(afterSlanted), null);
    assert.equal(
      afterSlanted.nodes.some(
        (point, index) => !slantedBends.has(index) && span(point, middle) <= 0.5
      ),
      false,
      'inserted visible point is gone'
    );

    loadFresh(rectangle);
    const rectangleBase = baseRoute();
    const corner = findCorner(rectangleBase);
    assert.ok(corner >= 0, 'rectangle has an L-corner');
    const cornerPoint = clone(rectangleBase.nodes[corner]);
    const counts = historySize();
    assert.equal(state().removeLineRouteNode(LINE_ID, corner), true);
    assert.equal(history().pastStates.length, counts[0] + 1, 'removal is one undo step');
    const rectangleManual = line().manualRoute;
    assert.ok(rectangleManual);
    assert.equal(validateManualRoute(rectangleManual), null);
    const rectangleBends = new Set(rectangleManual.bendNodes ?? []);
    assert.equal(
      rectangleManual.nodes.some(
        (point, index) => !rectangleBends.has(index) && span(point, cornerPoint) <= 0.5
      ),
      false,
      'deleted visible corner is gone'
    );
    const pointsOf = (route, path) => path.map((index) => route.nodes[index]);
    for (const basePath of rectangleBase.paths.filter((path) => !path.includes(corner))) {
      const expected = pointsOf(rectangleBase, basePath);
      assert.ok(
        rectangleManual.paths.some((candidate) => {
          const actual = pointsOf(rectangleManual, candidate);
          return (
            actual.length === expected.length &&
            actual.every((point, index) => span(point, expected[index]) <= 0.5)
          );
        }),
        'paths without the deleted point are untouched'
      );
    }
    assert.doesNotMatch(lastToast()?.message ?? '', /нельзя удалить|диагональ/);
    history().undo();
    assert.equal(line().manualRoute, undefined, 'undo returns to the exact auto route');
  });

  await test('store remove: deleting a dragged point collapses only its service bends', () => {
    loadFresh(rectangle);
    const base = baseRoute();
    const corner = findCorner(base);
    assert.ok(corner >= 0, 'rectangle has a movable corner');
    let newIndex = null;
    for (const delta of [300, -300]) {
      newIndex = state().moveLineRouteNode(LINE_ID, corner, {
        x: base.nodes[corner].x + delta,
        y: base.nodes[corner].y,
      });
      if (line().manualRoute) break;
    }
    assert.ok(line().manualRoute, 'move produced a manual route');
    assert.ok(newIndex !== null, 'store returned the moved point');
    const manualBefore = line().manualRoute;
    assert.ok((manualBefore.bendNodes ?? []).length > 0, 'move produced service bends');
    assert.equal(
      manualBefore.nodes.length - manualBefore.bendNodes.length,
      base.nodes.length,
      'drag created no editable points'
    );
    const movedPoint = clone(manualBefore.nodes[newIndex]);
    const beforeHistory = historySize()[0];
    assert.equal(state().removeLineRouteNode(LINE_ID, newIndex), true);
    const manual = line().manualRoute;
    assert.ok(manual);
    assert.equal(history().pastStates.length, beforeHistory + 1, 'one more undo step');
    assert.equal(validateManualRoute(manual), null);
    const afterBends = new Set(manual.bendNodes ?? []);
    assert.equal(afterBends.size, 1, 'one orthogonal step remains instead of the moved point');
    assert.equal(
      manual.nodes.length - afterBends.size,
      base.nodes.length - 1,
      'one visible point fewer'
    );
    assert.equal(
      manual.nodes.some(
        (point, index) => !afterBends.has(index) && span(point, movedPoint) <= 0.5
      ),
      false,
      'moved point is gone'
    );
    assert.ok(
      manualRouteAnchorNode(manual, 'panel') !== null,
      'panel anchor survived the local rebuild'
    );
    assert.ok(
      manualRouteAnchorNode(manual, 'device', 'test-socket') !== null,
      'device anchor survived the local rebuild'
    );
  });

  await test('store reset: manual route and legacy waypoints return to auto with undo', () => {
    loadFresh(rectangle);
    const automatic = storeRoute();
    const base = baseRoute();
    const corner = findCorner(base);
    state().moveLineRouteNode(LINE_ID, corner, {
      x: base.nodes[corner].x + 300,
      y: base.nodes[corner].y,
    });
    assert.ok(line().manualRoute);
    state().addLineWaypoint(LINE_ID, { x: 1000, y: 1000 });
    const manualCopy = clone(line().manualRoute);
    const waypointsCopy = clone(line().waypoints);
    state().resetLineRoute(LINE_ID);
    assert.equal(line().manualRoute, undefined);
    assert.equal(line().waypoints, undefined);
    assert.deepEqual(storeRoute(), automatic, 'reset restores exact auto route');
    assert.match(lastToast()?.message ?? '', /сброшена/);
    history().undo();
    assert.deepEqual(line().manualRoute, manualCopy);
    assert.deepEqual(line().waypoints, waypointsCopy);
  });

  await test('store: invalid line/vertex identifiers are no-ops without history', () => {
    loadFresh(rectangle);
    const before = clone(state().panel);
    const counts = historySize();
    assert.equal(state().moveLineRouteNode('missing-line', 0, { x: 10, y: 10 }), null);
    state().insertLineRouteNode('missing-line', 0, 0, { x: 10, y: 10 }, 10);
    assert.equal(state().removeLineRouteNode('missing-line', 0), false);
    state().resetLineRoute(LINE_ID);
    for (const index of [-1, 500]) {
      assert.equal(state().moveLineRouteNode(LINE_ID, index, { x: 10, y: 10 }), null);
      assert.equal(state().removeLineRouteNode(LINE_ID, index), false);
    }
    assert.deepEqual(state().panel, before);
    assert.deepEqual(historySize(), counts);
  });

  await test('store reorder: moving a stop rebuilds the branch, one undo step', () => {
    for (const fixture of [rectangle, parallelogram]) {
      loadFresh(fixture);
      const base = baseRoute();
      const branches = manualRouteBranches(base);
      let branchIndex = 0;
      branches.forEach((candidate, index) => {
        if (candidate.stops.length > branches[branchIndex].stops.length) branchIndex = index;
      });
      const branch = branches[branchIndex];
      assert.ok(branch.stops.length >= 3, 'fixture branch has stops to reorder');
      const to = branch.stops[0].kind === 'panel' ? 1 : 0;
      const from = branch.stops.length - 1;
      assert.notEqual(branch.stops[from].kind, 'panel', 'the last stop is movable');
      const expected = branch.stops.map((stop) => clone(base.nodes[stop.nodeIndex]));
      const [movedPoint] = expected.splice(from, 1);
      expected.splice(to, 0, movedPoint);
      const devicesBefore = clone(state().devices);
      const panelAnchorBefore = clone(state().panel.anchor);
      const counts = historySize();

      assert.equal(
        state().reorderLineRouteStops(LINE_ID, branchIndex, from, to),
        true
      );
      const manual = line().manualRoute;
      assert.ok(manual, 'reorder materializes the manual route');
      assert.equal(validateManualRoute(manual), null);
      assert.equal(isManualRouteOrthogonal(manual), true, 'rebuilt branch is orthogonal');
      assert.equal(history().pastStates.length, counts[0] + 1, 'one undo step');
      assert.deepEqual(state().devices, devicesBefore, 'devices are not moved');
      assert.deepEqual(state().panel.anchor, panelAnchorBefore, 'panel is not moved');

      const after = manualRouteBranches(manual)[branchIndex];
      assert.ok(after, 'the edited branch is still listed');
      assert.equal(after.stops.length, expected.length, 'no stop is lost or added');
      after.stops.forEach((stop, index) => {
        const point = manual.nodes[stop.nodeIndex];
        assert.ok(
          span(point, expected[index]) <= 0.5,
          `stop ${index} follows the new list order`
        );
      });
      for (const other of branches.filter((_, index) => index !== branchIndex)) {
        const expectedPoints = other.stops.map((stop) => base.nodes[stop.nodeIndex]);
        assert.ok(
          manualRouteBranches(manual).some((candidate) => {
            const points = candidate.stops.map((stop) => manual.nodes[stop.nodeIndex]);
            return (
              points.length === expectedPoints.length &&
              points.every((point, index) => span(point, expectedPoints[index]) <= 0.5)
            );
          }),
          'other branches keep their stops'
        );
      }
      assert.ok(manualRouteAnchorNode(manual, 'panel') !== null, 'panel anchor survived');
      assert.ok(
        manualRouteAnchorNode(manual, 'device', 'test-socket') !== null,
        'device anchor survived'
      );
      history().undo();
      assert.equal(line().manualRoute, undefined, 'undo returns to the auto route');
    }
  });

  await test('store reorder: the panel stays first and refusals leave no history', () => {
    loadFresh(rectangle);
    const base = baseRoute();
    const branches = manualRouteBranches(base);
    const branchIndex = branches.findIndex(
      (candidate) => candidate.stops[0]?.kind === 'panel'
    );
    assert.ok(branchIndex >= 0, 'fixture has a branch starting at the panel');
    const branch = branches[branchIndex];
    const before = clone(state().panel);
    const counts = historySize();
    assert.equal(
      state().reorderLineRouteStops(LINE_ID, branchIndex, 0, branch.stops.length - 1),
      false
    );
    assert.match(lastToast()?.message ?? '', /Щиток/);
    assert.equal(
      state().reorderLineRouteStops(LINE_ID, branchIndex, branch.stops.length - 1, 0),
      false
    );
    assert.deepEqual(state().panel, before, 'refused reorder changes nothing');
    assert.deepEqual(historySize(), counts);
  });

  await test('store reorder: invalid identifiers and no-op moves are silent', () => {
    loadFresh(rectangle);
    const before = clone(state().panel);
    const counts = historySize();
    assert.equal(state().reorderLineRouteStops('missing-line', 0, 1, 2), false);
    assert.equal(state().reorderLineRouteStops(LINE_ID, 99, 1, 2), false);
    assert.equal(state().reorderLineRouteStops(LINE_ID, 0, 99, 2), false);
    assert.equal(state().reorderLineRouteStops(LINE_ID, 0, 1, 1), false);
    assert.deepEqual(state().panel, before);
    assert.deepEqual(historySize(), counts);
  });

  await test('persistence: manual route is exported, sanitized and auto-saved', async () => {
    loadFresh(rectangle);
    const base = baseRoute();
    const corner = findCorner(base);
    let moved = false;
    for (const delta of [300, -300]) {
      state().moveLineRouteNode(LINE_ID, corner, {
        x: base.nodes[corner].x + delta,
        y: base.nodes[corner].y,
      });
      if (line().manualRoute) { moved = true; break; }
    }
    assert.equal(moved, true);
    const expected = clone(line().manualRoute);
    const exported = jsonClone(getProjectSnapshot());
    assert.equal(isProjectSnapshot(exported), true);
    assert.deepEqual(exported.panel.lines[0].manualRoute, expected);
    assert.equal(Object.hasOwn(exported.panel.lines[0], 'waypoints'), false);
    for (const key of ['routeEditLineId', 'lineAssignLineId', 'highlightedLineId', 'temporal']) {
      assert.equal(Object.hasOwn(exported, key), false, `${key} is not persisted`);
    }
    state().loadProject(exported);
    assert.deepEqual(line().manualRoute, expected);
    assert.deepEqual(historySize(), [0, 0]);

    const written = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        saveWaiters.delete(notify);
        reject(new Error('Autosave did not write within 3 seconds'));
      }, 3000);
      function notify(key, value) {
        if (key !== STORAGE_KEY) return;
        clearTimeout(timeout);
        saveWaiters.delete(notify);
        resolve(JSON.parse(value));
      }
      saveWaiters.add(notify);
    });
    state().moveLineRouteNode(LINE_ID, corner, {
      x: base.nodes[corner].x + 300,
      y: base.nodes[corner].y,
    });
    const data = await written;
    assert.equal(isProjectSnapshot(data), true);
    assert.ok(data.panel.lines[0].manualRoute, 'autosave contains the manual route');
    assert.equal(saved.get(STORAGE_KEY), JSON.stringify(data));
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

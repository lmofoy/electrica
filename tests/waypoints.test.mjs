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

// Never touch real user storage. Keep the shim for this Node process's lifetime,
// including any pending store toast/autosave timers.
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
  const { computeLineRoutes, PANEL_CABLE_RESERVE_MM } =
    await server.ssrLoadModule('/src/core/electrical/routing.ts');
  const { buildAutoLayout } = await server.ssrLoadModule('/src/core/geometry/autoLayout.ts');
  const { createEmptyPanel, createLine, resolvePanelPose, sanitizePanel } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { resolveDevice } = await server.ssrLoadModule('/src/core/electrical/devices.ts');
  const { useProjectStore: store, getProjectSnapshot, isProjectSnapshot } =
    await server.ssrLoadModule('/src/store/useProjectStore.ts');

  function fixture(skew, reverse) {
    const vertices = [
      { x: 0, y: 0 }, { x: 4000, y: 0 },
      { x: 4000 + skew, y: 3000 }, { x: skew, y: 3000 },
    ];
    const ring = reverse ? [...vertices].reverse() : vertices;
    const room = {
      id: ROOM_ID, name: 'Waypoint test', type: 'living', nodeIds: [],
      vertices: ring, holes: [], color: '#888888', wallThicknessMm: 120,
    };
    const layout = buildAutoLayout([room], [], [], [], settings.defaultWallThicknessMm);
    // Keep identical physical anchors under reversed winding.
    function anchor(edge, fraction) {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % vertices.length];
      const edgeIndex = ring.findIndex((p, i) => {
        const q = ring[(i + 1) % ring.length];
        return (p === a && q === b) || (p === b && q === a);
      });
      assert.ok(edgeIndex >= 0);
      return {
        kind: 'room_edge', roomId: ROOM_ID, edgeIndex,
        offsetMm: span(a, b) * (reverse ? 1 - fraction : fraction),
      };
    }
    function expectedOnEdge(edge, fraction) {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % vertices.length];
      return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
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
    const input = {
      panel, devices: [device], rooms: [room], partitions: [],
      nodes: layout.nodes, walls: layout.walls, settings: { ...settings },
    };
    const interior = (u, v) => ({ x: 4000 * u + skew * v, y: 3000 * v });
    return {
      input, layout, vertices: ring,
      panelPoint: expectedOnEdge(3, 0.37), devicePoint: expectedOnEdge(1, 0.61),
      waypoints: [interior(0.7231, 0.7137), interior(0.2163, 0.2317), interior(0.6367, 0.4761)],
      light: {
        id: 'test-light', type: 'light_ceiling', name: 'Ceiling light',
        anchor: { kind: 'room_point', roomId: ROOM_ID, ...interior(0.1, 0.8) },
        // Intentionally not ceiling height: verify the ceiling-device override.
        heightFromFloorMm: 100, powerWatts: 50, shared: false,
      },
    };
  }
  function withWaypoints(input, waypoints) {
    const next = clone(input);
    if (waypoints === undefined) delete next.panel.lines[0].waypoints;
    else next.panel.lines[0].waypoints = clone(waypoints);
    return next;
  }
  function route(input) {
    const before = clone(input);
    const routes = computeLineRoutes(input);
    assert.deepEqual(input, before, 'routing must not mutate inputs');
    assert.equal(routes.size, input.panel.lines.length);
    const result = routes.get(LINE_ID);
    assert.ok(result, 'line route must exist');
    return result;
  }
  function assertMetrics(result, input) {
    const line = input.panel.lines[0];
    const mode = line.routing ?? input.settings.defaultRouting;
    assert.equal(result.lineId, LINE_ID);
    assert.equal(result.mode, mode);
    const devices = input.devices.filter((d) => line.deviceIds.includes(d.id));
    assert.equal(result.deviceCount, devices.length);
    let sum = 0;
    for (const path of result.paths) {
      assert.ok(path.length >= 2, 'no degenerate polylines');
      for (const p of path) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'finite coordinates');
      for (let i = 1; i < path.length; i++) {
        assert.ok(span(path[i - 1], path[i]) > 0, 'no duplicate adjacent vertices');
        sum += span(path[i - 1], path[i]);
      }
    }
    near(result.planLengthMm, sum, 'sum of actual polyline lengths');
    if (devices.length === 0) {
      assert.deepEqual(result.paths, []);
      assert.equal(result.verticalMm, 0);
      assert.equal(result.cableLengthMm, 0);
      assert.equal(result.warning, null);
      return;
    }
    assert.ok(result.paths.length > 0);
    const runHeight = mode === 'ceiling' ? input.settings.ceilingHeightMm : input.settings.floorLevelMm;
    const vertical = Math.abs(input.panel.heightFromFloorMm - runHeight) + devices.reduce((total, d) =>
      total + Math.abs((d.type === 'light_ceiling' ? input.settings.ceilingHeightMm : d.heightFromFloorMm) - runHeight), 0);
    near(result.verticalMm, vertical, 'panel and device vertical runs');
    assert.equal(PANEL_CABLE_RESERVE_MM, 1500);
    near(result.cableLengthMm,
      (sum + vertical) * (1 + Math.max(0, input.settings.cableMarginPercent) / 100) + 1500,
      'vertical, margin, and panel reserve formula');
  }
  function assertOrderedPrefix(result, panelPoint, waypoints) {
    let from = panelPoint;
    let index = 0;
    for (const waypoint of waypoints) {
      if (span(from, waypoint) <= EPS) continue;
      const path = result.paths[index++];
      assert.ok(path, 'each nonzero waypoint leg has a path');
      pointNear(path[0], from, 'ordered waypoint leg start');
      // Literal endpoints, not just proximity to a segment or wall projection.
      assert.deepEqual(path.at(-1), waypoint, 'literal ordered waypoint endpoint');
      for (let i = 1; i < path.length; i++) {
        assert.ok(Math.abs(path[i].x - path[i - 1].x) < EPS ||
          Math.abs(path[i].y - path[i - 1].y) < EPS, 'manual leg is orthogonal');
      }
      from = waypoint;
    }
    assert.ok(result.paths.length > index, 'devices come after the waypoint prefix');
    pointNear(result.paths[index][0], from, 'device chain starts at final waypoint');
    return index;
  }

  for (const skew of [0, 1500]) {
    for (const reverse of [false, true]) {
      const label = `${skew ? 'acute/obtuse parallelogram' : 'rectangle'} / ${reverse ? 'reverse' : 'forward'} winding`;
      let f;
      await test(`${label}: real geometry and wall anchors`, () => {
        f = fixture(skew, reverse);
        const ring = f.vertices;
        const area2 = ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length];
          return sum + p.x * q.y - q.x * p.y;
        }, 0);
        near(area2, (reverse ? -1 : 1) * 24000000, 'signed area and winding');
        const angles = ring.map((p, i) => {
          const a = ring[(i + ring.length - 1) % ring.length];
          const b = ring[(i + 1) % ring.length];
          const cosine = ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) /
            (span(a, p) * span(b, p));
          return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
        });
        near(angles.reduce((a, b) => a + b, 0), 360, 'interior angle sum');
        if (skew) {
          assert.equal(angles.filter((a) => a < 90 - EPS).length, 2, 'two genuinely acute angles');
          assert.equal(angles.filter((a) => a > 90 + EPS).length, 2, 'two genuinely obtuse angles');
          near(Math.min(...angles), Math.atan2(3000, 1500) * 180 / Math.PI, 'acute angle');
        } else angles.forEach((a) => near(a, 90, 'rectangle angle'));
        assert.equal(f.layout.isConnected, true);
        near(f.layout.totalFloorAreaM2, 12, 'auto-layout floor area');
        assert.equal(f.input.walls.length, 4);
        assert.ok(Object.keys(f.input.nodes).length >= 4);
        for (const wall of f.input.walls) {
          const a = f.input.nodes[wall.nodeAId];
          const b = f.input.nodes[wall.nodeBId];
          assert.ok(a && b && span(a, b) > 0, 'real nonzero auto-layout walls');
        }
        const panelPose = resolvePanelPose(f.input.panel, f.input.rooms, [], 120);
        const devicePose = resolveDevice(f.input.devices[0], f.input.rooms, [], 120)?.poses[0];
        pointNear(panelPose?.position, f.panelPoint, 'independent panel interpolation');
        pointNear(devicePose?.position, f.devicePoint, 'independent device interpolation');
        if (skew) {
          for (const anchor of [f.input.panel.anchor, f.input.devices[0].anchor]) {
            const a = ring[anchor.edgeIndex];
            const b = ring[(anchor.edgeIndex + 1) % ring.length];
            assert.ok(a.x !== b.x && a.y !== b.y, 'panel AND device on tilted walls');
          }
          for (const pose of [panelPose, devicePose]) {
            assert.ok(Math.abs(pose.rotationDeg / 90 - Math.round(pose.rotationDeg / 90)) > 0.01);
          }
        }
      });
      if (!f) continue;
      for (const noGraph of [false, true]) {
        const input = clone(f.input);
        if (noGraph) { input.nodes = {}; input.walls = []; }
        const tag = `${label} / ${noGraph ? 'no graph' : 'auto graph'}`;
        await test(`${tag}: optional/empty waypoints preserve auto route`, () => {
          const automatic = route(withWaypoints(input, undefined));
          assertMetrics(automatic, input);
          assert.deepEqual(route(withWaypoints(input, [])), automatic);
          if (noGraph) assert.match(automatic.warning, /Нет графа стен/);
          else assert.equal(automatic.warning, null, 'connected graph needs no fallback warning');
        });
        for (const [name, points] of [
          ['single literal waypoint', f.waypoints.slice(0, 1)],
          ['ordered zigzag waypoints', f.waypoints],
          ['reversed waypoint order', [...f.waypoints].reverse()],
          ['duplicates including panel and revisited point',
            [f.panelPoint, f.waypoints[0], f.waypoints[0], f.waypoints[1], f.waypoints[1], f.waypoints[0]]],
        ]) {
          await test(`${tag}: ${name}`, () => {
            const manual = withWaypoints(input, points);
            const result = route(manual);
            assertMetrics(result, manual);
            assertOrderedPrefix(result, f.panelPoint, points);
            pointNear(result.paths.at(-1).at(-1), f.devicePoint, 'route reaches wall device');
            if (noGraph) assert.match(result.warning, /Нет графа стен/);
            else assert.equal(result.warning, null);
          });
        }
        await test(`${tag}: empty devices mean zero route, even with waypoints`, () => {
          const empty = withWaypoints(input, f.waypoints);
          empty.devices = [];
          empty.panel.lines[0].deviceIds = [];
          assertMetrics(route(empty), empty);
          empty.panel.lines[0].deviceIds = ['missing-device'];
          assertMetrics(route(empty), empty);
        });
        await test(`${tag}: non-finite waypoint coordinates are ignored`, () => {
          const dirty = [f.waypoints[0], { x: NaN, y: 1 }, { x: 1, y: Infinity }, f.waypoints[1]];
          assert.deepEqual(route(withWaypoints(input, dirty)),
            route(withWaypoints(input, f.waypoints.slice(0, 2))));
        });
      }
    }
  }

  const base = fixture(1500, false);
  for (const [mode, override, margin] of [
    ['ceiling', undefined, 17.5], ['floor', undefined, 0],
    ['floor', 'ceiling', -10], ['ceiling', 'floor', 25],
  ]) {
    await test(`two devices: default ${mode}, override ${override ?? 'none'}, margin ${margin}%`, () => {
      const input = withWaypoints(base.input, base.waypoints);
      input.devices.push(clone(base.light));
      input.panel.lines[0].deviceIds.push(base.light.id);
      input.panel.lines[0].routing = override;
      Object.assign(input.settings, { defaultRouting: mode, cableMarginPercent: margin });
      const result = route(input);
      assertMetrics(result, input);
      const prefix = assertOrderedPrefix(result, base.panelPoint, base.waypoints);
      const endpoints = result.paths.slice(prefix).map((path) => path.at(-1));
      const lightPoint = { x: base.light.anchor.x, y: base.light.anchor.y };
      const socketIndex = endpoints.findIndex((p) => span(p, base.devicePoint) < EPS);
      const lightIndex = endpoints.findIndex((p) => span(p, lightPoint) < EPS);
      assert.ok(socketIndex >= 0 && lightIndex >= 0, 'both device endpoints reached');
      assert.ok(span(base.panelPoint, lightPoint) < span(base.panelPoint, base.devicePoint));
      assert.ok(span(base.waypoints.at(-1), base.devicePoint) < span(base.waypoints.at(-1), lightPoint));
      assert.ok(socketIndex < lightIndex, 'nearest device chosen from LAST waypoint, not panel');
    });
  }

  function snapshot(f, mode = 'auto') {
    return {
      version: 1, savedAt: new Date(0).toISOString(), boundaryMode: mode,
      settings: clone(f.input.settings), apartment: clone(f.layout.apartment),
      rooms: clone(f.input.rooms), nodes: clone(f.input.nodes), walls: clone(f.input.walls),
      openings: [], freePartitions: [], shafts: [],
      devices: clone(f.input.devices), panel: clone(f.input.panel),
    };
  }
  const state = () => store.getState();
  const history = () => store.temporal.getState();
  const line = () => state().panel.lines.find((candidate) => candidate.id === LINE_ID);
  const historySize = () => [history().pastStates.length, history().futureStates.length];
  function storeRoute() {
    const s = state();
    return route({ panel: s.panel, devices: s.devices, rooms: s.rooms,
      nodes: s.nodes, walls: s.walls, partitions: s.freePartitions, settings: s.settings });
  }
  function loadFresh(mode = 'auto') {
    state().loadProject(snapshot(base, mode));
    assert.ok(state().panel);
    assert.deepEqual(historySize(), [0, 0]);
  }
  function assertUndoable(action, expectedPoints) {
    const before = clone(state().panel);
    const beforeRoute = storeRoute();
    const count = history().pastStates.length;
    action();
    assert.deepEqual(line().waypoints, expectedPoints);
    assert.equal(history().pastStates.length, count + 1, 'one history entry per action');
    const after = clone(state().panel);
    const afterRoute = storeRoute();
    history().undo();
    assert.deepEqual(state().panel, before, 'undo restores whole panel');
    assert.deepEqual(storeRoute(), beforeRoute, 'undo restores route');
    history().redo();
    assert.deepEqual(state().panel, after, 'redo restores whole panel');
    assert.deepEqual(storeRoute(), afterRoute, 'redo restores route');
  }
  await test('store: add/move/remove/clear undo and redo; removing returns to auto', () => {
    loadFresh();
    const automatic = storeRoute();
    const [a, b, c] = base.waypoints;
    const added = clone(a);
    assertUndoable(() => state().addLineWaypoint(LINE_ID, added), [a]);
    added.x += 999;
    assert.deepEqual(line().waypoints, [a], 'add copies coordinates');
    assertUndoable(() => state().addLineWaypoint(LINE_ID, b), [a, b]);
    const moved = clone(c);
    assertUndoable(() => state().moveLineWaypoint(LINE_ID, 0, moved), [c, b]);
    moved.y += 999;
    assert.deepEqual(line().waypoints, [c, b], 'move copies coordinates');
    assertUndoable(() => state().removeLineWaypoint(LINE_ID, 1), [c]);
    assertUndoable(() => state().removeLineWaypoint(LINE_ID, 0), undefined);
    assert.deepEqual(storeRoute(), automatic, 'remove last waypoint restores exact auto route');
    state().addLineWaypoint(LINE_ID, a);
    state().addLineWaypoint(LINE_ID, b);
    assertUndoable(() => state().clearLineWaypoints(LINE_ID), undefined);
    assert.deepEqual(storeRoute(), automatic, 'clear restores exact auto route');
  });
  await test('store: duplicate suppression and invalid IDs/indices are no-ops', () => {
    loadFresh();
    const [a, b] = base.waypoints;
    state().addLineWaypoint(LINE_ID, a);
    const before = clone(state().panel);
    const counts = historySize();
    state().addLineWaypoint(LINE_ID, a);
    state().addLineWaypoint(LINE_ID, { x: a.x + 0.5, y: a.y - 0.5 });
    state().moveLineWaypoint(LINE_ID, 0, a);
    state().addLineWaypoint('missing-line', b);
    state().moveLineWaypoint('missing-line', 0, b);
    state().removeLineWaypoint('missing-line', 0);
    state().clearLineWaypoints('missing-line');
    for (const index of [-1, 1, 100]) {
      state().moveLineWaypoint(LINE_ID, index, b);
      state().removeLineWaypoint(LINE_ID, index);
    }
    assert.deepEqual(state().panel, before);
    assert.deepEqual(historySize(), counts, 'no history for no-ops');
    state().addLineWaypoint(LINE_ID, b);
    state().addLineWaypoint(LINE_ID, a);
    assert.deepEqual(line().waypoints, [a, b, a], 'non-adjacent repeat preserved');
    state().clearLineWaypoints(LINE_ID);
    const clearedCount = historySize();
    state().clearLineWaypoints(LINE_ID);
    assert.deepEqual(historySize(), clearedCount);
    state().resetProject();
    state().addLineWaypoint(LINE_ID, a);
    state().moveLineWaypoint(LINE_ID, 0, a);
    state().removeLineWaypoint(LINE_ID, 0);
    state().clearLineWaypoints(LINE_ID);
    assert.equal(state().panel, null);
    assert.deepEqual(historySize(), [0, 0]);
  });
  await test('store: route edit is UI-only, exclusive with assignment, cleared on deletion/reset', () => {
    loadFresh();
    state().setLineAssignLine(LINE_ID);
    state().setRouteEditLine(LINE_ID);
    assert.equal(state().routeEditLineId, LINE_ID);
    assert.equal(state().lineAssignLineId, null);
    assert.equal(state().activeTool, 'select');
    assert.equal(state().highlightedLineId, LINE_ID);
    assert.deepEqual(historySize(), [0, 0], 'UI state is not undoable project data');
    state().addLineWaypoint(LINE_ID, base.waypoints[0]);
    state().setRouteEditLine(null);
    history().undo();
    assert.equal(line().waypoints, undefined);
    assert.equal(state().routeEditLineId, null, 'undo does not restore UI');
    history().redo();
    assert.equal(state().routeEditLineId, null, 'redo does not restore UI');
    state().setRouteEditLine(LINE_ID);
    state().setLineAssignLine(LINE_ID);
    assert.equal(state().routeEditLineId, null);
    state().setRouteEditLine('missing-line');
    assert.equal(state().routeEditLineId, null);
    state().setRouteEditLine(LINE_ID);
    state().deletePanelLine(LINE_ID);
    assert.equal(state().routeEditLineId, null);
    loadFresh();
    state().setRouteEditLine(LINE_ID);
    state().resetProject();
    assert.equal(state().routeEditLineId, null);
    assert.deepEqual(historySize(), [0, 0]);
  });
  await test('panel sanitation: malformed/non-finite/empty waypoints; copies and order', () => {
    const panel = clone(base.input.panel);
    const a = { ...base.waypoints[0], ignored: 'strip me' };
    const b = base.waypoints[1];
    panel.lines[0].waypoints = [a, null, undefined, {}, 'bad', { x: '1', y: 2 },
      { x: NaN, y: 1 }, { x: 2, y: -Infinity }, b, b];
    const before = clone(panel);
    const clean = sanitizePanel(panel, base.input.rooms, [], 120);
    assert.deepEqual(clean.lines[0].waypoints, [base.waypoints[0], b, b]);
    assert.deepEqual(panel, before, 'sanitation does not mutate input');
    assert.notEqual(clean.lines[0].waypoints[0], a);
    assert.notEqual(clean.lines[0].waypoints[1], clean.lines[0].waypoints[2]);
    for (const malformed of [undefined, null, [], {}, 'bad', [{ x: NaN, y: 0 }]]) {
      panel.lines[0].waypoints = malformed;
      assert.equal(sanitizePanel(panel, base.input.rooms, [], 120).lines[0].waypoints, undefined);
    }
  });
  for (const mode of ['auto', 'manual']) {
    await test(`persistence: ${mode} JSON snapshot/load roundtrip, sanitation, UI/history reset`, () => {
      loadFresh(mode);
      for (const point of base.waypoints) state().addLineWaypoint(LINE_ID, point);
      state().setRouteEditLine(LINE_ID);
      const expectedRoute = storeRoute();
      const exported = jsonClone(getProjectSnapshot());
      assert.equal(isProjectSnapshot(exported), true);
      assert.deepEqual(exported.panel.lines[0].waypoints, base.waypoints);
      for (const key of ['routeEditLineId', 'lineAssignLineId', 'highlightedLineId', 'temporal']) {
        assert.equal(Object.hasOwn(exported, key), false, `${key} is not persisted`);
      }
      state().loadProject(exported);
      assert.equal(state().boundaryMode, mode);
      assert.deepEqual(line().waypoints, base.waypoints);
      assert.deepEqual(storeRoute(), expectedRoute);
      assert.equal(state().routeEditLineId, null);
      assert.deepEqual(historySize(), [0, 0]);
      const reexported = jsonClone(getProjectSnapshot());
      delete exported.savedAt;
      delete reexported.savedAt;
      assert.deepEqual(reexported, exported, 'all serialized project data roundtrips');
      const dirty = snapshot(base, mode);
      dirty.panel.lines[0].waypoints = [base.waypoints[0], null, { x: '12', y: 5 },
        { x: Infinity, y: 3 }, base.waypoints[1]];
      state().loadProject(jsonClone(dirty));
      assert.deepEqual(line().waypoints, base.waypoints.slice(0, 2), 'load sanitizes malformed JSON');
      state().loadProject(snapshot(base, mode));
      assert.equal(line().waypoints, undefined, 'legacy snapshot stays automatic');
    });
  }
  await test('persistence: actual debounced autosave writes waypoint JSON to isolated storage', async () => {
    loadFresh();
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
    state().addLineWaypoint(LINE_ID, base.waypoints[0]);
    const data = await written;
    assert.equal(isProjectSnapshot(data), true);
    assert.deepEqual(data.panel.lines[0].waypoints, [base.waypoints[0]]);
    assert.equal(Object.hasOwn(data, 'routeEditLineId'), false);
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

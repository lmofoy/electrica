import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const EPS = 1e-6;
const LINE_ID = 'link-line';
const ROOM_ID = 'link-room';
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
const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clone = (value) => structuredClone(value);
const jsonClone = (value) => JSON.parse(JSON.stringify(value));
const settings = {
  defaultWallThicknessMm: 120,
  exteriorWallThicknessMm: 250,
  ceilingHeightMm: 2800,
  floorLevelMm: -150,
  cableMarginPercent: 17.5,
  defaultRouting: 'ceiling',
  showDimensions: true,
};

const saved = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => {
      saved.set(key, String(value));
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
    logLevel: 'error',
  });
  const { computeLineRoutes, materializeRouteForLine } =
    await server.ssrLoadModule('/src/core/electrical/routing.ts');
  const {
    isManualRouteOrthogonal,
    manualRouteAnchorNode,
    manualRouteConnectedDeviceIds,
    manualRouteLength,
    validateManualRoute,
  } = await server.ssrLoadModule('/src/core/electrical/manualRoute.ts');
  const { createEmptyPanel, createLine, resolvePanelPose } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { resolveDevice } = await server.ssrLoadModule(
    '/src/core/electrical/devices.ts'
  );
  const { buildAutoLayout } = await server.ssrLoadModule(
    '/src/core/geometry/autoLayout.ts'
  );
  const { useProjectStore: store, getProjectSnapshot, isProjectSnapshot } =
    await server.ssrLoadModule('/src/store/useProjectStore.ts');
  const { routeJunctionPlacementError } = await server.ssrLoadModule(
    '/src/core/electrical/routeLink.ts'
  );

  // Острый/тупой углы у комнаты: связи всё равно строятся под 90°.
  function fixture(skew) {
    const vertices = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000 + skew, y: 3000 },
      { x: skew, y: 3000 },
    ];
    const room = {
      id: ROOM_ID,
      name: 'Link test',
      type: 'living',
      nodeIds: [],
      vertices,
      holes: [],
      color: '#888888',
      wallThicknessMm: 120,
    };
    const layout = buildAutoLayout([room], [], [], settings.defaultWallThicknessMm);
    function anchor(edge, fraction) {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % vertices.length];
      return {
        kind: 'room_edge',
        roomId: ROOM_ID,
        edgeIndex: edge,
        offsetMm: span(a, b) * fraction,
      };
    }
    const devices = [
      {
        id: 'test-socket',
        type: 'socket_single',
        name: 'Socket A',
        anchor: anchor(1, 0.61),
        heightFromFloorMm: 350,
        powerWatts: 2000,
        shared: false,
      },
      {
        id: 'test-socket-2',
        type: 'socket_single',
        name: 'Socket B',
        anchor: anchor(2, 0.4),
        heightFromFloorMm: 350,
        powerWatts: 1000,
        shared: false,
      },
    ];
    const line = {
      ...createLine('sockets', [ROOM_ID], room.name, 0),
      id: LINE_ID,
      deviceIds: devices.map((device) => device.id),
      loadW: 3000,
      trace: 'none',
    };
    const panel = {
      ...createEmptyPanel(anchor(3, 0.37)),
      id: 'test-panel',
      heightFromFloorMm: 1450,
      lines: [line],
    };
    return {
      input: {
        panel,
        devices,
        rooms: [room],
        partitions: [],
        nodes: layout.nodes,
        walls: layout.walls,
        settings: { ...settings },
      },
    };
  }

  function snapshot(f) {
    return {
      version: 1,
      savedAt: new Date(0).toISOString(),
      boundaryMode: 'auto',
      settings: clone(f.input.settings),
      apartment: clone(buildAutoLayout(f.input.rooms, [], [], 120).apartment),
      rooms: clone(f.input.rooms),
      nodes: clone(f.input.nodes),
      walls: clone(f.input.walls),
      openings: [],
      freePartitions: [],
      devices: clone(f.input.devices),
      panel: clone(f.input.panel),
    };
  }

  const parallelogram = fixture(1500);
  const state = () => store.getState();
  const history = () => store.temporal.getState();
  const line = () => state().panel.lines.find((candidate) => candidate.id === LINE_ID);
  const lastToast = () => state().toasts.at(-1);
  const historySize = () => history().pastStates.length;

  function loadFresh() {
    state().loadProject(snapshot(parallelogram));
    assert.ok(state().panel);
    assert.equal(historySize(), 0);
    assert.equal(line().trace, 'none');
  }
  function routeInput() {
    const s = state();
    return {
      panel: s.panel,
      devices: s.devices,
      rooms: s.rooms,
      partitions: s.freePartitions,
      nodes: s.nodes,
      walls: s.walls,
      settings: s.settings,
    };
  }
  function storeRoute() {
    return computeLineRoutes(routeInput()).get(LINE_ID);
  }
  function panelPoint() {
    const pose = resolvePanelPose(
      state().panel,
      state().rooms,
      state().freePartitions,
      settings.defaultWallThicknessMm
    );
    assert.ok(pose, 'panel pose must resolve');
    return { ...pose.position };
  }
  function devicePoint(id) {
    const device = state().devices.find((candidate) => candidate.id === id);
    assert.ok(device, `device ${id} exists`);
    const resolved = resolveDevice(
      device,
      state().rooms,
      state().freePartitions,
      settings.defaultWallThicknessMm
    );
    assert.ok(resolved, `device ${id} pose must resolve`);
    return { ...resolved.poses[0].position };
  }
  function linkPanelToDevice(id) {
    return state().linkLineRoute(
      LINE_ID,
      { kind: 'panel', point: panelPoint() },
      { kind: 'device', point: devicePoint(id), deviceId: id },
      'h'
    );
  }
  function findOpenRoutePoint(route) {
    for (let pathIndex = 0; pathIndex < route.paths.length; pathIndex++) {
      const path = route.paths[pathIndex];
      for (let i = 1; i < path.length; i++) {
        const a = route.nodes[path[i - 1]];
        const b = route.nodes[path[i]];
        for (const t of [0.5, 0.35, 0.65]) {
          const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          if (route.nodes.some((node) => span(node, point) <= 0.5)) continue;
          // Ставим узел только там, где разрешено правилами комнат.
          if (!testPlacement(point)) return point;
        }
      }
    }
    return null;
  }
  function testPlacement(point) {
    return routeJunctionPlacementError(
      point,
      state().rooms,
      state().freePartitions
    );
  }

  await test('store link: panel to device is one persisted undo step', () => {
    loadFresh();
    const before = historySize();
    const panel = panelPoint();
    const result = linkPanelToDevice('test-socket');
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    assert.equal(historySize(), before + 1, 'one undo step per connection');
    assert.match(lastToast().message, /Связь добавлена/);

    const manual = line().manualRoute;
    assert.ok(manual);
    assert.equal(validateManualRoute(manual), null);
    assert.equal(isManualRouteOrthogonal(manual), true);
    const panelNode = manualRouteAnchorNode(manual, 'panel');
    assert.ok(panelNode !== null);
    near(span(manual.nodes[panelNode], panel), 0, 'panel anchor sits on the panel');
    assert.deepEqual(
      [...manualRouteConnectedDeviceIds(manual)],
      ['test-socket'],
      'only the linked device is reachable'
    );
    assert.equal(line().routeJunctions, undefined);

    const routed = storeRoute();
    assert.ok(routed);
    near(routed.planLengthMm, manualRouteLength(manual), 'cable follows the manual route');
    assert.match(routed.warning, /Прибор не подключён к щитку: Socket B/);
  });

  await test('store junction: loose node is saved, does not change cable, undoable', () => {
    loadFresh();
    assert.equal(linkPanelToDevice('test-socket').ok, true);
    const routeBefore = line().manualRoute;
    const lengthBefore = manualRouteLength(routeBefore);
    const cableBefore = storeRoute().cableLengthMm;
    const before = historySize();

    const junctionPoint = { x: 2800, y: 1500 };
    assert.equal(testPlacement(junctionPoint), null, 'fixture point is a legal junction spot');
    const added = state().addLineRouteJunction(LINE_ID, junctionPoint);
    assert.equal(added.ok, true, added.ok ? '' : added.error);
    assert.equal(historySize(), before + 1);
    assert.match(lastToast().message, /Узел поставлен/);

    assert.deepEqual(line().routeJunctions, [junctionPoint]);
    assert.deepEqual(line().manualRoute, routeBefore, 'loose junction leaves the route as is');
    near(manualRouteLength(line().manualRoute), lengthBefore, 'cable length does not change');
    near(storeRoute().cableLengthMm, cableBefore, 'unlinked junction adds no cable');

    history().undo();
    assert.equal(line().routeJunctions, undefined, 'undo removes the loose junction');
    assert.equal(historySize(), before);
  });

  await test('store junction: placement rules refuse walls, partitions and duplicates', () => {
    loadFresh();
    assert.equal(linkPanelToDevice('test-socket').ok, true);
    const before = historySize();

    const outside = state().addLineRouteJunction(LINE_ID, { x: 6000, y: 1500 });
    assert.equal(outside.ok, false);
    assert.match(outside.error, /внутри комнаты/);

    const nearWall = state().addLineRouteJunction(LINE_ID, { x: 2000, y: 20 });
    assert.equal(nearWall.ok, false);
    assert.match(nearWall.error, /близко к стене/);

    const legal = { x: 2800, y: 1500 };
    assert.equal(state().addLineRouteJunction(LINE_ID, legal).ok, true);
    const duplicate = state().addLineRouteJunction(LINE_ID, legal);
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.error, /уже стоит/);

    assert.equal(historySize(), before + 1, 'only the successful placement is recorded');
  });

  await test('store link: loose junction joins the panel and both devices', () => {
    loadFresh();
    assert.equal(linkPanelToDevice('test-socket').ok, true);
    const junctionPoint = { x: 2800, y: 1500 };
    assert.equal(state().addLineRouteJunction(LINE_ID, junctionPoint).ok, true);
    let before = historySize();

    const toJunction = state().linkLineRoute(
      LINE_ID,
      { kind: 'panel', point: panelPoint() },
      { kind: 'junction', point: junctionPoint },
      'h'
    );
    assert.equal(toJunction.ok, true, toJunction.ok ? '' : toJunction.error);
    assert.equal(historySize(), before + 1);
    assert.equal(line().routeJunctions, undefined, 'linked junction leaves the loose list');
    const junctionNode = manualRouteAnchorNode(line().manualRoute, 'junction');
    assert.ok(junctionNode !== null);
    near(span(line().manualRoute.nodes[junctionNode], junctionPoint), 0, 'junction anchor at the node');

    before = historySize();
    const toDevice = state().linkLineRoute(
      LINE_ID,
      { kind: 'junction', point: junctionPoint },
      { kind: 'device', point: devicePoint('test-socket-2'), deviceId: 'test-socket-2' },
      'v'
    );
    assert.equal(toDevice.ok, true, toDevice.ok ? '' : toDevice.error);
    assert.equal(historySize(), before + 1);
    assert.match(lastToast().message, /Связь добавлена/);

    const manual = line().manualRoute;
    assert.equal(validateManualRoute(manual), null);
    assert.equal(isManualRouteOrthogonal(manual), true);
    assert.deepEqual(
      [...manualRouteConnectedDeviceIds(manual)].sort(),
      ['test-socket', 'test-socket-2'],
      'both devices reach the panel'
    );
    assert.equal(manualRouteAnchorNode(manual, 'junction'), junctionNode, 'junction is reused');
    assert.equal(storeRoute().warning, null, 'no connectivity warnings remain');
  });

  await test('store link: rings and foreign devices are refused without history', () => {
    loadFresh();
    assert.equal(linkPanelToDevice('test-socket').ok, true);
    const before = historySize();
    const panel = clone(state().panel);

    const ring = state().linkLineRoute(
      LINE_ID,
      { kind: 'device', point: devicePoint('test-socket'), deviceId: 'test-socket' },
      { kind: 'panel', point: panelPoint() },
      'h'
    );
    assert.equal(ring.ok, false);
    assert.match(ring.error, /кольцо/);

    const ghost = state().linkLineRoute(
      LINE_ID,
      { kind: 'panel', point: panelPoint() },
      { kind: 'device', point: devicePoint('test-socket'), deviceId: 'ghost' },
      'h'
    );
    assert.equal(ghost.ok, false);
    assert.match(ghost.error, /не входит в состав линии/);

    assert.equal(historySize(), before, 'failed links do not add undo steps');
    assert.deepEqual(state().panel, panel, 'failed links leave the panel intact');
  });

  await test('store junction: placing on an existing segment anchors it and keeps length', () => {
    loadFresh();
    assert.equal(linkPanelToDevice('test-socket').ok, true);
    const route = line().manualRoute;
    const point = findOpenRoutePoint(route);
    assert.ok(point, 'a legal point lies on the route');
    const lengthBefore = manualRouteLength(route);
    const pathsBefore = route.paths.length;
    const before = historySize();

    const added = state().addLineRouteJunction(LINE_ID, point);
    assert.equal(added.ok, true, added.ok ? '' : added.error);
    assert.equal(historySize(), before + 1);
    assert.match(lastToast().message, /на трассе/);

    const manual = line().manualRoute;
    assert.equal(line().routeJunctions, undefined, 'anchored junction is not loose');
    const junctionNode = manualRouteAnchorNode(manual, 'junction');
    assert.ok(junctionNode !== null);
    near(span(manual.nodes[junctionNode], point), 0, 'junction snapped onto the segment');
    assert.equal(manual.paths.length, pathsBefore, 'segment is split inside one path');
    near(manualRouteLength(manual), lengthBefore, 'splitting does not change cable length');

    history().undo();
    assert.equal(manualRouteAnchorNode(line().manualRoute, 'junction'), null);
  });

  await test('store reset: clears manual route and loose junctions in one step', () => {
    loadFresh();
    assert.equal(linkPanelToDevice('test-socket').ok, true);
    assert.equal(
      state().addLineRouteJunction(LINE_ID, { x: 2800, y: 1500 }).ok,
      true
    );
    assert.ok(line().manualRoute);
    assert.equal(line().routeJunctions.length, 1);
    const before = historySize();

    state().resetLineRoute(LINE_ID);
    assert.equal(historySize(), before + 1);
    assert.equal(line().manualRoute, undefined);
    assert.equal(line().routeJunctions, undefined);
    assert.equal(line().trace, 'auto');
    assert.match(lastToast().message, /снова трассируется автоматически/);
    assert.ok(storeRoute().cableLengthMm > 0, 'automatic route is used again');

    history().undo();
    assert.ok(line().manualRoute, 'undo restores the manual route');
    assert.equal(line().routeJunctions.length, 1);
  });

  await test('store persistence: manual route and loose junctions survive a snapshot', () => {
    loadFresh();
    assert.equal(linkPanelToDevice('test-socket').ok, true);
    const junctionPoint = { x: 2800, y: 1500 };
    assert.equal(state().addLineRouteJunction(LINE_ID, junctionPoint).ok, true);

    const snapshotValue = jsonClone(getProjectSnapshot());
    assert.equal(isProjectSnapshot(snapshotValue), true);
    state().resetProject();
    state().loadProject(snapshotValue);
    const restored = line();
    assert.ok(restored.manualRoute);
    assert.equal(validateManualRoute(restored.manualRoute), null);
    assert.deepEqual(restored.routeJunctions, [junctionPoint]);
    assert.equal(restored.trace, 'none');
    const manual = materializeRouteForLine(routeInput(), LINE_ID);
    assert.ok(manual);
    assert.equal(validateManualRoute(manual), null);
  });
} catch (error) {
  failed += 1;
  console.error(error.stack ?? error);
} finally {
  await server?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

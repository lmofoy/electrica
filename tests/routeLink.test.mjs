import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const EPS = 1e-6;
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
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= EPS,
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

// Острый/тупой углы: комната-параллелограмм, ни одна стена не под 90°.
const VERTICES = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 5500, y: 3000 },
  { x: 1500, y: 3000 },
];
function makeRoom(extra = {}) {
  return {
    id: ROOM_ID,
    name: 'Link room',
    type: 'living',
    nodeIds: [],
    vertices: VERTICES.map((point) => ({ ...point })),
    holes: [],
    color: '#888888',
    wallThicknessMm: 120,
    ...extra,
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
    ROUTE_LINK_EPS_MM,
    insertJunctionIntoRoute,
    linkManualRoute,
    orthogonalLinkPoints,
    routeJunctionPlacementError,
  } = await server.ssrLoadModule('/src/core/electrical/routeLink.ts');
  const {
    isManualRouteOrthogonal,
    manualRouteAnchorNode,
    manualRouteConnectedDeviceIds,
    manualRouteLength,
    removeManualRouteSegment,
    validateManualRoute,
  } = await server.ssrLoadModule('/src/core/electrical/manualRoute.ts');
  const { createEmptyPanel, createLine, resolvePanelPose, sanitizePanel } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { buildAutoLayout } = await server.ssrLoadModule(
    '/src/core/geometry/autoLayout.ts'
  );

  await test('orthogonal link: straight, h-step and v-step stay at 90 degrees', () => {
    assert.equal(ROUTE_LINK_EPS_MM, 0.5);
    assert.deepEqual(orthogonalLinkPoints({ x: 500, y: 500 }, { x: 500, y: 500 }, 'h'), []);
    assert.deepEqual(
      orthogonalLinkPoints({ x: 0, y: 0 }, { x: 800, y: 0 }, 'v'),
      [{ x: 0, y: 0 }, { x: 800, y: 0 }],
      'axis-aligned points need no elbow'
    );
    const h = orthogonalLinkPoints({ x: 900, y: 400 }, { x: 4200, y: 1200 }, 'h');
    assert.equal(h.length, 3);
    assert.deepEqual(h[1], { x: 4200, y: 400 });
    assert.ok(
      Math.abs(h[0].y - h[1].y) <= 0.5 && Math.abs(h[1].x - h[2].x) <= 0.5,
      'h-step goes horizontally first'
    );
    const v = orthogonalLinkPoints({ x: 900, y: 400 }, { x: 4200, y: 1200 }, 'v');
    assert.equal(v.length, 3);
    assert.deepEqual(v[1], { x: 900, y: 1200 });
    assert.deepEqual(orthogonalLinkPoints({ x: 0, y: 0 }, { x: NaN, y: 1 }, 'h'), []);
  });

  await test('link: panel to device builds a panel-connected route in one step', () => {
    const panelPoint = { x: 900, y: 400 };
    const devicePoint = { x: 4200, y: 1200 };
    const result = linkManualRoute(
      null,
      { kind: 'panel', point: panelPoint },
      { kind: 'device', point: devicePoint, deviceId: 'socket-a' },
      'h'
    );
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const route = result.route;
    assert.equal(validateManualRoute(route), null);
    assert.equal(isManualRouteOrthogonal(route), true);
    assert.equal(route.nodes.length, 3);
    assert.equal(route.paths.length, 1);
    assert.equal(manualRouteAnchorNode(route, 'panel'), 0);
    const deviceNode = manualRouteAnchorNode(route, 'device', 'socket-a');
    assert.ok(deviceNode !== null);
    assert.ok(span(route.nodes[deviceNode], devicePoint) <= 0.5);
    assert.ok(
      route.nodes.some((node) => span(node, { x: 4200, y: 400 }) <= 0.5),
      'elbow vertex is present'
    );
    near(manualRouteLength(route), 3300 + 800, 'orthogonal elbow length');
    assert.deepEqual([...manualRouteConnectedDeviceIds(route)], ['socket-a']);
    assert.equal(result.warnings.length, 0);
  });

  await test('link: device-to-device works without a panel but rings are refused', () => {
    const a = { x: 1000, y: 700 };
    const b = { x: 3400, y: 1900 };
    const first = linkManualRoute(
      null,
      { kind: 'device', point: a, deviceId: 'a' },
      { kind: 'device', point: b, deviceId: 'b' },
      'h'
    );
    assert.equal(first.ok, true, first.ok ? '' : first.error);
    assert.equal(manualRouteAnchorNode(first.route, 'panel'), null);
    assert.equal(manualRouteConnectedDeviceIds(first.route).size, 0, 'no panel, no reachability');

    const ring = linkManualRoute(
      first.route,
      { kind: 'device', point: b, deviceId: 'b' },
      { kind: 'device', point: a, deviceId: 'a' },
      'v'
    );
    assert.equal(ring.ok, false);
    assert.match(ring.error, /кольцо/);

    const same = linkManualRoute(
      null,
      { kind: 'device', point: a, deviceId: 'a' },
      { kind: 'device', point: a, deviceId: 'a' },
      'h'
    );
    assert.equal(same.ok, false);
    assert.match(same.error, /две разные точки/);

    const panels = linkManualRoute(
      null,
      { kind: 'panel', point: a },
      { kind: 'panel', point: b },
      'h'
    );
    assert.equal(panels.ok, false);
    assert.match(panels.error, /сам с собой/);

    const noId = linkManualRoute(
      null,
      { kind: 'panel', point: a },
      { kind: 'device', point: b },
      'h'
    );
    assert.equal(noId.ok, false);
    assert.match(noId.error, /идентификатор/);
  });

  await test('link: branch at an existing junction does not split the parent path', () => {
    const panelPoint = { x: 0, y: 0 };
    const junctionPoint = { x: 1000, y: 1000 };
    const first = linkManualRoute(
      null,
      { kind: 'panel', point: panelPoint },
      { kind: 'junction', point: junctionPoint },
      'h'
    );
    assert.equal(first.ok, true, first.ok ? '' : first.error);
    const junctionNode = manualRouteAnchorNode(first.route, 'junction');
    assert.ok(junctionNode !== null);
    const parentPath = first.route.paths[0].slice();

    const second = linkManualRoute(
      first.route,
      { kind: 'junction', point: junctionPoint },
      { kind: 'device', point: { x: 2000, y: 1000 }, deviceId: 'socket-a' },
      'h'
    );
    assert.equal(second.ok, true, second.ok ? '' : second.error);
    assert.equal(second.route.paths.length, 2);
    assert.deepEqual(
      second.route.paths[0],
      parentPath,
      'parent path stays intact through the junction'
    );
    assert.equal(second.route.paths[1][0], junctionNode, 'branch starts at the junction');
    assert.equal(manualRouteAnchorNode(second.route, 'junction'), junctionNode);
    assert.equal(validateManualRoute(second.route), null);
    assert.equal(isManualRouteOrthogonal(second.route), true);
    near(manualRouteLength(second.route), 1000 + 1000 + 1000 + 0, 'parent + branch length');
  });

  await test('insert junction: splits a segment, snaps to a vertex and refuses off-route points', () => {
    const base = {
      nodes: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
      paths: [[0, 1, 2]],
      anchors: [
        { nodeIndex: 0, kind: 'panel' },
        { nodeIndex: 2, kind: 'device', deviceId: 'socket-a' },
      ],
    };
    const length = manualRouteLength(base);

    const middle = insertJunctionIntoRoute(base, { x: 500, y: 0 });
    assert.equal(middle.ok, true, middle.ok ? '' : middle.error);
    assert.equal(middle.route.paths.length, 1);
    assert.equal(middle.route.paths[0].length, 4);
    assert.equal(manualRouteLength(middle.route), length, 'junction keeps the cable length');
    const middleNode = manualRouteAnchorNode(middle.route, 'junction');
    assert.ok(middleNode !== null);
    assert.ok(span(middle.route.nodes[middleNode], { x: 500, y: 0 }) <= 0.5);

    const onVertex = insertJunctionIntoRoute(base, { x: 1000, y: 0 });
    assert.equal(onVertex.ok, true, onVertex.ok ? '' : onVertex.error);
    assert.equal(onVertex.route.nodes.length, 3, 'vertex is reused, not duplicated');
    assert.equal(manualRouteAnchorNode(onVertex.route, 'junction'), 1);

    const offRoute = insertJunctionIntoRoute(base, { x: 500, y: 100 });
    assert.equal(offRoute.ok, false);
    assert.equal(offRoute.reason, 'not-on-route');
    assert.match(offRoute.error, /не лежит на трассе/);

    const invalid = insertJunctionIntoRoute(
      { nodes: [], paths: [[0, 1]], anchors: [] },
      { x: 0, y: 0 }
    );
    assert.equal(invalid.ok, false);
    assert.equal(invalid.reason, 'invalid');
  });

  await test('junction placement: rooms, wall gap, holes and partitions (acute/obtuse plan)', () => {
    const rooms = [makeRoom()];
    assert.equal(routeJunctionPlacementError({ x: 2800, y: 1500 }, rooms, []), null);

    assert.match(
      routeJunctionPlacementError({ x: 6000, y: 1500 }, rooms, []),
      /внутри комнаты/
    );
    assert.match(
      routeJunctionPlacementError({ x: 2000, y: 20 }, rooms, []),
      /близко к стене/
    );
    assert.match(
      routeJunctionPlacementError({ x: 2800, y: 1500 }, [], []),
      /нарисуйте комнату/
    );

    const partition = {
      id: 'p1',
      p1: { x: 3000, y: 500 },
      p2: { x: 3000, y: 2500 },
      thicknessMm: 120,
      roomId: ROOM_ID,
    };
    assert.match(
      routeJunctionPlacementError({ x: 3000, y: 1500 }, rooms, [partition]),
      /перегородку/
    );

    const holed = [
      makeRoom({
        holes: [
          [
            { x: 2500, y: 1000 },
            { x: 3200, y: 1000 },
            { x: 3200, y: 1600 },
            { x: 2500, y: 1600 },
          ],
        ],
      }),
    ];
    assert.match(
      routeJunctionPlacementError({ x: 2480, y: 1300 }, holed, []),
      /краю проёма/
    );
    assert.equal(routeJunctionPlacementError({ x: 2100, y: 1300 }, holed, []), null);
  });

  await test('reachability: a cut branch stops counting its device', () => {
    const panelPoint = { x: 0, y: 0 };
    let result = linkManualRoute(
      null,
      { kind: 'panel', point: panelPoint },
      { kind: 'junction', point: { x: 1000, y: 0 } },
      'h'
    );
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    result = linkManualRoute(
      result.route,
      { kind: 'junction', point: { x: 1000, y: 0 } },
      { kind: 'device', point: { x: 2000, y: 0 }, deviceId: 'socket-a' },
      'h'
    );
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    result = linkManualRoute(
      result.route,
      { kind: 'junction', point: { x: 1000, y: 0 } },
      { kind: 'device', point: { x: 1000, y: 1000 }, deviceId: 'socket-b' },
      'v'
    );
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const connected = manualRouteConnectedDeviceIds(result.route);
    assert.deepEqual([...connected].sort(), ['socket-a', 'socket-b']);

    const branchPathIndex = result.route.paths.findIndex((path) => {
      const start = result.route.nodes[path[0]];
      const end = result.route.nodes[path[path.length - 1]];
      return start.y === 0 && end.y === 1000 && end.x === 1000;
    });
    assert.ok(branchPathIndex >= 0, 'vertical branch to socket-b exists');
    const cut = removeManualRouteSegment(result.route, branchPathIndex, 0);
    assert.equal(cut.ok, true, cut.ok ? '' : cut.error);
    assert.deepEqual([...manualRouteConnectedDeviceIds(cut.route)], ['socket-a']);
  });

  await test('persistence: routeJunctions survive sanitizePanel and JSON', () => {
    const room = makeRoom();
    const layout = buildAutoLayout([room], [], [], settings.defaultWallThicknessMm);
    const panel = {
      ...createEmptyPanel({
        kind: 'room_edge',
        roomId: ROOM_ID,
        edgeIndex: 0,
        offsetMm: 800,
      }),
      id: 'panel-persist',
      lines: [
        {
          ...createLine('sockets', [ROOM_ID], room.name, 0),
          id: 'line-persist',
          trace: 'none',
          routeJunctions: [{ x: 2800, y: 1500 }, { x: 2600, y: 1400 }],
        },
      ],
    };
    assert.ok(resolvePanelPose(panel, [room], [], settings.defaultWallThicknessMm));
    const restored = sanitizePanel(
      jsonClone(panel),
      [room],
      [],
      settings.defaultWallThicknessMm
    );
    assert.ok(restored);
    assert.deepEqual(restored.lines[0].routeJunctions, [
      { x: 2800, y: 1500 },
      { x: 2600, y: 1400 },
    ]);

    const dirty = clone(panel);
    dirty.lines[0].routeJunctions = [
      { x: 2800, y: 1500 },
      { x: 'bad', y: 1 },
      null,
    ];
    const cleaned = sanitizePanel(
      dirty,
      [room],
      [],
      settings.defaultWallThicknessMm
    );
    assert.ok(cleaned);
    assert.deepEqual(cleaned.lines[0].routeJunctions, [{ x: 2800, y: 1500 }]);
    assert.ok(layout.nodes);
  });
} catch (error) {
  failed += 1;
  console.error(error.stack ?? error);
} finally {
  await server?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

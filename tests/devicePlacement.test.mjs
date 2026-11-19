// Посадка приборов: грань перегородки вместо осевой линии + размерные подсказки.
// Запуск: node tests/devicePlacement.test.mjs
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

const room = {
  id: 'r1',
  name: 'Гостиная',
  type: 'living',
  nodeIds: ['n1', 'n2', 'n3', 'n4'],
  vertices: [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ],
  color: '#334155',
  wallThicknessMm: 120,
};

const partition = {
  id: 'p1',
  p1: { x: 2000, y: 0 },
  p2: { x: 2000, y: 3000 },
  thicknessMm: 100,
  roomId: 'r1',
};

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const { resolveDevice, findDevicePlacement, buildPlacementDimensions } =
    await server.ssrLoadModule('/src/core/electrical/devices.ts');

  const device = (anchor) => ({
    id: 'd1',
    type: 'socket_single',
    name: 'Розетка',
    anchor,
    heightFromFloorMm: 300,
    powerWatts: 2200,
    shared: false,
  });

  await test('partition anchor sits on the face, not the centerline', () => {
    const left = resolveDevice(
      device({ kind: 'partition', partitionId: 'p1', offsetMm: 1000, side: 1 }),
      [room],
      [partition],
      120
    );
    assert.ok(left);
    assert.equal(left.poses[0].position.x, 1950);
    assert.equal(left.poses[0].position.y, 1000);

    const right = resolveDevice(
      device({ kind: 'partition', partitionId: 'p1', offsetMm: 1000, side: -1 }),
      [room],
      [partition],
      120
    );
    assert.ok(right);
    assert.equal(right.poses[0].position.x, 2050);
    assert.equal(right.poses[0].position.y, 1000);
  });

  await test('findDevicePlacement near a partition returns a face point', () => {
    const placement = findDevicePlacement(
      'socket_single',
      { x: 1880, y: 1000 },
      [room],
      [partition],
      120,
      false
    );
    assert.ok(placement.ok);
    assert.equal(placement.anchor.kind, 'partition');
    assert.equal(placement.anchor.side, 1);
    assert.equal(placement.position.x, 1950);
  });

  await test('wall device gets one dimension to the nearest corner', () => {
    const dims = buildPlacementDimensions(
      'socket_single',
      { x: 1200, y: 10 },
      [room],
      [],
      120
    );
    assert.equal(dims.length, 1);
    assert.deepEqual(dims[0].from, { x: 0, y: 0 });
    assert.equal(Math.round(dims[0].lengthMm), 1200);
    assert.ok(Math.abs(dims[0].labelSide.x) < 1e-9);
    assert.equal(dims[0].labelSide.y, 1);
  });

  await test('device on a partition measures along its face', () => {
    const dims = buildPlacementDimensions(
      'socket_single',
      { x: 1880, y: 1000 },
      [room],
      [partition],
      120
    );
    assert.equal(dims.length, 1);
    assert.equal(dims[0].from.x, 1950);
    assert.equal(dims[0].from.y, 0);
    assert.equal(Math.round(dims[0].lengthMm), 1000);
  });

  await test('ceiling light gets two perpendicular dimensions to nearest walls', () => {
    const dims = buildPlacementDimensions(
      'light_ceiling',
      { x: 1900, y: 1600 },
      [room],
      [],
      120
    );
    assert.equal(dims.length, 2);
    const lengths = dims.map((dim) => Math.round(dim.lengthMm));
    assert.deepEqual(lengths, [1400, 1600]);
    for (const dim of dims) {
      assert.equal(dim.to.x, 1900);
      assert.equal(dim.to.y, 1600);
    }
  });

  await test('dimensions follow angled walls along their normals', () => {
    const triangle = {
      ...room,
      vertices: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 0, y: 3000 },
      ],
    };
    const point = { x: 600, y: 2000 };
    const dims = buildPlacementDimensions('light_ceiling', point, [triangle], [], 120);
    assert.equal(dims.length, 2);
    const lengths = dims.map((dim) => Math.round(dim.lengthMm)).sort((a, b) => a - b);
    assert.deepEqual(lengths, [440, 600]);

    const hypotenuse = dims.find((dim) => Math.round(dim.lengthMm) === 440);
    assert.ok(hypotenuse);
    const vx = hypotenuse.to.x - hypotenuse.from.x;
    const vy = hypotenuse.to.y - hypotenuse.from.y;
    const wallX = 0 - 4000;
    const wallY = 3000 - 0;
    const dot = vx * wallX + vy * wallY;
    assert.ok(Math.abs(dot) < 1, `expected perpendicular, dot=${dot}`);
  });
} finally {
  await server?.close();
}

console.log(`\ndevicePlacement: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

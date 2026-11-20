// Сводка шага «Приборы»: счётчики по комнатам и комнаты без приборов.
// Запуск: node tests/devicesSummary.test.mjs
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

const rooms = [
  { id: 'r1', name: 'Гостиная' },
  { id: 'r2', name: 'Спальня' },
  { id: 'r3', name: 'Кухня' },
];

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const { buildDeviceSummary } = await server.ssrLoadModule(
    '/src/core/electrical/deviceSummary.ts'
  );

  await test('summary: empty project counts no devices', () => {
    const summary = buildDeviceSummary([], []);
    assert.equal(summary.total, 0);
    assert.deepEqual(summary.rooms, []);
    assert.deepEqual(summary.emptyRoomNames, []);
  });

  await test('summary: counts devices per room and lists empty rooms', () => {
    const summary = buildDeviceSummary(rooms, [
      { roomIds: ['r1'] },
      { roomIds: ['r1'] },
      { roomIds: ['r3'] },
    ]);
    assert.equal(summary.total, 3);
    assert.deepEqual(
      summary.rooms.map((row) => [row.roomId, row.count]),
      [
        ['r1', 2],
        ['r2', 0],
        ['r3', 1],
      ]
    );
    assert.deepEqual(summary.emptyRoomNames, ['Спальня']);
  });

  await test('summary: shared device counts in both rooms but once in total', () => {
    const summary = buildDeviceSummary(rooms, [{ roomIds: ['r1', 'r2'] }]);
    assert.equal(summary.total, 1);
    assert.deepEqual(
      summary.rooms.map((row) => row.count),
      [1, 1, 0]
    );
    assert.deepEqual(summary.emptyRoomNames, ['Кухня']);
  });

  await test('summary: duplicate room refs inside one device count once', () => {
    const summary = buildDeviceSummary(rooms, [{ roomIds: ['r1', 'r1'] }]);
    assert.equal(summary.rooms[0].count, 1);
  });

  await test('summary: unknown room ids are ignored', () => {
    const summary = buildDeviceSummary(rooms, [{ roomIds: ['ghost'] }]);
    assert.equal(summary.total, 1);
    assert.deepEqual(
      summary.rooms.map((row) => row.count),
      [0, 0, 0]
    );
    assert.deepEqual(summary.emptyRoomNames, ['Гостиная', 'Спальня', 'Кухня']);
  });
} finally {
  await server?.close();
}

console.log(`\ndevicesSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

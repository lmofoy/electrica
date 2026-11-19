// Чек-лист шага «План»: комнаты, двери и окна в правом инспекторе.
// Запуск: node tests/planChecklist.test.mjs
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

function room(id) {
  return {
    id,
    name: `Комната ${id}`,
    type: 'living',
    nodeIds: ['n1', 'n2', 'n3', 'n4'],
    vertices: [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 3000 },
      { x: 0, y: 3000 },
    ],
    color: '#334155',
    wallThicknessMm: 120,
  };
}

function opening(id, type, index) {
  return {
    id,
    type,
    wallId: 'w1',
    p1: { x: index * 100, y: 0 },
    p2: { x: index * 100 + 900, y: 0 },
    widthMm: 900,
    heightMm: type === 'door' ? 2100 : 1500,
    elevationMm: type === 'door' ? 0 : 900,
    wallThicknessMm: 120,
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

  const { buildPlanChecklist } = await server.ssrLoadModule(
    '/src/core/model/roomElements.ts'
  );

  await test('checklist: empty project is not complete', () => {
    const checklist = buildPlanChecklist([], []);
    assert.equal(checklist.complete, false);
    assert.equal(checklist.rooms, 0);
    assert.equal(checklist.doors, 0);
    assert.equal(checklist.windows, 0);
    assert.deepEqual(
      checklist.items.map((item) => [item.id, item.count, item.done]),
      [
        ['rooms', 0, false],
        ['doors', 0, false],
        ['windows', 0, false],
      ]
    );
  });

  await test('checklist: counts rooms, doors and windows by type', () => {
    const rooms = [room('a'), room('b'), room('c')];
    const openings = [
      opening('o1', 'door', 1),
      opening('o2', 'door', 2),
      opening('o3', 'window', 3),
      opening('o4', 'window', 4),
      opening('o5', 'window', 5),
    ];
    const checklist = buildPlanChecklist(rooms, openings);
    assert.equal(checklist.complete, true);
    assert.equal(checklist.rooms, 3);
    assert.equal(checklist.doors, 2);
    assert.equal(checklist.windows, 3);
    assert.ok(checklist.items.every((item) => item.done));
  });

  await test('checklist: labels follow the plan strip and rooms alone count', () => {
    const checklist = buildPlanChecklist([room('a')], [opening('o1', 'door', 1)]);
    assert.deepEqual(
      checklist.items.map((item) => item.label),
      ['Комнат', 'Дверей', 'Окон']
    );
    assert.equal(checklist.complete, true);
    assert.equal(checklist.items[1].done, true);
    assert.equal(checklist.items[2].done, false);
    assert.equal(checklist.items[2].count, 0);
  });
} finally {
  await server?.close();
}

console.log(`\nplanChecklist: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

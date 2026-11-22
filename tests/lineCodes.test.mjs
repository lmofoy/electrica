// Постоянный код группы: выдача при создании, сохранение при удалении
// и перестановке, миграция старых снапшотов и согласие документов.
// Запуск: node tests/lineCodes.test.mjs
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
  id: 'room-hall',
  name: 'Зал',
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
const devices = [
  {
    id: 'd1',
    type: 'socket_single',
    name: 'Розетка',
    anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 0, offsetMm: 1000 },
    heightFromFloorMm: 300,
    powerWatts: 2200,
    shared: false,
  },
  {
    id: 'd2',
    type: 'light_ceiling',
    name: 'Светильник',
    anchor: { kind: 'room_point', roomId: 'room-hall', x: 2000, y: 1500 },
    heightFromFloorMm: 2700,
    powerWatts: 60,
    shared: false,
  },
];

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const {
    createLineFromDevices,
    lineCodes,
    nextLineCode,
    normalizeLineAssignments,
  } = await server.ssrLoadModule('/src/core/electrical/lineOps.ts');
  const { createLine, defaultPanelSupply } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );
  const { buildPanelSchematic } = await server.ssrLoadModule(
    '/src/core/electrical/schematic.ts'
  );
  const { buildCableJournal } = await server.ssrLoadModule(
    '/src/core/electrical/cableJournal.ts'
  );
  const { buildPanelCalculation } = await server.ssrLoadModule(
    '/src/core/electrical/calculation.ts'
  );
  const { buildDinSheetLayout } = await server.ssrLoadModule(
    '/src/core/electrical/dinLayout.ts'
  );

  const ctx = { devices, rooms: [room], partitions: [] };
  const codes = (panel) => panel.lines.map((line) => line.code);

  function panel(lines) {
    return {
      id: 'panel-1',
      name: 'ЩР-1',
      anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 2, offsetMm: 1000 },
      heightFromFloorMm: 1600,
      mounting: 'flush',
      supply: defaultPanelSupply(10000),
      strategy: 'optimal',
      lines,
    };
  }

  await test('codes: assigned on creation, gaps survive deletion, new line takes max + 1', () => {
    const base = panel([
      { ...createLine('sockets', ['room-hall'], 'Зал', 0), id: 'l2' },
      { ...createLine('lighting', ['room-hall'], 'Зал', 1), id: 'l3' },
      { ...createLine('kitchen', ['room-hall'], 'Зал', 2), id: 'l4' },
    ]);
    assert.deepEqual(codes(normalizeLineAssignments(base)), [2, 3, 4]);

    const withoutMiddle = normalizeLineAssignments({
      ...base,
      lines: base.lines.filter((line) => line.id !== 'l3'),
    });
    assert.deepEqual(codes(withoutMiddle), [2, 4], 'deleting the middle keeps 2 and 4');
    assert.equal(nextLineCode(withoutMiddle), 5);

    const created = createLineFromDevices(
      withoutMiddle,
      [],
      { purpose: 'other' },
      ctx
    );
    assert.equal(created.panel.lines.at(-1).code, 5);
    assert.deepEqual(
      created.panel.lines.map((line) => line.code),
      [2, 4, 5],
      'deleted code 3 is never reused'
    );

    const reordered = normalizeLineAssignments({
      ...created.panel,
      lines: [...created.panel.lines].reverse(),
    });
    const byId = new Map(reordered.lines.map((line) => [line.id, line.code]));
    assert.equal(byId.get('l2'), 2);
    assert.equal(byId.get('l4'), 4);
    assert.equal(byId.get('l3'), undefined);
  });

  await test('codes: legacy snapshot gets codes without duplicate numbers', () => {
    const legacy = panel([
      { ...createLine('sockets', ['room-hall'], 'Зал', 0), id: 'a', code: undefined },
      { ...createLine('lighting', ['room-hall'], 'Зал', 1), id: 'b', code: undefined },
      { ...createLine('other', ['room-hall'], 'Зал', 2), id: 'c', code: undefined },
    ]);
    assert.deepEqual(codes(normalizeLineAssignments(legacy)), [2, 3, 4]);

    const messy = normalizeLineAssignments({
      ...legacy,
      lines: legacy.lines.map((line, index) => ({
        ...line,
        code: [3, 3, undefined][index],
      })),
    });
    assert.deepEqual(codes(messy), [3, 4, 5]);
    assert.equal(lineCodes(messy).size, 3);
  });

  await test('codes: schematic, calculation, journal and DIN use the same numbers', () => {
    const target = panel([
      {
        ...createLine('sockets', ['room-hall'], 'Зал', 0),
        id: 'line-a',
        code: 7,
        deviceIds: ['d1'],
      },
      {
        ...createLine('lighting', ['room-hall'], 'Зал', 1),
        id: 'line-b',
        code: 9,
        deviceIds: ['d2'],
      },
    ]);

    const schematic = buildPanelSchematic(target, { rooms: [room] });
    assert.deepEqual(
      schematic.groups.map((group) => group.code),
      [7, 9]
    );
    assert.deepEqual(
      schematic.groups.map((group) => group.breakerDesignation),
      ['QF7', 'QF9']
    );

    const calculation = buildPanelCalculation(target, { rooms: [room] });
    assert.deepEqual(
      calculation.rows.map((row) => row.index),
      [7, 9]
    );
    assert.deepEqual(
      calculation.rows.map((row) => row.designation),
      ['QF7', 'QF9']
    );

    const journal = buildCableJournal(target, {
      devices,
      rooms: [room],
      partitions: [],
      routes: new Map(),
    });
    assert.deepEqual(
      journal.rows.map((row) => [row.code, row.groupLabel, row.breakerLabel]),
      [
        [7, 'Гр. 7', 'QF7 16 А'],
        [9, 'Гр. 9', 'QF9 10 А'],
      ]
    );

    const din = buildDinSheetLayout(target, { rooms: [room] });
    const designations = new Map(
      din.rails.flatMap((rail) => rail.items.map((item) => [item.id, item.designation]))
    );
    assert.equal(designations.get('line-a-breaker'), 'QF7');
    assert.equal(designations.get('line-b-breaker'), 'QF9');
  });
} finally {
  if (server) await server.close();
}

console.log(`\nlineCodes: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

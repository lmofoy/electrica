// Листы печатных планов: раскладка групп по листам, санитайзер,
// фильтрация приборов и трасс, нумерация комплекта и предупреждения.
// Запуск: node tests/planSheets.test.mjs
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
const socket = {
  id: 'd1',
  type: 'socket_single',
  name: 'Розетка',
  anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 0, offsetMm: 1000 },
  heightFromFloorMm: 300,
  powerWatts: 2200,
  shared: false,
};
const looseSocket = {
  ...socket,
  id: 'd4',
  name: 'Розетка без линии',
  anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 3, offsetMm: 900 },
};
const switchDevice = {
  id: 'd2',
  type: 'switch_1k',
  name: 'Выключатель',
  anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 1, offsetMm: 1000 },
  heightFromFloorMm: 900,
  powerWatts: 0,
  shared: false,
};
const lamp = {
  id: 'd3',
  type: 'light_ceiling',
  name: 'Светильник',
  anchor: { kind: 'room_point', roomId: 'room-hall', x: 1800, y: 1500 },
  heightFromFloorMm: 2700,
  powerWatts: 60,
  shared: false,
};

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const {
    buildPlanSheetNumbering,
    buildPlanSheetChecks,
    autoPlanSheetName,
  } = await server.ssrLoadModule('/src/core/electrical/planSheets.ts');
  const { createLine, defaultPanelSupply, sanitizePanel } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );
  const { buildPlanSheet } = await server.ssrLoadModule(
    '/src/core/electrical/planSheet.ts'
  );
  const { buildTitleSheet } = await server.ssrLoadModule(
    '/src/core/electrical/titleSheet.ts'
  );
  const { buildPanelSchematic } = await server.ssrLoadModule(
    '/src/core/electrical/schematic.ts'
  );
  const { buildPanelSpecification } = await server.ssrLoadModule(
    '/src/core/electrical/specification.ts'
  );
  const { buildCableJournalSheet } = await server.ssrLoadModule(
    '/src/core/electrical/cableJournalLayout.ts'
  );

  const powerA = {
    ...createLine('sockets', ['room-hall'], 'Зал', 0, 'ceiling'),
    id: 'line-a',
    code: 2,
    name: 'Зал — Розетки',
    deviceIds: ['d1'],
  };
  const powerB = {
    ...createLine('sockets', ['room-hall'], 'Кухня', 1, 'floor'),
    id: 'line-b',
    code: 3,
    name: 'Кухня — Розетки',
    deviceIds: [],
    roomIds: ['room-hall'],
  };
  const light = {
    ...createLine('lighting', ['room-hall'], 'Зал', 2, 'ceiling'),
    id: 'line-c',
    code: 4,
    name: 'Зал — Освещение',
    deviceIds: ['d2', 'd3'],
  };

  function makePanel(lines, planSheets) {
    const panel = {
      id: 'panel-1',
      name: 'ЩР-1',
      anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 2, offsetMm: 1000 },
      heightFromFloorMm: 1600,
      mounting: 'flush',
      supply: defaultPanelSupply(10000),
      strategy: 'optimal',
      lines,
    };
    if (planSheets !== undefined) panel.planSheets = planSheets;
    return panel;
  }

  const defaultPanel = makePanel([powerA, light]);

  await test('plan sheets: old project opens as one sheet per kind', () => {
    const numbering = buildPlanSheetNumbering(defaultPanel);
    assert.equal(numbering.sheets.length, 2);
    assert.equal(numbering.total, 8);
    assert.equal(numbering.journalNumber, 8);
    assert.deepEqual(numbering.counts, { power: 1, lighting: 1 });
    assert.deepEqual(
      numbering.sheets.map((sheet) => [sheet.kind, sheet.number, sheet.name, sheet.stored]),
      [
        ['power', 6, 'Все группы', false],
        ['lighting', 7, 'Все группы', false],
      ]
    );
    assert.deepEqual(numbering.sheets[0].lineIds, ['line-a']);
  });

  await test('plan sheets: stored sheets move following documents', () => {
    const panel = makePanel(
      [powerA, powerB, light],
      [
        { id: 's1', kind: 'power', name: 'Кухня, силовая', lineIds: ['line-a'] },
        { id: 's2', kind: 'power', name: '', lineIds: ['line-b'] },
        { id: 's3', kind: 'lighting', name: 'Свет', lineIds: ['line-c'] },
      ]
    );
    const numbering = buildPlanSheetNumbering(panel);
    assert.deepEqual(numbering.counts, { power: 2, lighting: 1 });
    assert.equal(numbering.total, 9);
    assert.equal(numbering.journalNumber, 9);
    assert.deepEqual(
      numbering.sheets.map((sheet) => [sheet.number, sheet.name]),
      [
        [6, 'Кухня, силовая'],
        [7, 'Гр. 3'],
        [8, 'Свет'],
      ]
    );
  });

  await test('plan sheets: auto name is assembled from group codes', () => {
    const panel = makePanel([powerA, powerB]);
    assert.equal(autoPlanSheetName(panel, ['line-a', 'line-b']), 'Гр. 2, 3');
    assert.equal(autoPlanSheetName(panel, ['line-b']), 'Гр. 3');
    assert.equal(autoPlanSheetName(panel, []), 'Все группы');
  });

  await test('plan sheets: sanitizer prunes stale, wrong-kind and empty sheets', () => {
    const panel = makePanel(
      [powerA, light],
      [
        { id: 'ok', kind: 'power', name: '  Силовая  ', lineIds: ['line-a', 'line-a', 'line-c', 'missing'] },
        { id: 'empty', kind: 'power', name: 'Пусто', lineIds: ['missing'] },
        { id: 'bad-kind', kind: 'power', name: 'Чужой вид', lineIds: ['line-c'] },
        { id: 'light', kind: 'lighting', name: '', lineIds: ['line-c'] },
        { id: 'ok', kind: 'lighting', name: 'Дубль id', lineIds: ['line-c'] },
        'мусор',
      ]
    );
    const cleaned = sanitizePanel(panel, [room], [], 120);
    assert.deepEqual(cleaned.planSheets, [
      { id: 'ok', kind: 'power', name: 'Силовая', lineIds: ['line-a'] },
      { id: 'light', kind: 'lighting', name: '', lineIds: ['line-c'] },
    ]);

    const without = sanitizePanel(makePanel([powerA], 'bad'), [room], [], 120);
    assert.equal(without.planSheets, undefined);
  });

  await test('plan sheets: plan keeps rooms and walls, filters devices and routes', () => {
    const routes = new Map([
      [
        'line-a',
        {
          lineId: 'line-a',
          mode: 'ceiling',
          cableLengthMm: 8000,
          planLengthMm: 6500,
          verticalMm: 1500,
          deviceCount: 1,
          paths: [[{ x: 0, y: 0 }, { x: 4000, y: 0 }]],
          warning: null,
        },
      ],
      [
        'line-c',
        {
          lineId: 'line-c',
          mode: 'ceiling',
          cableLengthMm: 4000,
          planLengthMm: 2500,
          verticalMm: 1500,
          deviceCount: 2,
          paths: [[{ x: 0, y: 3000 }, { x: 4000, y: 3000 }]],
          warning: null,
        },
      ],
    ]);
    const layout = buildPlanSheet(
      {
        mode: 'power',
        rooms: [room],
        nodes: {},
        walls: [],
        openings: [],
        partitions: [],
        devices: [socket, looseSocket, switchDevice, lamp],
        panel: defaultPanel,
        autoLayout: null,
        routes,
        wallThicknessMm: 120,
      },
      {
        lineIds: ['line-a'],
        sheetName: 'Кухня, силовая',
        sheetNumber: '6',
        sheetTotal: '9',
        date: '22.11.2026',
      }
    );
    assert.equal(layout.devices.length, 1);
    assert.equal(layout.devices[0].id, 'd1');
    assert.equal(layout.routes.length, 1);
    assert.equal(layout.routes[0].lineId, 'line-a');
    assert.equal(layout.rooms.length, 1);
    assert.equal(layout.floors.length, 1);
    assert.match(layout.subtitle, /Кухня, силовая/);
    assert.match(layout.subtitle, /1 группа · 1 прибор/);
    assert.equal(layout.document.sheet, '6');
    assert.equal(layout.document.sheetTotal, '9');
    assert.match(layout.notesLines[0], /только выбранных групп/);
  });

  await test('plan sheets: checks report uncovered, duplicate and empty sheets', () => {
    const panel = makePanel(
      [powerA, powerB, light],
      [
        { id: 's1', kind: 'power', name: 'Первая', lineIds: ['line-a', 'line-b'] },
        { id: 's2', kind: 'power', name: 'Дубль', lineIds: ['line-a'] },
        { id: 's3', kind: 'lighting', name: 'Свет без приборов', lineIds: ['line-c'] },
      ]
    );
    // Линия света без приборов — пустой лист.
    panel.lines = panel.lines.map((line) =>
      line.id === 'line-c' ? { ...line, deviceIds: [] } : line
    );
    const checks = buildPlanSheetChecks(panel, [socket, looseSocket, switchDevice, lamp]);
    const byId = new Map(checks.map((check) => [check.id, check]));
    assert.equal(byId.get('plan-sheet-duplicate-line-a')?.severity, 'info');
    assert.match(byId.get('plan-sheet-duplicate-line-a').message, /2 листах/);
    assert.ok(byId.get('plan-sheet-empty-s3'));
    assert.ok(byId.get('plan-sheet-unassigned'));
    assert.match(byId.get('plan-sheet-unassigned').message, /вне линий: 3/);
    assert.equal(byId.has('plan-sheet-missing-line-a'), false);

    const uncovered = makePanel(
      [powerA, powerB],
      [{ id: 's1', kind: 'power', name: 'Первая', lineIds: ['line-a'] }]
    );
    const missing = buildPlanSheetChecks(uncovered, []);
    const item = missing.find((check) => check.id === 'plan-sheet-missing-line-b');
    assert.ok(item);
    assert.equal(item.severity, 'warning');
    assert.match(item.message, /не попала ни на один лист/);
  });

  await test('plan sheets: title registry shows sheet ranges and totals', () => {
    const panel = makePanel(
      [powerA, powerB, light],
      [
        { id: 's1', kind: 'power', name: 'Первая', lineIds: ['line-a'] },
        { id: 's2', kind: 'power', name: 'Вторая', lineIds: ['line-b'] },
        { id: 's3', kind: 'lighting', name: 'Свет', lineIds: ['line-c'] },
      ]
    );
    const layout = buildTitleSheet(
      {
        schematic: buildPanelSchematic(panel, { rooms: [room] }),
        specification: buildPanelSpecification(panel, { rooms: [room] }),
        rooms: [room],
        deviceCount: 3,
        planSheetCounts: { power: 2, lighting: 1 },
      },
      { date: '22.11.2026' }
    );
    assert.equal(layout.sheets.rows.length, 8);
    assert.equal(layout.sheets.rows[5].cells[0], '6–7');
    assert.equal(layout.sheets.rows[5].cells[1], 'ЭС-05');
    assert.match(layout.sheets.rows[5].cells[2], /2 листа/);
    assert.equal(layout.sheets.rows[6].cells[0], '8');
    assert.match(layout.sheets.rows[6].cells[2], /План осветительных сетей/);
    assert.doesNotMatch(layout.sheets.rows[6].cells[2], /лист/);
    assert.equal(layout.sheets.rows[7].cells[0], '9');
    assert.equal(layout.document.sheetTotal, '9');
  });

  await test('plan sheets: cable journal takes its number from the set', () => {
    const sheet = buildCableJournalSheet(
      {
        panelName: 'ЩР-1',
        cableBrand: 'ВВГнг(А)-LS',
        rows: [],
        totals: {
          lines: 0,
          cableMeters: 0,
          ceilingCount: 0,
          floorCount: 0,
          missingCount: 0,
        },
        warnings: [],
      },
      { sheetNumber: '9', sheetTotal: '9', date: '22.11.2026' }
    );
    assert.equal(sheet.document.sheet, '9');
    assert.equal(sheet.document.sheetTotal, '9');
  });
} finally {
  await server?.close();
}

console.log(`\nplanSheets: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

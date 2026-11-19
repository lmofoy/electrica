// Титульный лист ЭС-00: параметры проекта, ведомость чертежей,
// ссылочные документы, пояснение и основная надпись.
// Запуск: node tests/titleSheet.test.mjs
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
function inside(inner, outer, label) {
  assert.ok(inner.x >= outer.x - EPS, `${label}: left outside`);
  assert.ok(inner.y >= outer.y - EPS, `${label}: top outside`);
  assert.ok(inner.x + inner.width <= outer.x + outer.width + EPS, `${label}: right outside`);
  assert.ok(inner.y + inner.height <= outer.y + outer.height + EPS, `${label}: bottom outside`);
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

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const { buildTitleSheet } = await server.ssrLoadModule(
    '/src/core/electrical/titleSheet.ts'
  );
  const { buildPanelSchematic } = await server.ssrLoadModule(
    '/src/core/electrical/schematic.ts'
  );
  const { buildPanelSpecification } = await server.ssrLoadModule(
    '/src/core/electrical/specification.ts'
  );
  const { createLine, defaultPanelSupply } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );

  function line(id, purpose, patch = {}) {
    const base = createLine(purpose, ['room-hall'], 'Зал', 0, 'ceiling');
    return { ...base, id, ...patch };
  }

  function panel({ lines = [], supply = {} } = {}) {
    return {
      id: 'panel-1',
      name: 'ЩР-1',
      anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 0, offsetMm: 2000 },
      heightFromFloorMm: 1600,
      mounting: 'flush',
      supply: { ...defaultPanelSupply(10000), ...supply },
      strategy: 'optimal',
      lines,
    };
  }

  function titleFor(source, options = {}) {
    const rooms = options.rooms ?? [room];
    const cableLengthsMm = options.cableLengthsMm ?? {};
    return buildTitleSheet(
      {
        schematic: buildPanelSchematic(source, { rooms, cableLengthsMm }),
        specification: buildPanelSpecification(source, { rooms, cableLengthsMm }),
        rooms,
        deviceCount: options.deviceCount ?? 7,
      },
      { date: '19.11.2026' }
    );
  }

  await test('title: A3 paper, frame and document block ЭС-00', () => {
    const layout = titleFor(panel({ lines: [line('a', 'sockets')] }));
    assert.equal(layout.paper.width, 420);
    assert.equal(layout.paper.height, 297);
    assert.deepEqual(layout.frame, { x: 20, y: 5, width: 395, height: 287 });
    assert.deepEqual(layout.document.rect, { x: 230, y: 237, width: 185, height: 55 });
    assert.equal(layout.document.designation, 'ЭС-00');
    assert.equal(layout.document.title, 'Титульный лист');
    assert.equal(layout.document.sheet, '1');
    assert.equal(layout.document.sheetTotal, '8');
    assert.equal(layout.document.objectTitle, 'ЩР-1');
    assert.equal(layout.document.date, '19.11.2026');
    assert.match(layout.document.basis, /ПУЭ-7/);
    assert.match(layout.document.basis, /ГОСТ 21\.613-2014/);
  });

  await test('title: header shows object area, rooms and panel', () => {
    const layout = titleFor(panel({ lines: [line('a', 'sockets')] }));
    assert.ok(layout.header.title.length > 0);
    assert.ok(layout.header.subtitle.length > 0);
    assert.match(layout.header.objectLine, /12,0 м²/);
    assert.match(layout.header.objectLine, /1 помещение/);
    assert.match(layout.header.objectLine, /ЩР-1/);
    assert.equal(layout.header.introLines.length, 3);
    for (const text of layout.header.introLines) assert.ok(text.trim().length > 0);
    assert.ok(layout.header.rule.x1 < layout.header.rule.x2);
    inside(
      {
        x: layout.header.rule.x1,
        y: layout.header.rule.y1,
        width: layout.header.rule.x2 - layout.header.rule.x1,
        height: 0,
      },
      layout.frame,
      'header rule'
    );
  });

  await test('title: params, sheets and refs tables stay in the left column zone', () => {
    const layout = titleFor(panel({ lines: [line('a', 'sockets')] }));
    for (const table of [layout.params, layout.sheets, layout.refs]) {
      inside(table.rect, layout.frame, table.id);
      assert.ok(table.rect.y + table.rect.height <= layout.notesBlock.y, `${table.id} above notes`);
      const width = table.columns.reduce((sum, column) => sum + column.width, 0);
      assert.ok(Math.abs(width - table.rect.width) < EPS, `${table.id} columns width`);
    }
    assert.ok(layout.sheets.rect.y + layout.sheets.rect.height <= layout.refs.rect.y, 'sheets above refs');
    assert.ok(layout.params.rect.x < layout.sheets.rect.x, 'sheets are the right column');
    assert.ok(layout.refs.rect.x === layout.sheets.rect.x, 'refs align with sheets');
  });

  await test('title: sheet registry lists all eight documents', () => {
    const layout = titleFor(panel({ lines: [line('a', 'sockets')] }));
    assert.equal(layout.sheets.rows.length, 8);
    assert.deepEqual(
      layout.sheets.rows.map((row) => row.cells[1]),
      ['ЭС-00', 'ЭС-01', 'ЭС-02', 'ЭС-03', 'ЭС-04', 'ЭС-05', 'ЭС-06', 'ЭС-07']
    );
    assert.match(layout.sheets.rows[1].cells[2], /ЩР-1/);
    assert.match(layout.sheets.rows[5].cells[2], /[Рр]озеточ/);
    assert.match(layout.sheets.rows[6].cells[2], /[Оо]светительн/);
    assert.match(layout.sheets.rows[7].cells[2], /[Кк]абельн/);
    for (const row of layout.sheets.rows) {
      assert.ok(row.cells.every((cell) => cell.trim().length > 0));
    }
  });

  await test('title: reference documents include ПУЭ and key ГОСТ/СП', () => {
    const layout = titleFor(panel({ lines: [line('a', 'sockets')] }));
    const codes = layout.refs.rows.map((row) => row.cells[0]);
    for (const code of [
      'ПУЭ-7',
      'СП 256.1325800.2016',
      'СП 31-110-2003',
      'ГОСТ 2.702-2011',
      'ГОСТ 2.104-2006',
      'ГОСТ 21.613-2014',
    ]) {
      assert.ok(codes.includes(code), `${code} must be listed`);
    }
  });

  await test('title: main parameters reflect project data', () => {
    const layout = titleFor(
      panel({ lines: [line('a', 'sockets'), line('b', 'lighting')] }),
      { cableLengthsMm: { a: 8000, b: 4000 }, deviceCount: 9 }
    );
    const rows = new Map(layout.params.rows.map((row) => [row.cells[0], row.cells[1]]));
    assert.equal(layout.params.rows.length, 12);
    assert.equal(rows.get('Площадь помещений'), '12,0 м²');
    assert.equal(rows.get('Помещений'), '1 помещение');
    assert.equal(rows.get('Приборов'), '9');
    assert.equal(rows.get('Групповых линий'), '2');
    assert.match(rows.get('Ввод'), /230 В, 1 фаза/);
    assert.match(rows.get('Ввод'), /TN-S/);
    assert.match(rows.get('Вводной автомат'), /^QF1 \d+ А 2P C$/);
    assert.match(rows.get('Противопожарное УЗО'), /100 мА · тип A S/);
    assert.match(rows.get('Щит'), /рейка|рейки|реек/);
    assert.match(rows.get('Кабель по трассам'), /12 м/);
    for (const [, value] of rows) assert.ok(String(value).trim().length > 0);
  });

  await test('title: empty project says parameters are not set', () => {
    const layout = titleFor(panel(), { rooms: [], deviceCount: 0 });
    const rows = new Map(layout.params.rows.map((row) => [row.cells[0], row.cells[1]]));
    assert.equal(rows.get('Площадь помещений'), 'не задана');
    assert.equal(rows.get('Помещений'), '0 помещений');
    assert.equal(rows.get('Приборов'), '0');
    assert.equal(rows.get('Групповых линий'), '0');
    assert.match(layout.header.objectLine, /не задана/);
    assert.match(layout.header.objectLine, /0 помещений/);
  });

  await test('title: notes explain the working sheets and new plans', () => {
    const layout = titleFor(panel({ lines: [line('a', 'sockets')] }));
    assert.equal(layout.notesTitle, 'Как читать комплект');
    assert.equal(layout.notesLines.length, 5);
    assert.match(layout.notesLines[0], /ЭС-01/);
    assert.match(layout.notesLines[1], /ЭС-02/);
    assert.match(layout.notesLines[2], /ЭС-03/);
    assert.match(layout.notesLines[3], /ЭС-04/);
    assert.match(layout.notesLines[4], /ЭС-05/);
    assert.match(layout.notesLines[4], /ЭС-07/);
    assert.deepEqual(layout.notesBlock, { x: 20, y: 237, width: 205, height: 55 });
  });
} finally {
  await server?.close();
}

console.log(`\ntitleSheet: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

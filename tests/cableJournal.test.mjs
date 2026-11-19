// Кабельный журнал ЭС-07: строки групп, кабели, прокладка, длины,
// итоги, примечания и основная надпись.
// Запуск: node tests/cableJournal.test.mjs
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

function route(id, mode, lengthMm, warning = null) {
  return {
    lineId: id,
    mode,
    cableLengthMm: lengthMm,
    planLengthMm: lengthMm - 1500,
    verticalMm: 1500,
    deviceCount: 1,
    paths: [
      [
        { x: 0, y: 0 },
        { x: 3000, y: 0 },
      ],
    ],
    warning,
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

  const { buildCableJournal } = await server.ssrLoadModule(
    '/src/core/electrical/cableJournal.ts'
  );
  const { buildCableJournalSheet } = await server.ssrLoadModule(
    '/src/core/electrical/cableJournalLayout.ts'
  );
  const { createLine, defaultPanelSupply } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );

  function line(id, purpose, deviceIds, patch = {}) {
    const base = createLine(purpose, ['room-hall'], 'Зал', 0, 'ceiling');
    return { ...base, id, deviceIds, ...patch };
  }

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

  const socketLine = line('line-a', 'sockets', ['d1']);
  const lightLine = line('line-b', 'lighting', ['d2'], { routing: 'floor' });
  const routes = new Map([
    ['line-a', route('line-a', 'ceiling', 8000)],
    ['line-b', route('line-b', 'floor', 4000, 'Трасса проходит по диагонали')],
  ]);

  await test('journal: rows describe groups, cables, routing and lengths', () => {
    const journal = buildCableJournal(panel([socketLine, lightLine]), {
      devices,
      rooms: [room],
      partitions: [],
      routes,
    });
    assert.equal(journal.panelName, 'ЩР-1');
    assert.equal(journal.rows.length, 2);

    const [power, light] = journal.rows;
    assert.equal(power.groupLabel, 'Гр. 1');
    assert.match(power.lineName, /Розетки/);
    assert.equal(power.purposeLabel, 'Розетки');
    assert.equal(power.start, 'ЩР-1');
    assert.equal(power.end, 'Зал');
    assert.match(power.cable, /ВВГнг\(А\)-LS 3×2,5 мм²/);
    assert.equal(power.routingLabel, 'по потолку');
    assert.equal(power.breakerLabel, 'QF1 16 А');
    assert.equal(power.lengthLabel, '8,0 м');

    assert.equal(light.groupLabel, 'Гр. 2');
    assert.equal(light.purposeLabel, 'Освещение');
    assert.match(light.cable, /3×1,5 мм²/);
    assert.equal(light.routingLabel, 'в полу');
    assert.equal(light.breakerLabel, 'QF2 10 А');
    assert.equal(light.warning, 'Трасса проходит по диагонали');
  });

  await test('journal: totals sum cable and count routing modes', () => {
    const journal = buildCableJournal(panel([socketLine, lightLine]), {
      devices,
      rooms: [room],
      partitions: [],
      routes,
    });
    assert.equal(journal.totals.lines, 2);
    assert.ok(Math.abs(journal.totals.cableMeters - 12) < EPS);
    assert.equal(journal.totals.ceilingCount, 1);
    assert.equal(journal.totals.floorCount, 1);
    assert.equal(journal.totals.missingCount, 0);
    assert.deepEqual(journal.warnings, ['Трасса проходит по диагонали']);
  });

  await test('journal: missing routes give dash and missing counter', () => {
    const journal = buildCableJournal(panel([socketLine, lightLine]), {
      devices,
      rooms: [room],
      partitions: [],
      routes: new Map([['line-a', route('line-a', 'ceiling', 8000)]]),
    });
    assert.equal(journal.rows[1].lengthLabel, '—');
    assert.equal(journal.totals.missingCount, 1);
    assert.ok(Math.abs(journal.totals.cableMeters - 8) < EPS);
  });

  await test('journal sheet: A3 table fits above notes with ЭС-07 stamp', () => {
    const journal = buildCableJournal(panel([socketLine, lightLine]), {
      devices,
      rooms: [room],
      partitions: [],
      routes,
    });
    const sheet = buildCableJournalSheet(journal, { date: '19.11.2026' });
    assert.equal(sheet.paper.width, 420);
    assert.equal(sheet.paper.height, 297);
    assert.deepEqual(sheet.frame, { x: 20, y: 5, width: 395, height: 287 });
    assert.equal(sheet.title, 'Кабельный журнал');
    assert.match(sheet.subtitle, /ЩР-1/);
    assert.match(sheet.subtitle, /2 группы/);
    assert.match(sheet.subtitle, /12,0 м/);

    const width = sheet.columns.reduce((sum, column) => sum + column.width, 0);
    assert.equal(width, sheet.table.width);
    assert.equal(sheet.table.rows.length, 2);
    assert.equal(sheet.table.rows[0].cells[0].text, '1');
    assert.match(sheet.table.rows[0].cells[1].text, /Гр\. 1/);
    assert.match(sheet.table.rows[0].cells[4].text, /ВВГнг/);
    assert.equal(sheet.table.rows[0].cells[5].text, 'по потолку');
    assert.equal(sheet.table.rows[0].cells[6].text, '8,0 м');
    assert.ok(sheet.table.bottom <= sheet.notesBlock.y, 'table above notes');
    inside(
      { x: sheet.table.x, y: sheet.table.y, width: sheet.table.width, height: sheet.table.bottom - sheet.table.y },
      sheet.frame,
      'journal table'
    );
    assert.ok(sheet.totalsLine.y > sheet.table.bottom);
    assert.match(sheet.totalsLine.text, /Всего групповых линий: 2/);
    assert.match(sheet.totalsLine.text, /12,0 м/);
    assert.equal(sheet.document.designation, 'ЭС-07');
    assert.equal(sheet.document.sheet, '8');
    assert.equal(sheet.document.sheetTotal, '8');
    assert.equal(sheet.document.objectTitle, 'ЩР-1');
    assert.equal(sheet.document.date, '19.11.2026');
  });

  await test('journal sheet: notes mention cable brand, routing and route warnings', () => {
    const journal = buildCableJournal(panel([socketLine, lightLine]), {
      devices,
      rooms: [room],
      partitions: [],
      routes,
    });
    const sheet = buildCableJournalSheet(journal);
    assert.deepEqual(sheet.notesBlock, { x: 20, y: 237, width: 205, height: 55 });
    assert.equal(sheet.notesTitle, 'Примечания');
    assert.ok(sheet.notesLines.some((line) => /ВВГнг\(А\)-LS/.test(line)));
    assert.ok(sheet.notesLines.some((line) => /Проверить трассы/.test(line)));
    assert.ok(sheet.notesLines.some((line) => /1,5 м/.test(line)));
    for (const line of sheet.notesLines) {
      assert.ok(!line.includes('..'), `double period in: ${line}`);
    }
  });

  await test('journal: empty panel keeps a blank table with no warnings', () => {
    const journal = buildCableJournal(panel([]), {
      devices: [],
      rooms: [],
      partitions: [],
      routes: new Map(),
    });
    assert.equal(journal.rows.length, 0);
    assert.equal(journal.totals.lines, 0);
    assert.equal(journal.totals.cableMeters, 0);
    assert.equal(journal.warnings.length, 0);
    const sheet = buildCableJournalSheet(journal);
    assert.equal(sheet.table.rows.length, 0);
    assert.ok(sheet.table.bottom < sheet.notesBlock.y);
    assert.match(sheet.notesLines[2], /Расхождений по трассам нет/);
    assert.equal(sheet.document.designation, 'ЭС-07');
  });
} finally {
  await server?.close();
}

console.log(`\ncableJournal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

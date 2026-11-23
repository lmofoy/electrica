// Спецификация оборудования и материалов: агрегация аппаратов,
// кабель по сечениям, лист A3 ЭС-03 и примечания.
// Запуск: node tests/panelSpecification.test.mjs
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
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual), `${label}: non-finite ${actual}`);
  assert.ok(Math.abs(actual - expected) <= EPS, `${label}: expected ${expected}, got ${actual}`);
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
const rooms = [room];

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const {
    buildPanelSpecification,
    joinDesignations,
    specificationCableTotalLabel,
  } = await server.ssrLoadModule('/src/core/electrical/specification.ts');
  const {
    buildSpecificationSheet,
    SPECIFICATION_COLUMNS,
    SPECIFICATION_TABLE_WIDTH,
  } = await server.ssrLoadModule('/src/core/electrical/specificationLayout.ts');
  const { buildPanelLayout } = await server.ssrLoadModule('/src/core/electrical/panelLayout.ts');
  const { createLine, defaultPanelSupply } = await server.ssrLoadModule('/src/core/electrical/panel.ts');

  function line(id, purpose, patch = {}) {
    const base = createLine(purpose, ['room-hall'], 'Зал', 0, 'ceiling');
    return { ...base, id, ...patch };
  }

  function panel({ lines = [], supply = {}, strategy = 'optimal' } = {}) {
    return {
      id: 'panel-1',
      name: 'ЩР-1',
      anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 0, offsetMm: 2000 },
      heightFromFloorMm: 1600,
      mounting: 'flush',
      supply: { ...defaultPanelSupply(10000), ...supply },
      strategy,
      lines,
    };
  }

  function specFor(source, options = {}) {
    return buildPanelSpecification(source, { rooms, ...options });
  }

  await test('spec: identical breakers and RCDs are aggregated with designations', () => {
    const lines = [
      line('a', 'sockets', { name: 'Зал — розетки 1' }),
      line('b', 'lighting', { name: 'Зал — свет' }),
      line('c', 'sockets', { name: 'Зал — розетки 2' }),
    ];
    const specification = specFor(panel({ lines }));
    const breakers = specification.items.filter((item) => item.id.startsWith('breaker-'));
    assert.equal(breakers.length, 2);
    const sixteen = breakers.find((item) => item.detail.includes('16 А'));
    const ten = breakers.find((item) => item.detail.includes('10 А'));
    assert.ok(sixteen, '16 A breaker group must exist');
    assert.ok(ten, '10 A breaker group must exist');
    assert.equal(sixteen.quantity, 2);
    assert.equal(sixteen.designation, 'QF2, QF4');
    assert.equal(ten.quantity, 1);
    assert.equal(ten.designation, 'QF3');

    const rcds = specification.items.filter((item) => item.id.startsWith('rcd-'));
    assert.equal(rcds.length, 1);
    assert.equal(rcds[0].quantity, 2);
    assert.equal(rcds[0].designation, 'QD2–QD3');
  });

  await test('spec: frames are counted separately by mounting and posts', () => {
    const frame = (id, posts, mounting) => ({
      id,
      anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 0, offsetMm: 1000 },
      heightFromFloorMm: 300,
      posts,
      mounting,
    });
    const specification = specFor(panel(), {
      frames: [
        frame('f1', 2, 'flush'),
        frame('f2', 2, 'flush'),
        frame('f3', 3, 'flush'),
        frame('f4', 2, 'surface'),
      ],
    });
    const rows = specification.items.filter((item) => item.id.startsWith('frame-'));
    assert.equal(rows.length, 3, 'flush 2, flush 3 and surface 2 are three products');

    const flushTwo = rows.find((item) => item.id === 'frame-flush-2');
    assert.ok(flushTwo, 'flush two-post row exists');
    assert.equal(flushTwo.quantity, 2);
    assert.match(flushTwo.name, /2 места \(скрытая\)/);
    assert.equal(flushTwo.type, 'встраиваемая');

    const surfaceTwo = rows.find((item) => item.id === 'frame-surface-2');
    assert.ok(surfaceTwo, 'surface two-post row exists');
    assert.equal(surfaceTwo.quantity, 1);
    assert.match(surfaceTwo.name, /накладная/);
    assert.equal(surfaceTwo.type, 'накладная');
  });

  await test('spec: combined line buys one АВДТ row, class goes into details', () => {
    const lines = [
      line('a', 'sockets', { combinedProtection: true }),
      line('b', 'sockets'),
    ];
    const specification = specFor({ ...panel({ lines }), breakingCapacityKa: 10 });

    const rcbos = specification.items.filter((item) => item.id.startsWith('rcbo-'));
    assert.equal(rcbos.length, 1);
    assert.equal(rcbos[0].quantity, 1);
    assert.equal(rcbos[0].designation, 'QF2');
    assert.equal(rcbos[0].name, 'Дифавтомат (АВДТ)');
    assert.match(rcbos[0].detail, /16 А/);
    assert.match(rcbos[0].detail, /30 мА/);
    assert.match(rcbos[0].detail, /10 кА/);
    assert.match(rcbos[0].detail, /1P\+N/);

    const breakers = specification.items.filter((item) => item.id.startsWith('breaker-'));
    assert.equal(breakers.length, 1);
    assert.equal(breakers[0].designation, 'QF3');
    assert.match(breakers[0].detail, /10 кА/);

    const rcds = specification.items.filter((item) => item.id.startsWith('rcd-'));
    assert.equal(rcds.length, 1);
    assert.equal(rcds[0].designation, 'QD2');
    assert.ok(
      specification.notes.some((note) => note.includes('Дифавтомат объединяет автомат и УЗО'))
    );
  });

  await test('spec: enclosure and input hardware are present with quantities', () => {
    const specification = specFor(panel({ lines: [line('a', 'sockets')] }));
    const ids = specification.items.map((item) => item.id);
    for (const id of ['input-breaker', 'meter', 'main-rcd', 'voltage-relay', 'spd', 'enclosure']) {
      assert.ok(ids.includes(id), `${id} must be in the specification`);
    }
    const enclosure = specification.items.find((item) => item.id === 'enclosure');
    const layout = buildPanelLayout(panel({ lines: [line('a', 'sockets')] }));
    assert.equal(enclosure.quantity, 1);
    assert.ok(enclosure.detail.includes(String(layout.enclosureModules)));
    assert.equal(specification.enclosure.modules, layout.enclosureModules);
    assert.equal(specification.enclosure.rails, layout.rowsCount);
    assert.equal(specification.enclosure.occupied, layout.modulesTotal);
    assert.equal(specification.totals.equipmentUnits,
      specification.items
        .filter((item) => item.section === 'equipment')
        .reduce((sum, item) => sum + item.quantity, 0));
  });

  await test('spec: cable is grouped by brand, cores and section and rounded up', () => {
    const lines = [
      line('a', 'sockets'),
      line('b', 'lighting'),
      line('c', 'sockets'),
    ];
    const specification = specFor(panel({ lines }), {
      cableLengthsMm: { a: 10000, b: 5000, c: 7000 },
    });
    const materials = specification.items.filter((item) => item.section === 'materials');
    const inputCable = materials.find((item) => item.id === 'input-cable');
    assert.ok(inputCable, 'input cable row must exist');
    assert.equal(inputCable.quantity, 0);
    assert.equal(inputCable.note, 'длина по месту');

    const socketCable = materials.find((item) => item.detail === '3×2,5 мм²');
    const lightCable = materials.find((item) => item.detail === '3×1,5 мм²');
    assert.ok(socketCable && lightCable);
    assert.equal(socketCable.quantity, 17);
    assert.equal(lightCable.quantity, 5);
    assert.equal(socketCable.note, 'по длинам трасс с запасом');
    assert.equal(specification.totals.cableMeters, 22);
    assert.equal(specificationCableTotalLabel(specification), '22 м');
  });

  await test('spec: whole meters round up, not to nearest', () => {
    const specification = specFor(panel({ lines: [line('a', 'sockets')] }), {
      cableLengthsMm: { a: 1001 },
    });
    const socketCable = specification.items.find((item) => item.detail === '3×2,5 мм²');
    assert.equal(socketCable.quantity, 2);
  });

  await test('spec: empty panel has no group rows and says lines are not set', () => {
    const specification = specFor(panel());
    assert.equal(specification.items.filter((item) => item.id.startsWith('breaker-')).length, 0);
    assert.equal(specification.items.filter((item) => item.id.startsWith('rcd-')).length, 0);
    assert.equal(specification.totals.cableMeters, 0);
    assert.equal(specification.statusText, 'Линии не заданы');
    assert.ok(specification.notes.some((note) => note.includes('линии не заданы')));
  });

  await test('spec: designations join contiguous ranges only', () => {
    assert.equal(joinDesignations(['QF2', 'QF3', 'QF4']), 'QF2–QF4');
    assert.equal(joinDesignations(['QF2', 'QF4']), 'QF2, QF4');
    assert.equal(joinDesignations(['QF7']), 'QF7');
    assert.equal(joinDesignations(['QD2', 'QD3', 'QD5']), 'QD2, QD3, QD5');
    assert.equal(joinDesignations([]), '—');
  });

  await test('spec sheet: A3 frame, table columns and document block', () => {
    const specification = specFor(panel({
      lines: [line('a', 'sockets'), line('b', 'lighting')],
    }), { cableLengthsMm: { a: 8000, b: 4000 } });
    const sheet = buildSpecificationSheet(specification, { date: '14.11.2026' });
    assert.equal(sheet.paper.width, 420);
    assert.equal(sheet.paper.height, 297);
    assert.equal(sheet.document.designation, 'ЭС-03');
    assert.equal(sheet.table.columns.length, 7);
    assert.equal(SPECIFICATION_COLUMNS.length, 7);
    near(
      SPECIFICATION_TABLE_WIDTH,
      SPECIFICATION_COLUMNS.reduce((sum, column) => sum + column.width, 0),
      'columns width'
    );
    near(SPECIFICATION_TABLE_WIDTH, 380, 'table width');
    assert.equal(sheet.statusText, specification.statusText);
    assert.ok(sheet.notesLines.length >= 5);
    inside(sheet.document.rect, sheet.frame, 'title block');
    inside(
      { x: sheet.table.x, y: sheet.table.y, width: sheet.table.width, height: sheet.table.bottom - sheet.table.y },
      sheet.frame,
      'table'
    );
  });

  await test('spec sheet: sections, sequential positions and total row', () => {
    const specification = specFor(panel({
      lines: [line('a', 'sockets'), line('b', 'lighting')],
    }), { cableLengthsMm: { a: 8000, b: 4000 } });
    const sheet = buildSpecificationSheet(specification, { date: '14.11.2026' });
    const sections = sheet.table.rows.filter((row) => row.kind === 'section');
    assert.deepEqual(sections.map((row) => row.label), ['Оборудование', 'Материалы']);
    const items = sheet.table.rows.filter((row) => row.kind === 'item');
    assert.equal(items.length, specification.items.length);
    assert.deepEqual(items.map((row) => row.index), specification.items.map((_, index) => index + 1));
    const last = sheet.table.rows[sheet.table.rows.length - 1];
    assert.equal(last.kind, 'total');
    assert.ok(sheet.table.bottom <= sheet.notesBlock.y + EPS, 'table must not overlap notes');
    for (const row of sheet.table.rows) {
      assert.ok(row.height > 0);
      assert.ok(row.y + row.height <= sheet.table.bottom + EPS);
    }
    for (const row of items) {
      const name = row.cells.find((cell) => cell.columnId === 'name');
      assert.ok(name.sub, 'item row keeps technical detail unless compact');
    }
  });

  await test('spec sheet: long dictionaries stay inside the notes boundary', () => {
    const lines = [];
    for (let index = 0; index < 24; index += 1) {
      lines.push(
        line(`line-${index}`, index % 2 === 0 ? 'sockets' : 'lighting', {
          name: `Линия ${index + 1}`,
        })
      );
    }
    const specification = specFor(panel({ lines }));
    const sheet = buildSpecificationSheet(specification, { date: '14.11.2026' });
    assert.ok(sheet.table.rows.filter((row) => row.kind === 'item').length > 8);
    assert.ok(sheet.table.bottom <= sheet.notesBlock.y + EPS);
    assert.ok(sheet.table.rowHeight >= 2.6 - EPS);
  });
} finally {
  await server?.close();
}

console.log(`\npanelSpecification: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

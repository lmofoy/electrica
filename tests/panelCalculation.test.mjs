// Расчётная таблица нагрузок: строки, мощности, токи, ΔU, фазы,
// итоги, примечания и раскладка листа A3.
// Запуск: node tests/panelCalculation.test.mjs
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

const livingRoom = {
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
const bathroom = {
  ...livingRoom,
  id: 'room-bath',
  name: 'Ванная',
  type: 'bathroom',
  vertices: [
    { x: 4000, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 2000 },
    { x: 4000, y: 2000 },
  ],
};
const rooms = [livingRoom, bathroom];

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const {
    buildPanelCalculation,
    calculationCableTotalLabel,
    calculationStatus,
    calculationStatusText,
  } = await server.ssrLoadModule('/src/core/electrical/calculation.ts');
  const {
    buildCalculationSheet,
    CALCULATION_COLUMNS,
    CALCULATION_TABLE_WIDTH,
  } = await server.ssrLoadModule('/src/core/electrical/calculationLayout.ts');
  const {
    createLine,
    defaultPanelSupply,
  } = await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const {
    makeBreaker,
    makeCable,
    makeRcd,
  } = await server.ssrLoadModule('/src/core/electrical/norms.ts');

  function line(id, purpose, patch = {}) {
    const base = createLine(
      purpose,
      patch.roomIds ?? ['room-hall'],
      patch.roomName ?? 'Зал',
      0,
      'ceiling'
    );
    return { ...base, id, ...patch };
  }

  function panel({ lines = [], supply = {}, strategy = 'optimal' } = {}) {
    return {
      id: 'panel-1',
      name: 'ЩР-1',
      anchor: {
        kind: 'room_edge',
        roomId: 'room-hall',
        edgeIndex: 0,
        offsetMm: 2000,
      },
      heightFromFloorMm: 1600,
      mounting: 'flush',
      supply: { ...defaultPanelSupply(10000), ...supply },
      strategy,
      lines,
    };
  }

  function bigThreePhaseSupply(overrides = {}) {
    return {
      ...defaultPanelSupply(30000),
      allocatedPowerW: 30000,
      phases: 3,
      inputCable: { sectionMm2: 16, cores: 5 },
      inputBreaker: { poles: 4, ratingA: 63, curve: 'C' },
      mainRcd: { ...makeRcd(100, 'A', 63, true), poles: 4 },
      ...overrides,
    };
  }

  function calculationFor(source, options = {}) {
    return buildPanelCalculation(source, { rooms, ...options });
  }

  function rowByLine(calculation, lineId) {
    return calculation.rows.find((row) => row.lineId === lineId);
  }

  await test('calculation: rows mirror schematic groups and designations', () => {
    const lines = [
      line('a', 'sockets', {
        name: 'Зал — розетки',
        deviceIds: ['d1', 'd2'],
      }),
      line('b', 'lighting', {
        name: 'Зал — свет',
        deviceIds: ['d3'],
      }),
      line('c', 'wet', {
        name: 'Ванная — розетки',
        roomIds: ['room-bath'],
        roomName: 'Ванная',
      }),
    ];
    const calculation = calculationFor(panel({ lines }));
    assert.equal(calculation.rows.length, 3);
    assert.deepEqual(
      calculation.rows.map((row) => row.designation),
      ['QF2', 'QF3', 'QF4']
    );
    assert.deepEqual(
      calculation.rows.map((row) => row.rcdDesignation),
      ['QD2', null, 'QD3']
    );
    assert.deepEqual(
      calculation.rows.map((row) => row.purposeLabel),
      ['Розетки', 'Освещение', 'Розетки влажной зоны']
    );
    assert.deepEqual(
      calculation.rows.map((row) => row.roomsLabel),
      ['Зал', 'Зал', 'Ванная']
    );
    assert.deepEqual(
      calculation.rows.map((row) => row.deviceCount),
      [2, 1, 0]
    );
    assert.deepEqual(
      calculation.rows.map((row) => row.index),
      [1, 2, 3]
    );
  });

  await test('calculation: demand factor and cos phi drive design power and current', () => {
    const target = line('a', 'sockets', {
      loadW: 2300,
      cosPhi: 0.92,
      demandFactor: 0.8,
    });
    const calculation = calculationFor(panel({ lines: [target] }));
    const row = rowByLine(calculation, 'a');
    near(row.installedPowerW, 2300, 'installed');
    near(row.demandFactor, 0.8, 'demand');
    near(row.cosPhi, 0.92, 'cos');
    near(row.designPowerW, 1840, 'design');
    near(row.designCurrentA, 1840 / (230 * 0.92), 'current');
    assert.equal(row.status, 'ok');
    assert.equal(row.voltageDropPercent, 0);
    assert.equal(row.voltageDropOk, true);
  });

  await test('calculation: voltage drop uses route length and the 5 % limit', () => {
    const target = line('long', 'sockets', {
      loadW: 3680,
      cosPhi: 1,
      demandFactor: 1,
      cable: makeCable(2.5),
      breaker: makeBreaker(16, 'C'),
    });
    const expected = ((2 * 0.0175 * 60) / 2.5) * 16 * (100 / 230);
    const long = calculationFor(panel({ lines: [target] }), {
      cableLengthsMm: { long: 60000 },
    });
    const longRow = rowByLine(long, 'long');
    near(longRow.cableLengthMm, 60000, 'length');
    near(longRow.voltageDropPercent, expected, 'drop');
    assert.equal(longRow.voltageDropLimitPercent, 5);
    assert.equal(longRow.voltageDropOk, false);
    assert.equal(longRow.status, 'warning');
    assert.ok(longRow.warnings >= 1, 'voltage-drop finding must raise a warning');

    const short = calculationFor(panel({ lines: [target] }), {
      cableLengthsMm: { long: 5000 },
    });
    const shortRow = rowByLine(short, 'long');
    assert.equal(shortRow.voltageDropOk, true);
    assert.equal(shortRow.status, 'ok');
  });

  await test('calculation: lighting keeps the stricter 3 % voltage-drop limit', () => {
    const light = line('light', 'lighting');
    const calculation = calculationFor(panel({ lines: [light] }), {
      cableLengthsMm: { light: 150000 },
    });
    const row = rowByLine(calculation, 'light');
    assert.equal(row.voltageDropLimitPercent, 3);
    assert.ok(row.voltageDropPercent > 3, 'drop must exceed the lighting limit');
    assert.equal(row.voltageDropOk, false);
    assert.equal(row.status, 'warning');
  });

  await test('calculation: totals follow supply, device counts and cable lengths', () => {
    const lines = [
      line('a', 'sockets', { deviceIds: ['d1', 'd2'], loadW: 2000 }),
      line('b', 'lighting', { deviceIds: ['d3'], loadW: 500 }),
    ];
    const calculation = calculationFor(panel({ lines }), {
      cableLengthsMm: new Map([
        ['a', 12000],
        ['b', 3000],
      ]),
    });
    assert.equal(calculation.totals.rowCount, 2);
    assert.equal(calculation.totals.deviceCount, 3);
    near(calculation.totals.installedPowerW, 2500, 'installed');
    near(calculation.totals.designPowerW, 2500, 'design');
    near(calculation.totals.designCurrentA, calculation.supply.designCurrentA, 'current');
    near(calculation.totals.cableLengthMm, 15000, 'cable');
    assert.equal(calculation.totals.errorRows, 0);
    assert.equal(calculation.totals.warningRows, 0);
    assert.equal(calculationCableTotalLabel(calculation), '15,0 м');

    const noLengths = calculationFor(panel({ lines }));
    assert.equal(calculationCableTotalLabel(noLengths), 'не рассчитан');
  });

  await test('calculation: three-phase panel builds per-phase loads and imbalance', () => {
    const lines = [
      line('a', 'sockets', { loadW: 2000, phase: 'L1' }),
      line('b', 'sockets', { loadW: 2000, phase: 'L2' }),
      line('c', 'sockets', { loadW: 2000, phase: 'L3' }),
    ];
    const calculation = calculationFor(
      panel({ lines, supply: bigThreePhaseSupply() })
    );
    assert.deepEqual(
      calculation.phaseLoads.map((load) => load.phase),
      ['L1', 'L2', 'L3']
    );
    for (const load of calculation.phaseLoads) {
      near(load.designPowerW, 2000, `${load.phase} power`);
      near(load.currentA, 2000 / 230, `${load.phase} current`);
      assert.equal(load.groups, 1);
    }
    near(calculation.phaseImbalancePercent, 0, 'imbalance');
    assert.equal(calculation.input.phaseLabel, 'L1–L3');
    assert.ok(calculation.notes.some((note) => note.includes('Фазы: L1')));
    assert.ok(calculation.notes.some((note) => note.includes('не более 15 %')));
    assert.equal(calculationStatus(calculation), 'ok');
  });

  await test('calculation: single-phase panel has no phase loads', () => {
    const calculation = calculationFor(
      panel({ lines: [line('a', 'sockets')] })
    );
    assert.deepEqual(calculation.phaseLoads, []);
    assert.equal(calculation.phaseImbalancePercent, 0);
    assert.equal(calculation.input.phaseLabel, 'L');
    assert.ok(
      calculation.notes.some((note) => note.includes('Однофазный ввод 230 В'))
    );
  });

  await test('calculation: input row carries supply values and global findings', () => {
    const lines = [
      line('a', 'sockets', { loadW: 2000 }),
      line('b', 'sockets', { loadW: 2000 }),
    ];
    const clean = calculationFor(panel({ lines }));
    assert.equal(clean.input.designation, 'QF1');
    near(clean.input.installedPowerW, 4000, 'installed');
    near(clean.input.designPowerW, 4000, 'design');
    near(clean.input.designCurrentA, 4000 / (230 * 0.96), 'current');
    assert.equal(clean.input.status, 'ok');

    const unbalanced = calculationFor(
      panel({
        lines: [
          line('a', 'sockets', { loadW: 7000, phase: 'L1' }),
          line('b', 'sockets', { loadW: 1000, phase: 'L2' }),
          line('c', 'sockets', { loadW: 1000, phase: 'L3' }),
        ],
        supply: bigThreePhaseSupply(),
      })
    );
    assert.equal(unbalanced.input.status, 'warning');
    assert.ok(unbalanced.input.warnings >= 1, 'imbalance is a panel-level warning');
  });

  await test('calculation: a normative error marks its row and the sheet', () => {
    const target = line('bad', 'sockets', {
      loadW: 2000,
      breaker: makeBreaker(32, 'C'),
      cable: makeCable(2.5),
    });
    const calculation = calculationFor(panel({ lines: [target] }));
    const row = rowByLine(calculation, 'bad');
    assert.equal(row.status, 'error');
    assert.ok(row.errors >= 1);
    assert.equal(calculationStatus(calculation), 'error');
    assert.match(calculationStatusText(calculation), /^Ошибок: \d+$/);
    assert.equal(calculation.totals.errorRows, 1);

    const layout = buildCalculationSheet(calculation, { date: '12.11.2026' });
    assert.equal(layout.status, 'errors');
    assert.equal(layout.headerBoxes[2].tone, 'error');
    const lineRow = layout.table.rows.find((item) => item.kind === 'line');
    assert.equal(lineRow.cells.find((cell) => cell.columnId === 'status').tone, 'error');
  });

  await test('calculation: notes cover formulas, norms and the final check', () => {
    const calculation = calculationFor(
      panel({ lines: [line('a', 'sockets')] }),
      { cableLengthsMm: { a: 12000 } }
    );
    assert.equal(calculation.notes.length, 10);
    for (const note of calculation.notes) assert.ok(note.trim().length > 0);
    assert.match(calculation.notes[0], /230 В, 1 фаза/);
    assert.match(calculation.notes[0], /TN-S/);
    assert.match(calculation.notes[2], /Pр = Pу·Kс/);
    assert.match(calculation.notes[2], /ΔU/);
    assert.match(calculation.notes[7], /3 %/);
    assert.match(calculation.notes[7], /5 %/);
    assert.match(calculation.notes[9], /ошибок 0/);
    assert.ok(
      calculation.references.some((reference) => reference.includes('ПУЭ-7, табл. 1.3.4'))
    );
    assert.ok(
      calculation.references.some((reference) => reference.includes('СП 31-110-2003'))
    );
    assert.ok(
      calculation.references.some((reference) => reference.includes('0,0175'))
    );
  });

  await test('sheet: A3 frame, table and bottom blocks stay inside the paper', () => {
    const calculation = calculationFor(
      panel({
        lines: [
          line('a', 'sockets'),
          line('b', 'lighting'),
        ],
      }),
      { cableLengthsMm: { a: 12000, b: 3000 } }
    );
    const layout = buildCalculationSheet(calculation, { date: '12.11.2026' });
    assert.equal(layout.paper.width, 420);
    assert.equal(layout.paper.height, 297);
    assert.deepEqual(layout.frame, { x: 20, y: 5, width: 395, height: 287 });

    assert.equal(layout.table.x, 27.5);
    assert.equal(layout.table.y, 38.5);
    assert.equal(layout.table.width, 380);
    assert.equal(layout.table.headerHeight, 8.5);
    near(CALCULATION_TABLE_WIDTH, 380, 'table width');
    assert.deepEqual(
      layout.table.columns.map((column) => column.id),
      CALCULATION_COLUMNS.map((column) => column.id)
    );
    assert.ok(layout.table.bottom <= 233 + EPS, 'table must end above the bottom blocks');

    const kinds = layout.table.rows.map((row) => row.kind);
    assert.deepEqual(kinds, ['input', 'line', 'line', 'total']);
    let previousBottom = -Infinity;
    for (const row of layout.table.rows) {
      inside(
        {
          x: layout.table.x,
          y: row.y,
          width: layout.table.width,
          height: row.height,
        },
        layout.frame,
        `row ${row.kind}`
      );
      assert.ok(row.y >= previousBottom - EPS, 'rows must not overlap');
      previousBottom = row.y + row.height;
    }
    near(previousBottom, layout.table.bottom, 'table bottom');
    assert.equal(layout.table.rowHeight, 7);

    assert.deepEqual(layout.notesBlock, { x: 20, y: 237, width: 205, height: 55 });
    assert.deepEqual(layout.document.rect, { x: 230, y: 237, width: 185, height: 55 });
    inside(layout.notesBlock, layout.frame, 'notes');
    inside(layout.document.rect, layout.frame, 'document');
    assert.ok(
      layout.notesBlock.x + layout.notesBlock.width < layout.document.rect.x,
      'notes and document must not touch'
    );
  });

  await test('sheet: header boxes summarise powers, input and status', () => {
    const calculation = calculationFor(
      panel({ lines: [line('a', 'sockets')] })
    );
    const layout = buildCalculationSheet(calculation, { date: '12.11.2026' });
    assert.equal(layout.headerBoxes.length, 3);
    assert.deepEqual(
      layout.headerBoxes.map((box) => box.title),
      ['Мощности', 'Ввод', 'Проверка по нормам']
    );
    let previousRight = -Infinity;
    for (const box of layout.headerBoxes) {
      inside(box.rect, layout.frame, box.title);
      assert.ok(box.rect.x >= previousRight - EPS, 'header boxes must not overlap');
      assert.ok(box.lines.length >= 2);
      previousRight = box.rect.x + box.rect.width;
    }
    assert.equal(layout.headerBoxes[0].rect.y, 21.5);
    assert.equal(layout.headerBoxes[0].rect.height, 12.5);
    assert.equal(layout.headerBoxes[2].tone, 'ok');
    assert.equal(layout.headerBoxes[2].lines[0], 'Нормы соблюдены');
    assert.match(layout.headerBoxes[0].lines[0], /Pу/);
    assert.match(layout.headerBoxes[0].lines[0], /Pр/);
    assert.match(layout.headerBoxes[1].lines[0], /QF1/);
  });

  await test('sheet: document block identifies the calculation sheet', () => {
    const layout = buildCalculationSheet(
      calculationFor(panel({ lines: [line('a', 'sockets')] })),
      { date: '12.11.2026' }
    );
    const document = layout.document;
    assert.equal(document.title, 'Расчёт нагрузок');
    assert.equal(document.objectTitle, 'ЩР-1');
    assert.equal(document.designation, 'ЭС-02');
    assert.equal(document.stage, 'Стадия Р');
    assert.equal(document.sheet, '1');
    assert.equal(document.sheetTotal, '1');
    assert.equal(document.organization, 'Electrica');
    assert.equal(document.date, '12.11.2026');
    assert.match(document.basis, /ПУЭ-7/);
    assert.deepEqual(
      document.roles.map((role) => role.label),
      ['Разраб.', 'Пров.', 'Т. контр.', 'Н. контр.', 'Утв.']
    );
    assert.equal(document.roles[0].date, '12.11.2026');
    assert.equal(document.roles[0].labelRect.x, 230);
    assert.equal(document.roles[0].labelRect.width, 30);
    assert.equal(document.roles[0].labelRect.y, 252);
    assert.ok(document.grid.length > 0);
    assert.equal(layout.title, 'Расчёт нагрузок групповых линий и ввода');
    assert.match(layout.subtitle, /ЩР-1/);
    assert.match(layout.subtitle, /230 В, 1 фаза/);
    assert.equal(layout.notesLines.length, 10);
  });

  await test('sheet: 40 lines stay compact and separated', () => {
    const lines = Array.from({ length: 40 }, (_, index) =>
      line(`dense-${index}`, 'sockets', { name: `Группа ${index + 1}` })
    );
    const layout = buildCalculationSheet(
      calculationFor(panel({ lines })),
      { date: '12.11.2026' }
    );
    assert.equal(layout.table.rows.filter((row) => row.kind === 'line').length, 40);
    assert.equal(layout.table.compact, true);
    assert.ok(layout.table.rowHeight >= 2.2 - EPS);
    assert.ok(layout.table.rowHeight < 5.2);

    let previousBottom = -Infinity;
    for (const row of layout.table.rows) {
      assert.ok(row.height > 0);
      assert.ok(row.y >= previousBottom - EPS, 'rows must not overlap');
      previousBottom = row.y + row.height;
    }
    assert.ok(layout.table.bottom <= 233 + EPS);
    const firstLine = layout.table.rows.find((row) => row.kind === 'line');
    assert.equal(
      firstLine.cells.find((cell) => cell.columnId === 'name').sub,
      undefined,
      'compact rows drop the second text line'
    );
  });

  await test('sheet: empty panel shows a placeholder and a warning status', () => {
    const calculation = buildPanelCalculation(panel({ lines: [] }), { rooms });
    assert.equal(calculation.rows.length, 0);
    assert.equal(calculationStatusText(calculation), 'Линии не заданы');
    const layout = buildCalculationSheet(calculation, { date: '12.11.2026' });
    assert.deepEqual(
      layout.table.rows.map((row) => row.kind),
      ['input', 'empty', 'total']
    );
    const empty = layout.table.rows[1];
    assert.equal(
      empty.cells.find((cell) => cell.columnId === 'name').text,
      'Групповые линии не заданы'
    );
    assert.equal(layout.status, 'warnings');
    assert.equal(layout.statusText, 'Линии не заданы');
    assert.equal(layout.headerBoxes[2].tone, 'warning');
    assert.equal(layout.headerBoxes[2].lines[0], 'Линии не заданы');
  });

  await test('sheet: line cells expose cable length, drop limit and status', () => {
    const target = line('a', 'sockets', {
      loadW: 3680,
      cosPhi: 1,
      cable: makeCable(2.5),
      breaker: makeBreaker(16, 'C'),
    });
    const layout = buildCalculationSheet(
      calculationFor(panel({ lines: [target] }), {
        cableLengthsMm: { a: 60000 },
      }),
      { date: '12.11.2026' }
    );
    const row = layout.table.rows.find((item) => item.kind === 'line');
    const cell = (id) => row.cells.find((item) => item.columnId === id);
    assert.equal(cell('designation').text, 'QF2');
    assert.equal(cell('length').text, '60,0');
    assert.equal(cell('drop').text, '5,8');
    assert.equal(cell('drop').sub, '≤ 5');
    assert.equal(cell('drop').tone, 'warning');
    assert.notEqual(cell('status').text, 'ОК');
    assert.equal(cell('status').tone, 'warning');
    assert.equal(cell('name').sub.includes('Розетки'), true);
  });
} catch (error) {
  failed += 1;
  console.error(`FAIL test setup\n${error.stack ?? error}`);
} finally {
  if (server) {
    try {
      await server.close();
    } catch (error) {
      failed += 1;
      console.error(`FAIL Vite cleanup\n${error.stack ?? error}`);
    }
  }
}

console.log(`\npanelCalculation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

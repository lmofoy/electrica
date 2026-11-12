// Раскладка листа A3: рамка, основная надпись, шины, ряды групп.
// Запуск: node tests/panelSheet.test.mjs
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

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const { buildPanelSheet } = await server.ssrLoadModule(
    '/src/core/electrical/sheetLayout.ts'
  );
  const { buildPanelSchematic } = await server.ssrLoadModule(
    '/src/core/electrical/schematic.ts'
  );
  const { createLine, defaultPanelSupply } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );

  function line(id, purpose, patch = {}) {
    const base = createLine(purpose, ['room-hall'], 'Зал', 0, 'ceiling');
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

  function sheetFor(source, options) {
    return buildPanelSheet(buildPanelSchematic(source, { rooms: [livingRoom] }), options);
  }

  await test('sheet: A3 frame and bottom blocks stay inside the paper', () => {
    const layout = sheetFor(panel({ lines: [line('a', 'sockets')] }), {
      date: '12.11.2026',
    });
    assert.equal(layout.paper.width, 420);
    assert.equal(layout.paper.height, 297);
    assert.deepEqual(layout.frame, { x: 20, y: 5, width: 395, height: 287 });
    near(layout.frame.x + layout.frame.width, 415, 'frame.right');
    near(layout.frame.y + layout.frame.height, 292, 'frame.bottom');

    assert.deepEqual(layout.titleBlock.rect, {
      x: 230,
      y: 237,
      width: 185,
      height: 55,
    });
    inside(layout.titleBlock.rect, layout.frame, 'titleBlock');
    inside(layout.notesBlock, layout.frame, 'notesBlock');
    assert.equal(layout.notesBlock.width, 205);
    assert.equal(layout.notesBlock.x, 20);
    assert.ok(
      layout.notesBlock.x + layout.notesBlock.width < layout.titleBlock.rect.x,
      'notes must not touch the title block'
    );
    assert.ok(layout.drawingArea.y + layout.drawingArea.height < layout.notesBlock.y);
    assert.equal(layout.titleBlock.date, '12.11.2026');
    assert.equal(layout.titleBlock.designation, 'ЭС-01');
    assert.equal(layout.titleBlock.objectTitle, 'ЩР-1');
  });

  await test('sheet: title block follows GOST 2.104 form 1 geometry and content', () => {
    const layout = sheetFor(panel({ lines: [line('a', 'sockets')] }), {
      date: '12.11.2026',
    });
    const block = layout.titleBlock;
    assert.deepEqual(block.rect, { x: 230, y: 237, width: 185, height: 55 });
    const field = Object.fromEntries(block.fields.map((item) => [item.id, item]));
    assert.deepEqual(field.designation.rect, { x: 295, y: 237, width: 120, height: 15 });
    assert.deepEqual(field.name.rect, { x: 295, y: 257, width: 70, height: 20 });
    assert.deepEqual(field.material.rect, { x: 295, y: 277, width: 70, height: 15 });
    assert.deepEqual(field.litera.rect, { x: 365, y: 257, width: 15, height: 15 });
    assert.deepEqual(field.mass.rect, { x: 380, y: 257, width: 17, height: 15 });
    assert.deepEqual(field.scale.rect, { x: 397, y: 257, width: 18, height: 15 });
    assert.deepEqual(field.sheet.rect, { x: 365, y: 272, width: 20, height: 5 });
    assert.deepEqual(field.sheets.rect, { x: 385, y: 272, width: 30, height: 5 });
    assert.deepEqual(field.organization.rect, { x: 365, y: 277, width: 50, height: 15 });
    for (const item of block.fields) inside(item.rect, block.rect, `field ${item.id}`);

    const headers = new Map(block.headers.map((item) => [item.id, item]));
    assert.equal(headers.get('change').text, 'Изм.');
    assert.equal(headers.get('sheet').text, 'Лист');
    assert.equal(headers.get('document').text, '№ докум.');
    assert.equal(headers.get('signature').text, 'Подп.');
    assert.equal(headers.get('date').text, 'Дата');
    assert.equal(headers.get('litera').text, 'Лит.');
    assert.equal(headers.get('mass').text, 'Масса');
    assert.equal(headers.get('scale').text, 'Масштаб');

    assert.deepEqual(
      block.roles.map((role) => role.label),
      ['Разраб.', 'Пров.', 'Т. контр.', 'Н. контр.', 'Утв.']
    );
    const developer = block.roles[0];
    assert.deepEqual(developer.labelRect, { x: 230, y: 262, width: 17, height: 5 });
    assert.deepEqual(developer.nameRect, { x: 247, y: 262, width: 23, height: 5 });
    assert.deepEqual(developer.signatureRect, { x: 270, y: 262, width: 15, height: 5 });
    assert.deepEqual(developer.dateRect, { x: 285, y: 262, width: 10, height: 5 });
    assert.equal(developer.date, '12.11.2026');
    assert.equal(block.roles[3].labelRect.y, 282, 'Н. контр. оставляет пустую строку выше');

    const hasLine = (x1, y1, x2, y2) =>
      block.grid.some(
        (line) =>
          Math.abs(line.x1 - x1) < EPS &&
          Math.abs(line.y1 - y1) < EPS &&
          Math.abs(line.x2 - x2) < EPS &&
          Math.abs(line.y2 - y2) < EPS
      );
    assert.equal(
      block.grid.filter((line) => line.x1 === 230 && line.x2 === 295 && line.y1 === line.y2)
        .length,
      10,
      '11 строк по 5 мм'
    );
    assert.ok(hasLine(237, 237, 237, 262), 'граница 7/10 мм только над подписями');
    assert.ok(hasLine(295, 252, 415, 252), 'низ графы 2');
    assert.ok(hasLine(370, 257, 370, 272), 'литера из трёх ячеек');
    assert.ok(hasLine(375, 257, 375, 272), 'литера из трёх ячеек');
    assert.ok(hasLine(385, 272, 385, 277), 'граница Лист/Листов');

    assert.equal(block.designation, 'ЭС-01');
    assert.equal(block.litera, 'Р');
    assert.equal(block.scale, 'б/м');
    assert.equal(block.organization, 'Electrica');
    assert.equal(field.name.lines[0].text, 'ЩР-1');
    assert.match(field.name.lines[1].text, /Схема электрическая принципиальная/);
    assert.equal(block.date, '12.11.2026');
    assert.equal(block.basis, 'ГОСТ 2.104-2006, форма 1');
  });

  await test('sheet: one-phase panel gets L, N, PE buses', () => {
    const layout = sheetFor(
      panel({ lines: [line('a', 'sockets'), line('b', 'lighting')] })
    );
    assert.deepEqual(
      layout.buses.map((bus) => bus.key),
      ['L', 'N', 'PE']
    );
    assert.ok(layout.buses[0].x < layout.buses[1].x);
    assert.ok(layout.buses[1].x < layout.buses[2].x);
    for (const group of layout.groups) {
      assert.equal(group.tapX, layout.buses[0].x, 'one-phase groups tap the L bus');
      assert.equal(group.phaseColor, layout.buses[0].color);
      assert.equal(group.group.phase, null);
    }
    assert.match(layout.notesLines[0], /230 В, 1 фаза/);
    assert.match(layout.notesLines[0], /TN-S/);
  });

  await test('sheet: three-phase panel gets five buses and maps group phases', () => {
    const layout = sheetFor(
      panel({
        supply: {
          phases: 3,
          system: 'TN-C-S',
          inputCable: { sectionMm2: 6, cores: 5 },
          inputBreaker: { poles: 4, ratingA: 25, curve: 'C' },
        },
        lines: [
          line('a', 'sockets', { phase: 'L2' }),
          line('b', 'lighting', { phase: 'L3' }),
        ],
      })
    );
    assert.deepEqual(
      layout.buses.map((bus) => bus.key),
      ['L1', 'L2', 'L3', 'N', 'PE']
    );
    for (let index = 1; index < layout.buses.length; index += 1) {
      assert.ok(layout.buses[index - 1].x < layout.buses[index].x);
    }
    const byKey = new Map(layout.buses.map((bus) => [bus.key, bus]));
    assert.equal(layout.groups[0].group.phase, 'L2');
    assert.equal(layout.groups[0].tapX, byKey.get('L2').x);
    assert.equal(layout.groups[0].phaseColor, byKey.get('L2').color);
    assert.equal(layout.groups[1].group.phase, 'L3');
    assert.equal(layout.groups[1].tapX, byKey.get('L3').x);
    assert.match(layout.notesLines[0], /380\/220 В, 3 фазы/);
    assert.match(layout.notesLines[0], /TN-C-S/);
    assert.match(layout.notesLines[3], /5×6 мм²/);
    assert.match(layout.notesLines[3], /QF1 25 А 4P C/);
  });

  await test('sheet: 22 groups fit above the bottom blocks without overlap', () => {
    const lines = Array.from({ length: 22 }, (_, index) =>
      line(`line-${index}`, 'sockets', { name: `Группа ${index + 1}` })
    );
    const layout = sheetFor(panel({ lines }));
    assert.equal(layout.groups.length, 22);
    assert.ok(layout.groupPitch > 0 && layout.groupPitch <= 10);

    const areaBottom = layout.groupArea.y + layout.groupArea.height;
    let previousBottom = -Infinity;
    for (const group of layout.groups) {
      const top = group.breakerRect.y;
      const bottom = group.breakerRect.y + group.breakerRect.height;
      assert.ok(group.rowY > layout.groupArea.y, 'row above the group area');
      assert.ok(group.rowY < areaBottom, 'row below the group area');
      assert.ok(top > previousBottom, 'breaker boxes must not overlap vertically');
      assert.ok(bottom < layout.notesBlock.y, 'row must stay above the bottom blocks');
      previousBottom = bottom;
    }
    assert.ok(layout.groups[0].rowY - layout.groupPitch / 2 >= layout.groupArea.y - EPS);
    assert.ok(
      layout.groups[21].rowY + layout.groupPitch / 2 <= areaBottom + EPS,
      'last row inside the group area'
    );
    assert.ok(layout.groups.every((group) => !group.compact), '22 rows keep both label lines');
  });

  await test('sheet: 40 groups stay separated and readable', () => {
    const lines = Array.from({ length: 40 }, (_, index) =>
      line(`dense-${index}`, 'sockets', { name: `Группа ${index + 1}` })
    );
    const layout = sheetFor(panel({ lines }));
    assert.equal(layout.groups.length, 40);
    assert.ok(layout.groupPitch > 0 && layout.groupPitch < 5, 'pitch shrinks for dense panels');

    const areaBottom = layout.groupArea.y + layout.groupArea.height;
    let previousBottom = -Infinity;
    for (const group of layout.groups) {
      const { breakerRect, rcdRect } = group;
      assert.ok(breakerRect.height > 0, 'breaker box keeps positive height');
      assert.ok(breakerRect.y >= layout.groupArea.y, 'breaker box inside group area');
      assert.ok(breakerRect.y + breakerRect.height >= previousBottom, 'no vertical overlap');
      assert.ok(breakerRect.y + breakerRect.height < layout.notesBlock.y);
      if (rcdRect) inside(rcdRect, layout.drawingArea, 'dense rcd');
      previousBottom = breakerRect.y + breakerRect.height;
    }
    assert.ok(
      layout.groups[39].rowY + layout.groupPitch / 2 <= areaBottom + EPS,
      'last dense row inside the group area'
    );
    assert.ok(layout.groups.every((group) => group.compact), 'dense rows switch to one line');
  });

  await test('sheet: two groups are centered in the group area', () => {
    const layout = sheetFor(
      panel({ lines: [line('a', 'sockets'), line('b', 'lighting')] })
    );
    assert.equal(layout.groupPitch, 10);
    const topMargin = layout.groups[0].rowY - layout.groupPitch / 2 - layout.groupArea.y;
    const bottomMargin =
      layout.groupArea.y +
      layout.groupArea.height -
      (layout.groups[1].rowY + layout.groupPitch / 2);
    near(topMargin, bottomMargin, 'center margins');
  });

  await test('sheet: RCD box appears only for protected groups', () => {
    const layout = sheetFor(
      panel({
        lines: [
          line('a', 'sockets'),
          line('b', 'lighting', { rcd: null }),
        ],
      })
    );
    const sockets = layout.groups[0];
    const lighting = layout.groups[1];
    assert.ok(sockets.rcdRect, 'sockets line must have an RCD box');
    assert.equal(lighting.rcdRect, null);
    assert.ok(sockets.rcdRect.x > sockets.breakerRect.x + sockets.breakerRect.width);
    assert.ok(sockets.labelX > lighting.labelX, 'protected row starts after the RCD box');
    assert.equal(sockets.group.rcdDesignation, 'QD2');
    assert.equal(lighting.group.rcdDesignation, null);
  });

  await test('sheet: input chain has five devices and marks parallel protection', () => {
    const layout = sheetFor(panel({ lines: [line('a', 'sockets')] }));
    assert.deepEqual(
      layout.input.items.map((item) => item.designation),
      ['QF1', 'PI1', 'QD1', 'KV1', 'F1']
    );
    assert.deepEqual(
      layout.input.items.map((item) => item.parallel),
      [false, false, false, true, true]
    );
    let previousRight = -Infinity;
    for (const item of layout.input.items) {
      inside(item.rect, layout.drawingArea, `input ${item.designation}`);
      assert.ok(item.rect.x > previousRight, 'input boxes must not overlap');
      assert.ok(item.detail.length > 0);
      previousRight = item.rect.x + item.rect.width;
    }
    assert.equal(layout.input.distributionY, 33);
    assert.ok(layout.busTop < layout.busBottom);
  });

  await test('sheet: status and notes reflect normative findings', () => {
    const source = panel({ lines: [line('a', 'sockets')] });
    const schematic = buildPanelSchematic(source, { rooms: [livingRoom] });
    const withError = { ...schematic, findings: [
      { id: 'bad', severity: 'error', message: 'Ошибка', reference: 'ПУЭ-7' },
      { id: 'warn', severity: 'warning', message: 'Замечание', reference: 'СП 256' },
    ] };
    const layout = buildPanelSheet(withError);
    assert.equal(layout.status, 'errors');
    assert.equal(layout.statusText, 'Ошибок: 1');
    assert.equal(layout.statusBox.severity, 'errors');
    assert.match(layout.notesLines[9], /ошибок 1/);
    assert.match(layout.notesLines[9], /замечаний 1/);

    const warningsOnly = {
      ...schematic,
      findings: [{ id: 'warn', severity: 'warning', message: 'Замечание' }],
    };
    assert.equal(buildPanelSheet(warningsOnly).status, 'warnings');
    assert.equal(
      buildPanelSheet({ ...schematic, findings: [] }).status,
      'ok'
    );

    assert.equal(layout.notesLines.length, 10);
    for (const note of layout.notesLines) assert.ok(note.trim().length > 0);
    assert.ok(layout.notesLines.some((note) => note.includes('ПУЭ-7')));
    assert.ok(layout.notesLines.some((note) => note.includes('СП 256')));
    assert.ok(layout.notesLines.some((note) => note.includes('QF —')));
  });

  await test('sheet: an empty panel is marked as incomplete', () => {
    const layout = sheetFor(panel({ lines: [] }));
    assert.equal(layout.groups.length, 0);
    assert.equal(layout.status, 'warnings');
    assert.equal(layout.statusText, 'Группы не заданы');
    assert.match(layout.notesLines[9], /не заданы/);
  });

  await test('sheet: group rows carry power, current and designation', () => {
    const layout = sheetFor(panel({ lines: [line('a', 'sockets')] }));
    const group = layout.groups[0];
    assert.equal(group.group.breakerDesignation, 'QF2');
    assert.ok(group.group.currentA > 0);
    assert.ok(group.group.designPowerW > 0);
    assert.ok(group.endpoint.x > group.labelX);
    near(group.endpoint.x, 411, 'endpoint');
    near(group.endpoint.y, group.rowY, 'endpoint height');
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

console.log(`\npanelSheet: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

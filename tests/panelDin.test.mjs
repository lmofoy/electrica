// DIN-лист: рейки, модули, обозначения аппаратов и штамп ЭС-04.
// Запуск: node tests/panelDin.test.mjs
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

  const { buildDinSheetLayout, DIN_SLOT_WIDTH_MM } = await server.ssrLoadModule(
    '/src/core/electrical/dinLayout.ts'
  );
  const { buildPanelLayout, RAIL_MODULES } = await server.ssrLoadModule(
    '/src/core/electrical/panelLayout.ts'
  );
  const { createLine, defaultPanelSupply, sanitizePanel } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );

  const bedroom = {
    ...room,
    id: 'room-bed',
    name: 'Спальня',
    vertices: [
      { x: 4000, y: 0 },
      { x: 8000, y: 0 },
      { x: 8000, y: 3000 },
      { x: 4000, y: 3000 },
    ],
  };
  const rooms = [room, bedroom];

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

  await test('din: rails match enclosure and every layout item is placed', () => {
    const source = panel({
      lines: [line('a', 'sockets'), line('b', 'lighting'), line('c', 'sockets')],
    });
    const layout = buildPanelLayout(source);
    const sheet = buildDinSheetLayout(source, { date: '14.11.2026' });
    assert.equal(sheet.rails.length, layout.rowsCount);
    assert.equal(sheet.rails.length, Math.ceil(layout.enclosureModules / RAIL_MODULES));
    const placed = sheet.rails.flatMap((rail) => rail.items);
    assert.equal(placed.length, layout.items.length);
    assert.equal(sheet.document.designation, 'ЭС-04');
    assert.equal(sheet.legend.entries.length, 4);
    assert.ok(sheet.notesLines.length >= 5);
  });

  await test('din: designations mirror schematic input and group numbering', () => {
    const sheet = buildDinSheetLayout(
      panel({ lines: [line('a', 'sockets'), line('b', 'lighting'), line('c', 'sockets')] })
    );
    const designations = sheet.rails.flatMap((rail) => rail.items.map((item) => item.designation));
    for (const expected of ['QF1', 'PI1', 'QD1', 'KV1', 'F1', 'QF2', 'QF3', 'QF4']) {
      assert.ok(designations.includes(expected), `${expected} must be placed`);
    }
    assert.ok(designations.includes('QD2'), 'first group RCD designation');
    assert.ok(designations.includes('QD3'), 'second group RCD designation');
    assert.equal(new Set(designations).size, designations.length, 'designations must be unique');
  });

  await test('din: module widths and rail usage follow 18 mm slots', () => {
    const source = panel({
      lines: [line('a', 'sockets'), line('b', 'lighting')],
    });
    const sheet = buildDinSheetLayout(source);
    near(DIN_SLOT_WIDTH_MM, 18, 'slot width');
    const layout = buildPanelLayout(source);
    const enclosureModules = layout.enclosureModules;
    for (const rail of sheet.rails) {
      assert.equal(rail.modules, RAIL_MODULES);
      assert.ok(rail.used <= RAIL_MODULES, 'rail must not overflow');
      assert.equal(rail.used + rail.free, RAIL_MODULES);
      assert.equal(
        rail.used,
        rail.items.reduce((sum, item) => sum + item.modules, 0)
      );
      let cursor = 0;
      for (const item of rail.items) {
        near(item.width, item.modules * DIN_SLOT_WIDTH_MM - 0.6, 'item width');
        near(item.x, rail.x + cursor * DIN_SLOT_WIDTH_MM, 'item x');
        cursor += item.modules;
      }
      assert.ok(rail.used * DIN_SLOT_WIDTH_MM <= sheet.railWidth + EPS);
    }
    const freeTotal = sheet.rails.reduce((sum, rail) => sum + rail.free, 0);
    assert.equal(freeTotal, enclosureModules - layout.modulesTotal);
  });

  await test('din: six rails fit above the notes and title block', () => {
    const lines = [];
    for (let index = 0; index < 34; index += 1) {
      lines.push(line(`line-${index}`, 'lighting', { name: `Свет ${index + 1}` }));
    }
    const source = panel({ lines });
    const layout = buildPanelLayout(source);
    assert.equal(layout.enclosureModules, 72);
    const sheet = buildDinSheetLayout(source);
    assert.equal(sheet.rails.length, 6);
    const last = sheet.rails[sheet.rails.length - 1];
    assert.ok(last.y + last.height + 4 <= sheet.notesBlock.y + EPS, 'last rail must stay above notes');
    assert.ok(
      sheet.enclosureRect.y + sheet.enclosureRect.height <= sheet.notesBlock.y + EPS,
      'enclosure must stay above notes'
    );
  });

  await test('din: empty panel still draws input hardware on the first rail', () => {
    const source = panel();
    const sheet = buildDinSheetLayout(source);
    assert.equal(sheet.rails.length, buildPanelLayout(source).rowsCount);
    assert.ok(sheet.rails.length >= 1);
    const designations = sheet.rails.flatMap((rail) => rail.items.map((item) => item.designation));
    assert.deepEqual(designations, ['QF1', 'PI1', 'QD1', 'KV1', 'F1']);
    assert.ok(sheet.notesLines.some((note) => note.includes('Раскладка')));
  });

  await test('layout: zones group input first and rooms in line order', () => {
    const source = panel({
      lines: [
        line('a', 'sockets'),
        line('b', 'lighting', { roomIds: ['room-bed'] }),
        line('c', 'sockets'),
      ],
    });
    const layout = buildPanelLayout(source, { rooms });
    assert.equal(layout.manualOrder, false);
    assert.equal(layout.zones[0].id, 'input');
    assert.equal(layout.zones[0].name, 'Ввод и защита');
    assert.deepEqual(
      layout.zones.map((zone) => zone.name),
      ['Ввод и защита', 'Зал', 'Спальня']
    );
    assert.deepEqual(
      layout.items.filter((item) => item.lineId).map((item) => item.lineId),
      ['a', 'a', 'c', 'c', 'b']
    );
    assert.equal(
      layout.zones.reduce((sum, zone) => sum + zone.modules, 0),
      layout.modulesTotal
    );
    const hall = layout.zones.find((zone) => zone.id === 'room-hall');
    assert.deepEqual(hall.lineIds, ['a', 'c']);
    assert.equal(
      typeof layout.items.find((item) => item.lineId === 'b')?.zoneColorIndex,
      'number'
    );
  });

  await test('layout: manual order wins and warns about broken pairs and zones', () => {
    const base = panel({
      lines: [
        line('a', 'sockets'),
        line('b', 'lighting', { roomIds: ['room-bed'] }),
        line('c', 'sockets'),
      ],
    });
    const auto = buildPanelLayout(base, { rooms });
    const ids = auto.items.map((item) => item.id);
    const inputIds = ids.filter((id) => !['a-breaker', 'a-rcd', 'c-breaker', 'c-rcd', 'b-breaker'].includes(id));

    const manual = buildPanelLayout(
      {
        ...base,
        dinOrder: [
          ...inputIds,
          'a-breaker',
          'b-breaker',
          'a-rcd',
          'c-breaker',
          'c-rcd',
        ],
      },
      { rooms }
    );
    assert.equal(manual.manualOrder, true);
    assert.equal(manual.items[0].id, 'input-breaker');
    assert.ok(manual.warnings.some((warning) => warning.id === 'din-pair-split-a'));
    assert.ok(manual.warnings.some((warning) => warning.id === 'din-zone-split-room-hall'));

    const simple = panel({
      lines: [line('a', 'sockets'), line('b', 'lighting', { roomIds: ['room-bed'] })],
    });
    const rest = buildPanelLayout(simple, { rooms })
      .items.map((item) => item.id)
      .filter((id) => id !== 'a-breaker' && id !== 'a-rcd');

    const rcdFirst = buildPanelLayout(
      { ...simple, dinOrder: ['a-rcd', 'a-breaker', ...rest] },
      { rooms }
    );
    const error = rcdFirst.warnings.find((warning) => warning.id === 'din-rcd-first-a');
    assert.equal(error?.severity, 'error');

    const inputLast = buildPanelLayout(
      {
        ...simple,
        dinOrder: [
          ...buildPanelLayout(simple, { rooms })
            .items.map((item) => item.id)
            .filter((id) => id !== 'input-breaker'),
          'input-breaker',
        ],
      },
      { rooms }
    );
    assert.ok(inputLast.warnings.some((warning) => warning.id === 'din-input-not-first'));
  });

  await test('layout: sanitizePanel drops unknown and duplicate dinOrder ids', () => {
    const source = panel({ lines: [line('a', 'sockets')] });
    const cleaned = sanitizePanel(
      { ...source, dinOrder: ['bogus', 'a-breaker', 'a-breaker', 'a-rcd', 'main-rcd'] },
      rooms,
      [],
      120
    );
    assert.deepEqual(cleaned.dinOrder, ['a-breaker', 'a-rcd', 'main-rcd']);
    const empty = sanitizePanel(
      { ...source, dinOrder: ['bogus', 42, null] },
      rooms,
      [],
      120
    );
    assert.equal(empty.dinOrder, undefined);
  });

  await test('din: zone spans and list follow the manual order', () => {
    const base = panel({
      lines: [line('a', 'sockets'), line('b', 'lighting', { roomIds: ['room-bed'] })],
    });
    const auto = buildDinSheetLayout(base, { rooms });
    assert.ok(auto.zonesBox.entries.length >= 3);
    assert.equal(auto.zonesBox.entries[0].id, 'input');
    assert.ok(auto.zonesBox.rect.y + auto.zonesBox.rect.height <= auto.notesBlock.y);
    for (const rail of auto.rails) {
      assert.equal(
        rail.zones.reduce((sum, zone) => sum + zone.width, 0),
        rail.used * DIN_SLOT_WIDTH_MM
      );
    }

    const manual = buildDinSheetLayout(
      { ...base, dinOrder: ['b-breaker', 'input-breaker'] },
      { rooms }
    );
    assert.equal(manual.rails[0].items[0].id, 'b-breaker');
    assert.ok(manual.notesLines.some((note) => note.includes('Порядок аппаратов ручной')));
  });

  await test('din: combined line prints one 2-module QF without a separate RCD', () => {
    const source = panel({
      lines: [
        line('a', 'sockets', { combinedProtection: true }),
        line('b', 'sockets'),
      ],
    });
    const layout = buildPanelLayout(source);
    const rcbo = layout.items.find((item) => item.kind === 'line_rcbo');
    assert.ok(rcbo, 'combined line must produce a single RCBO item');
    assert.equal(rcbo.modules, 2);
    assert.equal(rcbo.lineId, 'a');
    assert.match(rcbo.label, /30 мА/);
    assert.equal(layout.items.filter((item) => item.lineId === 'a').length, 1);

    const sheet = buildDinSheetLayout(source);
    const designations = sheet.rails.flatMap((rail) =>
      rail.items.map((item) => item.designation)
    );
    assert.ok(designations.includes('QF2'));
    assert.ok(designations.includes('QF3'));
    assert.ok(designations.includes('QD2'), 'plain line keeps its own QD2');
    const aItems = sheet.rails
      .flatMap((rail) => rail.items)
      .filter((item) => item.id.startsWith('a-'));
    assert.equal(aItems.length, 1, 'combined line gets no separate RCD slot');
    assert.ok(
      sheet.notesLines.some((note) => note.includes('Класс всех модульных аппаратов — 6 кА'))
    );
  });

  await test('din: legend and summary boxes stay inside the frame', () => {
    const sheet = buildDinSheetLayout(panel({ lines: [line('a', 'sockets')] }));
    for (const rect of [sheet.legend.rect, sheet.summary.rect, sheet.enclosureRect]) {
      assert.ok(rect.x >= sheet.frame.x - EPS);
      assert.ok(rect.y >= sheet.frame.y - EPS);
      assert.ok(rect.x + rect.width <= sheet.frame.x + sheet.frame.width + EPS);
      assert.ok(rect.y + rect.height <= sheet.frame.y + sheet.frame.height + EPS);
    }
    assert.ok(sheet.legend.rect.x >= sheet.enclosureRect.x + sheet.enclosureRect.width);
    assert.ok(sheet.summary.lines.length >= 3);
  });
} finally {
  await server?.close();
}

console.log(`\npanelDin: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

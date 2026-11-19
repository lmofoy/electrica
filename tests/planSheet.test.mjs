// Печатные планы ЭС-05/ЭС-06: масштаб, стены и полы, приборы с высотами,
// ведомость приборов, легенда, трассы групп и основная надпись.
// Запуск: node tests/planSheet.test.mjs
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
const nodes = {
  n1: { id: 'n1', x: 0, y: 0 },
  n2: { id: 'n2', x: 4000, y: 0 },
  n3: { id: 'n3', x: 4000, y: 3000 },
  n4: { id: 'n4', x: 0, y: 3000 },
};
const walls = [
  { id: 'w1', nodeAId: 'n1', nodeBId: 'n2', thicknessMm: 120, isExterior: true, roomIds: ['room-hall'] },
  { id: 'w2', nodeAId: 'n2', nodeBId: 'n3', thicknessMm: 120, isExterior: true, roomIds: ['room-hall'] },
  { id: 'w3', nodeAId: 'n3', nodeBId: 'n4', thicknessMm: 120, isExterior: true, roomIds: ['room-hall'] },
  { id: 'w4', nodeAId: 'n4', nodeBId: 'n1', thicknessMm: 120, isExterior: true, roomIds: ['room-hall'] },
];
const partitions = [
  { id: 'p1', p1: { x: 2600, y: 400 }, p2: { x: 2600, y: 2600 }, thicknessMm: 100, roomId: 'room-hall' },
];
const openings = [
  {
    id: 'o1',
    type: 'window',
    wallId: 'w1',
    p1: { x: 1000, y: 0 },
    p2: { x: 2200, y: 0 },
    widthMm: 1200,
    heightMm: 1500,
    elevationMm: 900,
    wallThicknessMm: 120,
  },
  {
    id: 'o2',
    type: 'door',
    wallId: 'w3',
    p1: { x: 1200, y: 3000 },
    p2: { x: 2100, y: 3000 },
    widthMm: 900,
    heightMm: 2100,
    elevationMm: 0,
    wallThicknessMm: 120,
  },
];
const socket = {
  id: 'd1',
  type: 'socket_single',
  name: 'Розетка',
  anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 0, offsetMm: 1000 },
  heightFromFloorMm: 300,
  powerWatts: 2200,
  shared: false,
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
        { x: 4000, y: 0 },
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

  const { buildPlanSheet } = await server.ssrLoadModule(
    '/src/core/electrical/planSheet.ts'
  );
  const { createLine, defaultPanelSupply } = await server.ssrLoadModule(
    '/src/core/electrical/panel.ts'
  );

  function line(id, purpose, deviceIds, patch = {}) {
    const base = createLine(purpose, ['room-hall'], 'Зал', 0, 'ceiling');
    return { ...base, id, deviceIds, ...patch };
  }

  const powerLine = line('line-a', 'sockets', ['d1']);
  const lightLine = line('line-b', 'lighting', ['d2', 'd3'], { routing: 'floor' });
  const panel = {
    id: 'panel-1',
    name: 'ЩР-1',
    anchor: { kind: 'room_edge', roomId: 'room-hall', edgeIndex: 2, offsetMm: 1000 },
    heightFromFloorMm: 1600,
    mounting: 'flush',
    supply: defaultPanelSupply(10000),
    strategy: 'optimal',
    lines: [powerLine, lightLine],
  };
  const routes = new Map([
    ['line-a', route('line-a', 'ceiling', 8000)],
    ['line-b', route('line-b', 'floor', 4000, 'Трасса проходит по диагонали')],
  ]);

  function source(mode, patch = {}) {
    return {
      mode,
      rooms: [room],
      nodes,
      walls,
      openings,
      partitions,
      devices: [socket, switchDevice, lamp],
      panel,
      autoLayout: null,
      routes,
      wallThicknessMm: 120,
      ...patch,
    };
  }

  await test('plan: A3 frame, scale label and document block ЭС-05/ЭС-06', () => {
    const power = buildPlanSheet(source('power'), { date: '19.11.2026' });
    const lighting = buildPlanSheet(source('lighting'), { date: '19.11.2026' });
    assert.equal(power.paper.width, 420);
    assert.equal(power.paper.height, 297);
    assert.deepEqual(power.frame, { x: 20, y: 5, width: 395, height: 287 });
    assert.equal(power.document.designation, 'ЭС-05');
    assert.equal(power.document.sheet, '6');
    assert.equal(lighting.document.designation, 'ЭС-06');
    assert.equal(lighting.document.sheet, '7');
    assert.equal(power.document.sheetTotal, '8');
    assert.equal(lighting.document.sheetTotal, '8');
    assert.equal(power.document.objectTitle, 'ЩР-1');
    assert.match(power.document.subtitle, /1:50/);
    assert.equal(power.scale, 50);
    assert.equal(power.scaleLabel, '1:50');
    assert.equal(power.title, 'План розеточных сетей');
    assert.equal(lighting.title, 'План осветительных сетей');
    assert.match(power.subtitle, /1 группа · 1 прибор ·/);
    assert.match(lighting.subtitle, /1 группа · 2 прибора ·/);
  });

  await test('plan: floors, walls, openings and partitions stay on the sheet', () => {
    const layout = buildPlanSheet(source('power'));
    assert.equal(layout.floors.length, 1);
    assert.equal(layout.floors[0].rings.length, 1);
    assert.equal(layout.wallSegments.length, 4);
    assert.equal(layout.partitionSegments.length, 1);
    assert.equal(layout.openings.length, 2);
    assert.ok(layout.partitionSegments[0].width >= 1.5, 'partition has scaled width');
    for (const floor of layout.floors) {
      for (const ring of floor.rings) {
        for (const point of ring) {
          inside({ ...point, width: 0, height: 0 }, layout.planArea, 'floor point');
        }
      }
    }
    for (const opening of layout.openings) {
      inside({ x: opening.x1, y: opening.y1, width: 0, height: 0 }, layout.frame, 'door jamb');
    }
  });

  await test('plan: socket plan shows only sockets with height labels', () => {
    const power = buildPlanSheet(source('power'));
    assert.equal(power.devices.length, 1);
    assert.equal(power.devices[0].type, 'socket_single');
    assert.equal(power.devices[0].heightLabel, '300');
    assert.equal(power.devices[0].roomName, 'Зал');
    assert.equal(power.devices[0].lineIndex, 1);

    const lighting = buildPlanSheet(source('lighting'));
    const types = lighting.devices.map((device) => device.type).sort();
    assert.deepEqual(types, ['light_ceiling', 'switch_1k']);
    assert.equal(lighting.devices.find((device) => device.type === 'switch_1k').heightLabel, '900');
    assert.equal(lighting.devices.find((device) => device.type === 'light_ceiling').heightLabel, 'пот.');
  });

  await test('plan: group routes are filtered by plan mode and coloured', () => {
    const power = buildPlanSheet(source('power'));
    const lighting = buildPlanSheet(source('lighting'));
    assert.equal(power.routes.length, 1);
    assert.equal(power.routes[0].lineId, 'line-a');
    assert.match(power.routes[0].color, /^#[0-9a-f]{6}$/i);
    assert.equal(power.routes[0].routing, 'ceiling');
    assert.equal(lighting.routes.length, 1);
    assert.equal(lighting.routes[0].lineId, 'line-b');
    assert.equal(lighting.routes[0].routing, 'floor');
    assert.ok(power.routes[0].points.length >= 2);
  });

  await test('plan: device schedule aggregates heights, rooms and groups', () => {
    const layout = buildPlanSheet(source('lighting'));
    const schedule = layout.schedule;
    assert.equal(schedule.title, 'Ведомость приборов');
    const width = schedule.columns.reduce((sum, column) => sum + column.width, 0);
    assert.ok(Math.abs(width - schedule.rect.width) < EPS);
    assert.equal(schedule.rows.length, 2);
    assert.ok(schedule.rows.every((row) => row.cells[5] === '1'));
    const names = schedule.rows.map((row) => row.cells[1]).sort();
    assert.deepEqual(names, ['Выкл. 1', 'Свет']);
    assert.ok(schedule.rows.every((row) => row.cells[2] === 'Зал'));
    assert.ok(schedule.rect.y + schedule.rect.height <= layout.notesBlock.y);
    inside(schedule.rect, layout.frame, 'schedule');
  });

  await test('plan: legend lists symbols and dimensions give overall size', () => {
    const power = buildPlanSheet(source('power'));
    assert.equal(power.legend.title, 'Условные обозначения');
    assert.ok(power.legend.entries.length >= 1);
    assert.ok(power.legend.entries.some((entry) => entry.glyph === 'socket'));
    assert.equal(power.legend.truncated, 0);
    assert.equal(power.dimensions.length, 2);
    assert.match(power.dimensions[0].text, /^\d+ мм$/);
    assert.match(power.dimensions[1].text, /^\d+ мм$/);
    assert.equal(power.dimensions[1].textAngle, -90);
  });

  await test('plan: notes and document fit the sheet template', () => {
    const layout = buildPlanSheet(source('power'));
    assert.deepEqual(layout.notesBlock, { x: 20, y: 237, width: 205, height: 55 });
    assert.equal(layout.notesTitle, 'Примечания');
    assert.ok(layout.notesLines.length >= 5);
    for (const line of layout.notesLines) assert.ok(line.trim().length > 0);
    assert.ok(layout.schedule.rect.x > layout.planArea.x + layout.planArea.width, 'schedule in right column');
  });

  await test('plan: empty project keeps a valid blank sheet', () => {
    const layout = buildPlanSheet({
      mode: 'power',
      rooms: [],
      nodes: {},
      walls: [],
      openings: [],
      partitions: [],
      devices: [],
      panel: null,
      autoLayout: null,
      routes: new Map(),
      wallThicknessMm: 120,
    });
    assert.equal(layout.scale, 100);
    assert.equal(layout.devices.length, 0);
    assert.equal(layout.routes.length, 0);
    assert.equal(layout.schedule.rows.length, 0);
    assert.equal(layout.schedule.emptyLabel, 'На этом плане приборов нет');
    assert.match(layout.subtitle, /0 групп/);
    assert.match(layout.subtitle, /0 приборов/);
    assert.equal(layout.document.designation, 'ЭС-05');
  });
} finally {
  await server?.close();
}

console.log(`\nplanSheet: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

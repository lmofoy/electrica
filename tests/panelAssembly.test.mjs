// Этап 4 «Линии»: путь сборки (авто/вручную), черновик и сессия назначения.
// Запуск: node tests/panelAssembly.test.mjs
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

const saved = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: (key) => saved.delete(key),
    clear: () => saved.clear(),
  },
});

const room = {
  id: 'room-1',
  name: 'Гостиная',
  type: 'living',
  nodeIds: [],
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
    anchor: { kind: 'room', roomId: 'room-1' },
    heightFromFloorMm: 300,
    powerWatts: 100,
    shared: false,
  },
  {
    id: 'd2',
    type: 'light_ceiling',
    name: 'Светильник',
    anchor: { kind: 'room', roomId: 'room-1' },
    heightFromFloorMm: 2700,
    powerWatts: 60,
    shared: false,
  },
  {
    id: 'd3',
    type: 'hob',
    name: 'Варочная панель',
    anchor: { kind: 'room', roomId: 'room-1' },
    heightFromFloorMm: 300,
    powerWatts: 6000,
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
  const { createLine, defaultPanelSupply, sanitizePanel } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { makeBreaker, makeCable } = await server.ssrLoadModule(
    '/src/core/electrical/norms.ts'
  );
  const { useProjectStore } = await server.ssrLoadModule('/src/store/useProjectStore.ts');

  const state = () => useProjectStore.getState();

  function basePanel(overrides = {}) {
    const lineA = {
      ...createLine('sockets', ['room-1'], 'Гостиная', 0, 'ceiling'),
      id: 'line-a',
      deviceIds: ['d1'],
    };
    const lineB = {
      ...createLine('lighting', ['room-1'], 'Гостиная', 1, 'ceiling'),
      id: 'line-b',
      deviceIds: ['d2'],
    };
    return {
      id: 'panel-1',
      name: 'ЩР-1',
      anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 0, offsetMm: 1000 },
      heightFromFloorMm: 1600,
      mounting: 'flush',
      supply: defaultPanelSupply(10000),
      strategy: 'custom',
      lines: [lineA, lineB],
      ...overrides,
    };
  }

  function fixture(panelOverrides = {}) {
    useProjectStore.setState({
      panel: basePanel(panelOverrides),
      rooms: [room],
      devices,
      freePartitions: [],
      selection: null,
      lineAssignLineId: null,
      lineAssignStartPanel: null,
    });
  }

  await test('append never creates lines on its own', () => {
    fixture({ lines: [] });
    state().appendUnassignedDevices();
    assert.equal(state().panel.lines.length, 0);
    assert.ok(state().toasts.at(-1)?.message.includes('Создайте линию'));
  });

  await test('manual line is created empty', () => {
    fixture();
    const lineId = state().createManualPanelLine();
    assert.ok(lineId);
    const created = state().panel.lines.find((line) => line.id === lineId);
    assert.ok(created);
    assert.deepEqual(created.deviceIds, []);
  });

  await test('clearing lines drops the lines and the assignment session', () => {
    fixture();
    state().setLineAssignLine('line-a');
    state().clearPanelLines();
    assert.equal(state().panel.lines.length, 0);
    assert.equal(state().lineAssignStartPanel, null);
  });

  await test('sanitizePanel drops legacy assembly and draft fields', () => {
    const kept = sanitizePanel(
      basePanel({ assembly: 'manual', linesDraft: true }),
      [room],
      [],
      120
    );
    assert.equal(kept.assembly, undefined);
    assert.equal(kept.linesDraft, undefined);
    assert.equal(kept.lines.length, 2);
  });

  await test('assignment session rolls the whole panel back on cancel', () => {
    fixture();
    state().setLineAssignLine('line-b');
    assert.ok(state().lineAssignStartPanel);
    assert.equal(state().lineAssignStartPanel.lines.length, 2);

    state().assignDevicesToLine('line-b', ['d1']);
    assert.ok(
      state().panel.lines.find((line) => line.id === 'line-b').deviceIds.includes('d1')
    );
    assert.ok(
      !state().panel.lines.find((line) => line.id === 'line-a').deviceIds.includes('d1')
    );

    state().cancelLineAssignment();
    assert.equal(state().lineAssignLineId, null);
    assert.equal(state().lineAssignStartPanel, null);
    assert.deepEqual(
      state().panel.lines.find((line) => line.id === 'line-a').deviceIds,
      ['d1']
    );
    assert.deepEqual(
      state().panel.lines.find((line) => line.id === 'line-b').deviceIds,
      ['d2']
    );
    assert.ok(state().toasts.at(-1)?.message.includes('отменены'));
  });

  await test('confirmed assignment keeps the transfer', () => {
    fixture();
    state().setLineAssignLine('line-b');
    state().assignDevicesToLine('line-b', ['d1']);
    state().setLineAssignLine(null);
    assert.equal(state().lineAssignLineId, null);
    assert.ok(
      state().panel.lines.find((line) => line.id === 'line-b').deviceIds.includes('d1')
    );
    assert.ok(
      !state().panel.lines.find((line) => line.id === 'line-a').deviceIds.includes('d1')
    );
  });

  await test('assigning an unknown line clears the session and its snapshot', () => {
    fixture();
    state().setLineAssignLine('line-a');
    state().setLineAssignLine('missing-line');
    assert.equal(state().lineAssignLineId, null);
    assert.equal(state().lineAssignStartPanel, null);
  });

  await test('manual lines are created untraced and stay untraced when devices are added', () => {
    fixture({ lines: [] });
    const lineId = state().createManualPanelLine();
    assert.equal(state().panel.lines[0].trace, 'none');

    state().assignDevicesToLine(lineId, ['d1']);
    const line = state().panel.lines.find((candidate) => candidate.id === lineId);
    assert.deepEqual(line.deviceIds, ['d1']);
    assert.equal(line.trace, 'none');
  });

  await test('append fills a matching line and keeps its trace and cable', () => {
    fixture({ lines: [] });
    const lineId = state().createManualPanelLine();
    state().updatePanelLine(lineId, { purpose: 'sockets', roomIds: ['room-1'] });
    state().appendUnassignedDevices();
    const panel = state().panel;
    assert.equal(panel.lines.length, 1, 'no extra lines are created');
    const line = panel.lines.find((candidate) => candidate.id === lineId);
    assert.deepEqual(line.deviceIds, ['d1', 'd3']);
    assert.equal(line.trace, 'none');
    assert.ok(state().toasts.at(-1)?.message.includes('Добавлено приборов: 2'));
  });

  await test('reset route switches an untraced line to auto and keeps auto lines as no-op', () => {
    fixture();
    state().updatePanelLine('line-a', { trace: 'none' });
    state().resetLineRoute('line-a');
    assert.equal(
      state().panel.lines.find((line) => line.id === 'line-a').trace,
      'auto'
    );
    assert.ok(state().toasts.at(-1)?.message.includes('автоматический'));

    const toastsBefore = state().toasts.length;
    state().resetLineRoute('line-a');
    assert.equal(state().toasts.length, toastsBefore, 'no-op on an auto line');
  });

  await test('manual breaker edit switches the strategy to custom', () => {
    fixture({ strategy: 'optimal' });
    state().updatePanelLine('line-a', { breaker: makeBreaker(20, 'C') });
    assert.equal(state().panel.strategy, 'custom');
    assert.equal(
      state().panel.lines.find((line) => line.id === 'line-a').breaker.ratingA,
      20
    );
    assert.ok(state().toasts.at(-1)?.message.includes('Своя защита'));
  });

  await test('combined protection keeps one rating and drops without an RCD', () => {
    fixture({ strategy: 'custom' });
    const line = () => state().panel.lines.find((candidate) => candidate.id === 'line-a');
    const light = () => state().panel.lines.find((candidate) => candidate.id === 'line-b');

    state().updatePanelLine('line-a', { combinedProtection: true });
    assert.equal(line().combinedProtection, true);
    assert.equal(line().rcd.ratingA, line().breaker.ratingA);

    state().updatePanelLine('line-a', { breaker: makeBreaker(20, 'C') });
    assert.equal(line().rcd.ratingA, 20, 'RCD follows the breaker rating');

    state().updatePanelLine('line-a', { rcd: null });
    assert.equal(line().combinedProtection, undefined, 'no RCD — no RCBO');

    state().updatePanelLine('line-b', { combinedProtection: true });
    assert.equal(light().combinedProtection, undefined);
  });

  await test('load, cable and purpose edits keep the active strategy', () => {
    fixture({ strategy: 'optimal' });
    state().updatePanelLine('line-a', { loadW: 3000 });
    state().updatePanelLine('line-a', { cable: makeCable(4) });
    state().updatePanelLine('line-a', { purpose: 'kitchen' });
    assert.equal(state().panel.strategy, 'optimal');
    const line = state().panel.lines.find((candidate) => candidate.id === 'line-a');
    assert.equal(line.cable.sectionMm2, 4, 'purpose preset must not touch the cable');
  });

  await test('growing composition keeps the chosen cable and caps the breaker', () => {
    fixture();
    state().updatePanelLine('line-a', { cable: makeCable(2.5) });
    state().assignDevicesToLine('line-a', ['d3']);
    const line = state().panel.lines.find((candidate) => candidate.id === 'line-a');
    assert.equal(line.cable.sectionMm2, 2.5, 'cable stays as chosen');
    assert.equal(line.breaker.ratingA, 20, 'breaker capped by a 2.5 mm² cable');
    assert.equal(line.loadW, 6100);
  });

  await test('strategy switch keeps the cable chosen by the user', () => {
    fixture({ strategy: 'optimal' });
    state().updatePanelLine('line-a', { cable: makeCable(6) });
    state().setPanelStrategy('maximum');
    const line = state().panel.lines.find((candidate) => candidate.id === 'line-a');
    assert.equal(line.cable.sectionMm2, 6);
    assert.ok(line.breaker.ratingA <= 32);
  });

  await test('sanitizePanel keeps trace none and drops unknown values', () => {
    const panel = basePanel();
    panel.lines[0].trace = 'none';
    panel.lines[1].trace = 'weird';
    const kept = sanitizePanel(panel, [room], [], 120);
    assert.equal(kept.lines[0].trace, 'none');
    assert.equal(kept.lines[1].trace, undefined);
  });
} finally {
  await server?.close();
}

console.log(`\npanelAssembly: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

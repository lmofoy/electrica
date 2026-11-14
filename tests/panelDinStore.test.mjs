// Ручной порядок DIN: действия стора, автосброс и очистка при удалении линий.
// Запуск: node tests/panelDinStore.test.mjs
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

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  const { createLine, defaultPanelSupply } =
    await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const { buildPanelLayout } =
    await server.ssrLoadModule('/src/core/electrical/panelLayout.ts');
  const { useProjectStore } = await server.ssrLoadModule('/src/store/useProjectStore.ts');

  const state = () => useProjectStore.getState();
  const ids = () => buildPanelLayout(state().panel).items.map((item) => item.id);

  function fixture() {
    const lines = [
      { ...createLine('sockets', [], 'Без комнаты', 0, 'ceiling'), id: 'line-a' },
      {
        ...createLine('lighting', [], 'Без комнаты', 1, 'ceiling'),
        id: 'line-b',
      },
    ];
    const panel = {
      id: 'panel-1',
      name: 'ЩР-1',
      anchor: { kind: 'room_edge', roomId: 'room-1', edgeIndex: 0, offsetMm: 1000 },
      heightFromFloorMm: 1600,
      mounting: 'flush',
      supply: defaultPanelSupply(10000),
      strategy: 'optimal',
      lines,
    };
    useProjectStore.setState({ panel, rooms: [] });
  }

  await test('store: moving an item stores manual order and reset clears it', () => {
    fixture();
    const auto = ids();
    assert.equal(state().panel.dinOrder, undefined);
    assert.ok(auto.includes('line-b-breaker'));

    state().movePanelDinItem('line-b-breaker', 0);
    assert.deepEqual(ids().slice(0, 2), ['line-b-breaker', 'input-breaker']);
    assert.equal(buildPanelLayout(state().panel).manualOrder, true);
    assert.deepEqual(state().panel.dinOrder?.slice(0, 2), [
      'line-b-breaker',
      'input-breaker',
    ]);

    state().resetPanelDinOrder();
    assert.equal(state().panel.dinOrder, undefined);
    assert.deepEqual(ids(), auto);
    assert.ok(state().toasts.at(-1)?.message.includes('автоматическому'));
  });

  await test('store: returning to automatic order drops the stored list', () => {
    fixture();
    const auto = ids();
    const originalIndex = auto.indexOf('line-b-breaker');
    state().movePanelDinItem('line-b-breaker', 0);
    state().movePanelDinItem('line-b-breaker', auto.length - 1);
    assert.equal(state().panel.dinOrder, undefined);
    assert.deepEqual(ids(), auto);

    state().movePanelDinItem('line-b-breaker', 0);
    assert.ok(state().panel.dinOrder?.length);
    state().movePanelDinItem('line-b-breaker', originalIndex);
    assert.equal(state().panel.dinOrder, undefined);
  });

  await test('store: deleting a line removes its item ids from the order', () => {
    fixture();
    state().movePanelDinItem('line-b-breaker', 0);
    assert.ok(state().panel.dinOrder?.includes('line-b-breaker'));
    state().deletePanelLine('line-b');
    assert.ok(!state().panel.dinOrder?.includes('line-b-breaker'));
    assert.ok(!state().panel.dinOrder?.includes('line-b-rcd'));
  });

  await test('store: clearing lines keeps only input hardware in the order', () => {
    fixture();
    state().movePanelDinItem('line-b-breaker', 0);
    state().clearPanelLines();
    assert.deepEqual(state().panel.dinOrder, [
      'input-breaker',
      'meter',
      'main-rcd',
      'voltage-relay',
      'spd',
    ]);
  });
} finally {
  await server?.close();
}

console.log(`\npanelDinStore: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Схема щита и нормативные проверки: обозначения, нагрузки, фазы,
// селективность УЗО, влажные зоны, потери напряжения, sanitize.
// Запуск: node tests/panelSchematic.test.mjs
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
const clone = (value) => structuredClone(value);

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

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const {
    buildPanelSchematic,
  } = await server.ssrLoadModule('/src/core/electrical/schematic.ts');
  const {
    validatePanel,
  } = await server.ssrLoadModule('/src/core/electrical/panelValidation.ts');
  const {
    applyStrategy,
    createLine,
    defaultPanelSupply,
    sanitizePanel,
  } = await server.ssrLoadModule('/src/core/electrical/panel.ts');
  const {
    makeBreaker,
    makeCable,
    makeRcd,
  } = await server.ssrLoadModule('/src/core/electrical/norms.ts');
  const {
    validateProjectSnapshot,
  } = await server.ssrLoadModule('/src/core/model/projectValidation.ts');

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

  function bigSupply(overrides = {}) {
    return {
      ...defaultPanelSupply(30000),
      allocatedPowerW: 30000,
      inputBreaker: { poles: 2, ratingA: 63, curve: 'C' },
      inputCable: { sectionMm2: 16, cores: 3 },
      ...overrides,
    };
  }

  function find(findings, id) {
    return findings.find((finding) => finding.id === id);
  }

  await test('schematic: 21 groups are numbered QF2..QF22 after the input QF1', () => {
    const lines = Array.from({ length: 21 }, (_, index) =>
      line(`line-${index}`, 'sockets', { name: `Группа ${index + 1}` })
    );
    const schematic = buildPanelSchematic(panel({ lines, supply: bigSupply() }));
    assert.equal(schematic.groups.length, 21);
    assert.equal(schematic.inputItems[0].designation, 'QF1');
    assert.equal(schematic.groups[0].breakerDesignation, 'QF2');
    assert.equal(schematic.groups[20].breakerDesignation, 'QF22');
    assert.equal(schematic.groups[0].rcdDesignation, 'QD2');
    assert.equal(schematic.groups[20].rcdDesignation, 'QD22');
    assert.equal(
      new Set(schematic.groups.map((group) => group.breakerDesignation)).size,
      21
    );
  });

  await test('schematic: cosφ and demand factor change design power and current', () => {
    const target = line('a', 'sockets', {
      loadW: 2300,
      cosPhi: 0.92,
      demandFactor: 0.8,
    });
    const schematic = buildPanelSchematic(panel({ lines: [target], supply: bigSupply() }));
    const group = schematic.groups[0];
    near(group.installedPowerW, 2300, 'installed');
    near(group.designPowerW, 1840, 'design');
    near(group.currentA, 1840 / (230 * 0.92), 'current');
    near(group.cosPhi, 0.92, 'cosPhi');
    near(group.demandFactor, 0.8, 'demandFactor');
  });

  await test('schematic: single-phase groups have no phase assignment', () => {
    const schematic = buildPanelSchematic(
      panel({ lines: [line('a', 'sockets')] })
    );
    assert.equal(schematic.groups[0].phase, null);
    assert.deepEqual(schematic.phaseLoads, []);
    assert.equal(schematic.supply.voltageLabel, '230 В, 1 фаза');
  });

  await test('schematic: three-phase groups rotate L1/L2/L3 and keep explicit phase', () => {
    const lines = [
      line('a', 'sockets', { loadW: 2000 }),
      line('b', 'sockets', { loadW: 2000, phase: 'L1' }),
      line('c', 'sockets', { loadW: 2000 }),
      line('d', 'sockets', { loadW: 2000 }),
    ];
    const schematic = buildPanelSchematic(
      panel({
        lines,
        supply: bigSupply({
          phases: 3,
          inputCable: { sectionMm2: 16, cores: 5 },
          inputBreaker: { poles: 4, ratingA: 63, curve: 'C' },
          mainRcd: { ...makeRcd(100, 'A', 63, true), poles: 4 },
        }),
      })
    );
    assert.deepEqual(
      schematic.groups.map((group) => group.phase),
      ['L1', 'L1', 'L3', 'L1']
    );
    assert.equal(schematic.supply.voltageLabel, '380/220 В, 3 фазы');
    near(
      schematic.phaseLoads.find((load) => load.phase === 'L1').powerW,
      6000,
      'L1 power'
    );
    near(
      schematic.phaseLoads.find((load) => load.phase === 'L3').powerW,
      2000,
      'L3 power'
    );
  });

  await test('schematic: cable lengths come from routing and add up', () => {
    const schematic = buildPanelSchematic(
      panel({ lines: [line('a', 'sockets'), line('b', 'lighting')] }),
      { cableLengthsMm: new Map([['a', 12000], ['b', 3000]]) }
    );
    assert.equal(schematic.groups[0].cableLengthMm, 12000);
    assert.equal(schematic.groups[1].cableLengthMm, 3000);
    assert.equal(schematic.totalCableLengthMm, 15000);
  });

  await test('validation: breaker above cable ampacity is an error with a norm reference', () => {
    const target = line('a', 'sockets', {
      breaker: makeBreaker(32, 'C'),
      cable: makeCable(2.5),
    });
    const findings = validatePanel(panel({ lines: [target] }));
    const finding = find(findings, 'breaker-cable-a');
    assert.ok(finding, 'breaker-cable finding expected');
    assert.equal(finding.severity, 'error');
    assert.equal(finding.lineId, 'a');
    assert.match(finding.reference, /1\.3\.4/);
  });

  await test('validation: load current above breaker is an error', () => {
    const target = line('a', 'sockets', { loadW: 5000 });
    const findings = validatePanel(panel({ lines: [target] }));
    const finding = find(findings, 'load-breaker-a');
    assert.ok(finding);
    assert.equal(finding.severity, 'error');
  });

  await test('validation: sockets may not use a 1.5 mm² cable', () => {
    const target = line('a', 'sockets', {
      cable: makeCable(1.5),
      breaker: makeBreaker(10, 'C'),
    });
    const findings = validatePanel(panel({ lines: [target] }));
    const finding = find(findings, 'min-section-a');
    assert.ok(finding);
    assert.equal(finding.severity, 'error');
  });

  await test('validation: input RCD must be selective against group RCD', () => {
    const target = line('a', 'sockets', {
      rcd: makeRcd(30, 'A', 16),
    });
    const strict = validatePanel(
      panel({ lines: [target], supply: { mainRcd: makeRcd(30, 'A', 50, false) } })
    );
    assert.ok(find(strict, 'rcd-selectivity-a'), '30 mA cannot back up 30 mA');

    const selective = validatePanel(
      panel({ lines: [target], supply: { mainRcd: makeRcd(100, 'A', 50, true) } })
    );
    assert.equal(find(selective, 'rcd-selectivity-a'), undefined);
    assert.equal(find(selective, 'input-rcd-rating'), undefined);
  });

  await test('validation: lighting in a bathroom needs 30 mA type A', () => {
    const light = line('bath-light', 'lighting', {
      roomIds: ['room-bath'],
      roomName: 'Ванная',
    });
    const uncovered = validatePanel(
      panel({ lines: [light], supply: { mainRcd: makeRcd(100, 'A', 50, true) } }),
      { rooms: [livingRoom, bathroom] }
    );
    assert.ok(find(uncovered, 'wet-rcd-bath-light'));

    const covered = validatePanel(
      panel({ lines: [light], supply: { mainRcd: makeRcd(30, 'A', 50, false) } }),
      { rooms: [livingRoom, bathroom] }
    );
    assert.equal(find(covered, 'wet-rcd-bath-light'), undefined);
  });

  await test('validation: a wet group without its own RCD is an error', () => {
    const wet = line('wet-a', 'wet', { rcd: null });
    const findings = validatePanel(
      panel({ lines: [wet], supply: { mainRcd: makeRcd(100, 'A', 50, true) } })
    );
    assert.ok(find(findings, 'wet-rcd-wet-a'));
  });

  await test('validation: three-phase input requires a five-core cable', () => {
    const supply = {
      phases: 3,
      inputCable: { sectionMm2: 16, cores: 3 },
      inputBreaker: { poles: 4, ratingA: 63, curve: 'C' },
      mainRcd: { ...makeRcd(100, 'A', 63, true), poles: 4 },
    };
    const bad = validatePanel(panel({ lines: [line('a', 'sockets')], supply }));
    assert.ok(find(bad, 'input-cores'));

    const good = validatePanel(
      panel({
        lines: [line('a', 'sockets')],
        supply: { ...supply, inputCable: { sectionMm2: 16, cores: 5 } },
      })
    );
    assert.equal(find(good, 'input-cores'), undefined);
  });

  await test('validation: phase imbalance above 15 % is a warning', () => {
    const unbalanced = panel({
      lines: [
        line('a', 'sockets', { loadW: 7000 }),
        line('b', 'sockets', { loadW: 1000 }),
        line('c', 'sockets', { loadW: 1000 }),
      ],
      supply: {
        phases: 3,
        inputCable: { sectionMm2: 16, cores: 5 },
        inputBreaker: { poles: 4, ratingA: 63, curve: 'C' },
        mainRcd: { ...makeRcd(100, 'A', 63, true), poles: 4 },
      },
    });
    const finding = find(validatePanel(unbalanced), 'phase-imbalance');
    assert.ok(finding);
    assert.equal(finding.severity, 'warning');

    const balanced = clone(unbalanced);
    balanced.lines[0].loadW = 1000;
    assert.equal(find(validatePanel(balanced), 'phase-imbalance'), undefined);
  });

  await test('validation: voltage drop is checked against cable length', () => {
    const target = line('long', 'sockets', {
      loadW: 3680,
      cable: makeCable(2.5),
      breaker: makeBreaker(16, 'C'),
    });
    const long = validatePanel(panel({ lines: [target] }), {
      cableLengthsMm: { long: 60000 },
    });
    const finding = find(long, 'voltage-drop-long');
    assert.ok(finding);
    assert.equal(finding.severity, 'warning');

    const short = validatePanel(panel({ lines: [target] }), {
      cableLengthsMm: { long: 5000 },
    });
    assert.equal(find(short, 'voltage-drop-long'), undefined);
  });

  await test('validation: demand factor lowers the design power at the input', () => {
    const lines = [
      line('a', 'sockets', { loadW: 6000, demandFactor: 0.5 }),
      line('b', 'sockets', { loadW: 6000, demandFactor: 0.5 }),
    ];
    const withDemand = validatePanel(panel({ lines }));
    assert.equal(find(withDemand, 'total-load'), undefined);
    assert.ok(find(withDemand, 'installed-over-allocated'));

    lines[0].demandFactor = 1;
    lines[1].demandFactor = 1;
    assert.ok(find(validatePanel(panel({ lines })), 'total-load'));
  });

  await test('sanitize: an old project receives normative defaults', () => {
    const oldSupply = { ...defaultPanelSupply(10000) };
    for (const key of [
      'phases',
      'system',
      'reliabilityCategory',
      'cosPhi',
      'demandFactor',
      'cableBrand',
    ]) {
      delete oldSupply[key];
    }
    const oldPanel = {
      ...panel({
        lines: [
          line('a', 'sockets', {
            cosPhi: 1.5,
            demandFactor: 0,
            phase: 'L9',
          }),
        ],
      }),
      supply: oldSupply,
    };
    const restored = sanitizePanel(oldPanel, [livingRoom], [], 120);
    assert.ok(restored, 'panel must survive sanitize');
    assert.equal(restored.supply.phases, 1);
    assert.equal(restored.supply.system, 'TN-S');
    assert.equal(restored.supply.reliabilityCategory, 'III');
    assert.equal(restored.supply.cosPhi, 1);
    assert.equal(restored.supply.demandFactor, 1);
    assert.equal(restored.supply.cableBrand, 'ВВГнг(А)-LS');
    assert.equal(restored.lines[0].cosPhi, 1);
    assert.equal(restored.lines[0].demandFactor, 1);
    assert.equal(restored.lines[0].phase, undefined);
  });

  await test('snapshot: three-phase 5-core panel passes the import boundary', () => {
    const settings = {
      defaultWallThicknessMm: 120,
      exteriorWallThicknessMm: 250,
      ceilingHeightMm: 2700,
      floorLevelMm: 0,
      cableMarginPercent: 15,
      defaultRouting: 'ceiling',
      showDimensions: true,
    };
    const nodes = {
      n1: { id: 'n1', x: 0, y: 0 },
      n2: { id: 'n2', x: 4000, y: 0 },
      n3: { id: 'n3', x: 4000, y: 3000 },
      n4: { id: 'n4', x: 0, y: 3000 },
    };
    const wallPair = (id, a, b) => ({
      id,
      nodeAId: a,
      nodeBId: b,
      thicknessMm: 120,
      isExterior: false,
      roomIds: ['room-hall'],
    });
    const snapshot = {
      version: 1,
      savedAt: '2026-11-12T00:00:00.000Z',
      boundaryMode: 'manual',
      settings,
      apartment: null,
      rooms: [livingRoom],
      nodes,
      walls: [
        wallPair('w1', 'n1', 'n2'),
        wallPair('w2', 'n2', 'n3'),
        wallPair('w3', 'n3', 'n4'),
        wallPair('w4', 'n4', 'n1'),
      ],
      openings: [],
      freePartitions: [],
      shafts: [],
      devices: [],
      panel: panel({
        lines: [line('a', 'sockets')],
        supply: {
          phases: 3,
          inputCable: { sectionMm2: 16, cores: 5 },
          inputBreaker: { poles: 4, ratingA: 63, curve: 'C' },
          mainRcd: { ...makeRcd(100, 'A', 63, true), poles: 4 },
        },
      }),
    };
    assert.equal(validateProjectSnapshot(snapshot, settings), true);
    snapshot.panel.supply.inputCable.cores = 4;
    assert.equal(validateProjectSnapshot(snapshot, settings), false, '4 cores are not allowed');
  });

  await test('strategies: optimal protects bathroom lighting, budget uses one 30 mA RCD', () => {
    const lines = [
      line('bath-light', 'lighting', {
        roomIds: ['room-bath'],
        roomName: 'Ванная',
      }),
      line('hall-light', 'lighting'),
    ];
    const source = panel({ lines });
    const optimal = applyStrategy(source, 'optimal', [livingRoom, bathroom]);
    assert.ok(optimal.lines[0].rcd, 'bathroom light needs its own RCD');
    assert.equal(optimal.lines[0].rcd.sensitivityMa, 30);
    assert.equal(optimal.lines[1].rcd, null, 'living-room light stays unprotected');
    assert.equal(optimal.supply.mainRcd.sensitivityMa, 100);
    assert.equal(optimal.supply.mainRcd.selective, true);

    const budget = applyStrategy(source, 'budget', [livingRoom, bathroom]);
    assert.ok(budget.lines.every((candidate) => candidate.rcd === null));
    assert.equal(budget.supply.mainRcd.sensitivityMa, 30);
    assert.equal(budget.supply.mainRcd.type, 'A');
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

console.log(`\npanelSchematic: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

// Ручное рисование трассы: сессия, ортогональные ступеньки, фиксация цепей,
// узлы и сборка ManualRoute. Запуск: node tests/manualDraw.test.mjs
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

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  const draw = await server.ssrLoadModule('/src/core/electrical/manualDraw.ts');
  const {
    createManualDrawSession,
    startManualDrawChain,
    appendManualDrawPoint,
    appendManualDrawDevice,
    popManualDrawPoint,
    fixManualDrawChain,
    cancelManualDrawChain,
    addManualDrawJunction,
    removeLastManualDrawChain,
    manualDrawConnectedDevices,
    manualDrawRoute,
  } = draw;

  const panel = { x: 0, y: 0 };
  const d1 = { deviceId: 'd1', point: { x: 1000, y: 1000 } };
  const d2 = { deviceId: 'd2', point: { x: 3000, y: 1000 } };
  const d3 = { deviceId: 'd3', point: { x: 2000, y: 2000 } };

  function begin(devices = [d1, d2, d3]) {
    let session = createManualDrawSession(panel, devices);
    const started = startManualDrawChain(session, {
      kind: 'panel',
      point: panel,
    });
    assert.equal(started.ok, true, started.ok ? '' : started.error);
    return started.session;
  }

  function appendOk(session, point, axisFirst = 'h') {
    const result = appendManualDrawPoint(session, point, axisFirst);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    return result.session;
  }

  function deviceOk(session, deviceId, axisFirst = 'h') {
    const result = appendManualDrawDevice(session, deviceId, axisFirst);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    return result.session;
  }

  function fixOk(session) {
    const result = fixManualDrawChain(session);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    return result.session;
  }

  await test('первую цепь можно начать только от щитка', () => {
    const session = createManualDrawSession(panel, [d1, d2, d3]);
    const fromDevice = startManualDrawChain(session, {
      kind: 'device',
      point: d1.point,
      deviceId: 'd1',
    });
    assert.equal(fromDevice.ok, false);
    assert.match(fromDevice.error, /от щитка/);

    const fromPanel = startManualDrawChain(session, {
      kind: 'panel',
      point: panel,
    });
    assert.equal(fromPanel.ok, true);
    assert.deepEqual(fromPanel.session.active.points, [panel]);
  });

  await test('скрещивание строится ступенькой под 90°, без наклона', () => {
    let session = begin([d1]);
    session = appendOk(session, { x: 500, y: 500 });
    assert.deepEqual(session.active.points, [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 500 },
    ]);
    session = deviceOk(session, 'd1');
    assert.deepEqual(session.active.points.slice(-2), [
      { x: 1000, y: 500 },
      { x: 1000, y: 1000 },
    ]);
    assert.equal(session.active.endDeviceId, 'd1');
  });

  await test('первая нога меняет ось, чтобы не разворачиваться назад', () => {
    let session = begin([d1]);
    session = appendOk(session, { x: 0, y: 1000 }, 'v');
    session = appendOk(session, { x: 500, y: 500 }, 'v');
    assert.deepEqual(session.active.points.slice(-3), [
      { x: 0, y: 1000 },
      { x: 500, y: 1000 },
      { x: 500, y: 500 },
    ]);
  });

  await test('разворот на 180° по той же оси отклоняется', () => {
    let session = begin([d1]);
    session = appendOk(session, { x: 1000, y: 0 });
    const backward = appendManualDrawPoint(session, { x: 400, y: 0 }, 'h');
    assert.equal(backward.ok, false);
    assert.match(backward.error, /назад/);
  });

  await test('цепь нельзя зафиксировать в воздухе', () => {
    let session = begin([d1]);
    session = appendOk(session, { x: 800, y: 800 });
    const fixed = fixManualDrawChain(session);
    assert.equal(fixed.ok, false);
    assert.match(fixed.error, /заканчиваться на приборе/);
  });

  await test('ветвь от прибора: магистраль щиток—d1—d2 и отвод d1—d3', () => {
    let session = begin([d1, d2, d3]);
    session = deviceOk(session, 'd1');
    session = deviceOk(session, 'd2');
    session = fixOk(session);

    const branch = startManualDrawChain(session, {
      kind: 'device',
      point: d1.point,
      deviceId: 'd1',
    });
    assert.equal(branch.ok, true, branch.ok ? '' : branch.error);
    session = deviceOk(branch.session, 'd3');
    session = fixOk(session);
    assert.equal(session.chains.length, 2);

    const built = manualDrawRoute(session);
    assert.equal(built.ok, true, built.ok ? '' : built.error);
    assert.equal(built.route.anchors.filter((a) => a.kind === 'panel').length, 1);
    for (const deviceId of ['d1', 'd2', 'd3']) {
      assert.ok(
        built.route.anchors.some(
          (anchor) => anchor.kind === 'device' && anchor.deviceId === deviceId
        ),
        `нет привязки ${deviceId}`
      );
    }
    assert.equal(built.warnings.length, 0);
  });

  await test('кольцо через уже подключённый прибор запрещено', () => {
    let session = begin([d1, d2]);
    session = deviceOk(session, 'd1');
    session = deviceOk(session, 'd2');
    session = fixOk(session);
    const branch = startManualDrawChain(session, {
      kind: 'device',
      point: d1.point,
      deviceId: 'd1',
    });
    assert.equal(branch.ok, true);
    const ring = appendManualDrawDevice(branch.session, 'd2', 'h');
    assert.equal(ring.ok, false);
    assert.match(ring.error, /Кольцо/);
  });

  await test('плечо через уже существующую вершину даёт предупреждение о наложении', () => {
    const w1 = { deviceId: 'd1', point: { x: 1000, y: 1000 } };
    const w2 = { deviceId: 'd2', point: { x: 3000, y: 1000 } };
    const w3 = { deviceId: 'd3', point: { x: 500, y: 1000 } };
    let session = createManualDrawSession(panel, [w1, w2, w3]);
    session = startManualDrawChain(session, {
      kind: 'panel',
      point: panel,
    }).session;
    session = deviceOk(session, 'd1');
    session = deviceOk(session, 'd2');
    session = fixOk(session);

    const branch = startManualDrawChain(session, {
      kind: 'device',
      point: w2.point,
      deviceId: 'd2',
    });
    assert.equal(branch.ok, true, branch.ok ? '' : branch.error);
    const appended = appendManualDrawDevice(branch.session, 'd3', 'h');
    assert.equal(appended.ok, true, appended.ok ? '' : appended.error);
    session = fixOk(appended.session);
    assert.deepEqual(session.overlaps, [{ x: 1000, y: 1000 }]);

    const built = manualDrawRoute(session);
    assert.equal(built.ok, true, built.ok ? '' : built.error);
    assert.ok(
      built.warnings.some(
        (warning) =>
          warning.includes('(1000; 1000)') && warning.includes('наложится')
      ),
      built.warnings.join(' ')
    );
  });

  await test('откат точки снимает предупреждение о наложении', () => {
    const w1 = { deviceId: 'd1', point: { x: 1000, y: 1000 } };
    const w2 = { deviceId: 'd2', point: { x: 3000, y: 1000 } };
    const w3 = { deviceId: 'd3', point: { x: 500, y: 1000 } };
    let session = createManualDrawSession(panel, [w1, w2, w3]);
    session = startManualDrawChain(session, {
      kind: 'panel',
      point: panel,
    }).session;
    session = deviceOk(session, 'd1');
    session = deviceOk(session, 'd2');
    session = fixOk(session);
    session = startManualDrawChain(session, {
      kind: 'device',
      point: w2.point,
      deviceId: 'd2',
    }).session;
    session = deviceOk(session, 'd3');
    assert.equal(session.overlaps.length, 1);

    const popped = popManualDrawPoint(session);
    assert.equal(popped.ok, true, popped.ok ? '' : popped.error);
    assert.deepEqual(popped.session.overlaps, []);
  });

  await test('узел ставится на сегмент, расщепляет цепь и даёт ветвь', () => {
    const d2b = { deviceId: 'd2', point: { x: 3000, y: 1500 } };
    let session = begin([d1, d2b]);
    session = appendOk(session, { x: 1000, y: 0 });
    session = deviceOk(session, 'd1');
    session = fixOk(session);
    assert.deepEqual(session.chains[0].points, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ]);

    const junction = addManualDrawJunction(session, { x: 500, y: 40 }, 80);
    assert.equal(junction.ok, true, junction.ok ? '' : junction.error);
    assert.deepEqual(junction.point, { x: 500, y: 0 });
    session = junction.session;
    assert.equal(session.chains[0].points.length, 4);
    assert.deepEqual(session.junctions, [{ x: 500, y: 0 }]);

    const branch = startManualDrawChain(session, {
      kind: 'junction',
      point: { x: 500, y: 0 },
    });
    assert.equal(branch.ok, true, branch.ok ? '' : branch.error);
    session = appendOk(branch.session, { x: 500, y: 1500 }, 'v');
    session = deviceOk(session, 'd2');
    session = fixOk(session);

    const built = manualDrawRoute(session);
    assert.equal(built.ok, true, built.ok ? '' : built.error);
    assert.ok(
      built.route.anchors.some((anchor) => anchor.kind === 'junction'),
      'нет стыка в трассе'
    );
  });

  await test('узел нельзя ставить на незафиксированную цепь', () => {
    let session = begin([d1]);
    session = appendOk(session, { x: 1000, y: 1000 });
    const result = addManualDrawJunction(session, { x: 500, y: 0 }, 80);
    assert.equal(result.ok, false);
    assert.match(result.error, /зафиксируйте/i);
  });

  await test('удаление последней цепи убирает её узлы', () => {
    let session = begin([d1, d2]);
    session = deviceOk(session, 'd1');
    session = fixOk(session);

    const branch = startManualDrawChain(session, {
      kind: 'device',
      point: d1.point,
      deviceId: 'd1',
    });
    session = deviceOk(branch.session, 'd2');
    session = fixOk(session);
    assert.equal(session.chains.length, 2);

    const junction = addManualDrawJunction(session, { x: 2000, y: 1000 }, 80);
    assert.equal(junction.ok, true, junction.ok ? '' : junction.error);
    session = junction.session;
    assert.equal(session.junctions.length, 1);

    const removed = removeLastManualDrawChain(session);
    assert.equal(removed.ok, true);
    assert.equal(removed.session.chains.length, 1);
    assert.equal(removed.session.junctions.length, 0);
  });

  await test('неподключённые приборы блокируют сохранение', () => {
    let session = begin([d1, d2]);
    session = deviceOk(session, 'd1');
    session = fixOk(session);
    const built = manualDrawRoute(session, {
      deviceNames: { d1: 'Розетка 1', d2: 'Светильник 2' },
    });
    assert.equal(built.ok, false);
    assert.deepEqual(built.missingDeviceIds, ['d2']);
    assert.match(built.error, /Не подключены/);
    assert.match(built.error, /Светильник 2/);
  });

  await test('четыре кабеля в приборе дают предупреждение', () => {
    const d4 = { deviceId: 'd4', point: { x: 4000, y: 1000 } };
    const d5 = { deviceId: 'd5', point: { x: 1000, y: 2000 } };
    const d6 = { deviceId: 'd6', point: { x: 0, y: 1000 } };
    let session = createManualDrawSession(panel, [d1, d4, d5, d6]);
    session = startManualDrawChain(session, {
      kind: 'panel',
      point: panel,
    }).session;
    session = deviceOk(session, 'd1');
    session = deviceOk(session, 'd4');
    session = fixOk(session);

    let branch = startManualDrawChain(session, {
      kind: 'device',
      point: d1.point,
      deviceId: 'd1',
    });
    session = deviceOk(branch.session, 'd5');
    session = fixOk(session);

    branch = startManualDrawChain(session, {
      kind: 'device',
      point: d1.point,
      deviceId: 'd1',
    });
    session = deviceOk(branch.session, 'd6');
    session = fixOk(session);

    const built = manualDrawRoute(session, {
      deviceNames: { d1: 'Выключатель 1' },
    });
    assert.equal(built.ok, true, built.ok ? '' : built.error);
    assert.ok(
      built.warnings.some(
        (warning) => warning.includes('Выключатель 1') && warning.includes('4')
      ),
      built.warnings.join(' ')
    );
  });

  await test('поп и отмена текущей цепи', () => {
    let session = begin([d1]);
    session = appendOk(session, { x: 500, y: 500 });
    const popped = popManualDrawPoint(session);
    assert.equal(popped.ok, true);
    assert.equal(popped.session.active.points.length, 2);
    const cancelled = cancelManualDrawChain(popped.session);
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.session.active, null);
  });

  await test('подключённые приборы считаются по геометрии цепей', () => {
    let session = begin([d1, d2, d3]);
    session = deviceOk(session, 'd1');
    session = deviceOk(session, 'd3');
    session = fixOk(session);
    const connected = manualDrawConnectedDevices(session);
    assert.deepEqual([...connected].sort(), ['d1', 'd3']);
    assert.equal(connected.has('d2'), false);
  });
} finally {
  await server?.close();
}

console.log(`\nmanualDraw: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

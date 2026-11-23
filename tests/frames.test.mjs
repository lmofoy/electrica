// Рамки: геометрия мест, нормализация старых данных, действия стора и снапшоты.
// Запуск: node tests/frames.test.mjs
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

// Комната 4x3 м: грани 0..3 — верх, право, низ, лево.
const room = {
  id: 'room-1',
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
  { id: 'w1', nodeAId: 'n1', nodeBId: 'n2', thicknessMm: 120, isExterior: true, roomIds: ['room-1'] },
  { id: 'w2', nodeAId: 'n2', nodeBId: 'n3', thicknessMm: 120, isExterior: true, roomIds: ['room-1'] },
  { id: 'w3', nodeAId: 'n3', nodeBId: 'n4', thicknessMm: 120, isExterior: true, roomIds: ['room-1'] },
  { id: 'w4', nodeAId: 'n4', nodeBId: 'n1', thicknessMm: 120, isExterior: true, roomIds: ['room-1'] },
];
const partition = {
  id: 'p1',
  p1: { x: 2600, y: 400 },
  p2: { x: 2600, y: 2600 },
  thicknessMm: 100,
  roomId: 'room-1',
};
const settings = {
  defaultWallThicknessMm: 120,
  exteriorWallThicknessMm: 250,
  ceilingHeightMm: 2700,
  floorLevelMm: 0,
  cableMarginPercent: 15,
  defaultRouting: 'ceiling',
  showDimensions: true,
};
const edgeAnchor = (edgeIndex = 0, offsetMm = 1000, roomId = 'room-1') => ({
  kind: 'room_edge',
  roomId,
  edgeIndex,
  offsetMm,
});
const partitionAnchor = (offsetMm = 800) => ({
  kind: 'partition',
  partitionId: 'p1',
  offsetMm,
  side: 1,
});
const frameOf = (id, anchor, posts = 1, heightFromFloorMm = 300) => ({
  id,
  anchor,
  heightFromFloorMm,
  posts,
  mounting: 'flush',
});
const socket = (id, anchor, patch = {}) => ({
  id,
  type: 'socket_single',
  name: id,
  anchor,
  heightFromFloorMm: 300,
  powerWatts: 2200,
  shared: false,
  ...patch,
});
const lamp = {
  id: 'lamp-1',
  type: 'light_ceiling',
  name: 'Светильник',
  anchor: { kind: 'room_point', roomId: 'room-1', x: 1800, y: 1500 },
  heightFromFloorMm: 2700,
  powerWatts: 60,
  shared: false,
};

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const framesMod = await server.ssrLoadModule('/src/core/electrical/frames.ts');
  const {
    framePlateWidthMm,
    frameSeatOffsetMm,
    frameSeatAnchor,
    sanitizeElectrical,
    FRAME_SINGLE_WIDTH_MM,
    FRAME_POST_PITCH_MM,
  } = framesMod;
  const { DEVICE_CATALOG } = await server.ssrLoadModule('/src/core/electrical/devices.ts');
  const { useProjectStore, isProjectSnapshot, getProjectSnapshot } =
    await server.ssrLoadModule('/src/store/useProjectStore.ts');

  const state = () => useProjectStore.getState();
  const thickness = settings.defaultWallThicknessMm;

  function load(devices, frames = [], patch = {}) {
    state().resetProject();
    state().loadProject({
      version: 1,
      savedAt: new Date().toISOString(),
      boundaryMode: 'manual',
      settings,
      apartment: null,
      rooms: [room],
      nodes,
      walls,
      openings: [],
      freePartitions: [partition],
      devices,
      frames,
      panel: null,
      ...patch,
    });
  }

  function deviceAt(frameId, seatIndex = 0) {
    return state().devices.find(
      (device) => device.frameId === frameId && device.seatIndex === seatIndex
    );
  }

  // ---------------------------------------------------------------
  // Ядро
  // ---------------------------------------------------------------
  await test('core: frame plate width and symmetric seat offsets', () => {
    assert.equal(FRAME_SINGLE_WIDTH_MM, 82);
    assert.equal(FRAME_POST_PITCH_MM, 71);
    assert.equal(framePlateWidthMm(1), 82);
    assert.equal(framePlateWidthMm(2), 153);
    assert.equal(framePlateWidthMm(3), 224);
    assert.equal(framePlateWidthMm(4), 295);
    assert.deepEqual(
      [0, 1, 2, 3].map((seat) => frameSeatOffsetMm(4, seat)),
      [-106.5, -35.5, 35.5, 106.5]
    );
    assert.deepEqual(
      [0, 1].map((seat) => frameSeatOffsetMm(2, seat)),
      [-35.5, 35.5]
    );
    assert.equal(frameSeatOffsetMm(1, 0), 0);
    // Сумма смещений по симметрии равна нулю.
    const total = [0, 1, 2, 3].reduce((sum, seat) => sum + frameSeatOffsetMm(4, seat), 0);
    assert.ok(Math.abs(total) < 1e-9, 'offsets are symmetric');
  });

  await test('core: frameSeatAnchor shifts offset and keeps the anchor kind', () => {
    const frame = frameOf('f2', edgeAnchor(1, 1200), 2);
    const first = frameSeatAnchor(frame, 0);
    const second = frameSeatAnchor(frame, 1);
    assert.equal(first.offsetMm, 1200 - 35.5);
    assert.equal(second.offsetMm, 1200 + 35.5);
    for (const anchor of [first, second]) {
      assert.equal(anchor.kind, 'room_edge');
      assert.equal(anchor.roomId, 'room-1');
      assert.equal(anchor.edgeIndex, 1);
    }

    const onPartition = frameOf('f3', partitionAnchor(800), 4);
    const seat = frameSeatAnchor(onPartition, 3);
    assert.equal(seat.kind, 'partition');
    assert.equal(seat.partitionId, 'p1');
    assert.equal(seat.side, 1);
    assert.equal(seat.offsetMm, 800 + 106.5);
  });

  await test('core: legacy single socket gets its own one-seat frame', () => {
    const result = sanitizeElectrical([socket('s1', edgeAnchor())], [], [room], [partition], thickness);
    assert.equal(result.frames.length, 1);
    assert.equal(result.devices.length, 1);
    const frame = result.frames[0];
    assert.equal(frame.posts, 1);
    assert.equal(frame.heightFromFloorMm, 300);
    assert.equal(result.devices[0].frameId, frame.id);
    assert.equal(result.devices[0].seatIndex, 0);
    assert.deepEqual(result.devices[0].anchor, edgeAnchor());
  });

  await test('core: ceiling lamp stays frameless, frames keep wall mechanisms', () => {
    const wall = socket('s1', edgeAnchor());
    const result = sanitizeElectrical([wall, lamp], [], [room], [partition], thickness);
    assert.equal(result.frames.length, 1);
    const stored = result.devices.find((device) => device.id === 'lamp-1');
    assert.equal(stored.frameId, undefined);
    assert.equal(stored.seatIndex, undefined);
    const wrapped = result.devices.find((device) => device.id === 's1');
    assert.equal(wrapped.frameId, result.frames[0].id);
  });

  await test('core: broken frameId or busy seat wraps the device into its own frame', () => {
    const two = frameOf('f2', edgeAnchor(1, 1500), 2);
    const onSeat = sanitizeElectrical(
      [
        socket('a', edgeAnchor(1, 1464.5), { frameId: 'f2', seatIndex: 0 }),
        socket('b', edgeAnchor(1, 1535.5), { frameId: 'f2', seatIndex: 0 }),
        socket('c', edgeAnchor(2, 900), { frameId: 'missing', seatIndex: 0 }),
      ],
      [two],
      [room],
      [partition],
      thickness
    );
    assert.equal(onSeat.devices.length, 3, 'no device is lost');
    assert.equal(onSeat.frames.length, 3, 'two extra one-seat frames');
    const a = onSeat.devices.find((device) => device.id === 'a');
    assert.equal(a.frameId, 'f2');
    assert.equal(a.seatIndex, 0);
    const b = onSeat.devices.find((device) => device.id === 'b');
    const c = onSeat.devices.find((device) => device.id === 'c');
    for (const device of [b, c]) {
      assert.notEqual(device.frameId, 'f2');
      assert.notEqual(device.frameId, 'missing');
      assert.equal(device.seatIndex, 0);
      const frame = onSeat.frames.find((candidate) => candidate.id === device.frameId);
      assert.ok(frame, `frame exists for ${device.id}`);
      assert.equal(frame.posts, 1);
      assert.deepEqual(frame.anchor, device.anchor);
    }
    assert.notEqual(b.frameId, c.frameId);
  });

  await test('core: frames on missing wall or room are dropped', () => {
    const good = frameOf('ok', edgeAnchor());
    const missingWall = frameOf('bad-wall', { kind: 'room_edge', roomId: 'room-x', edgeIndex: 0, offsetMm: 500 });
    const missingRoom = frameOf('bad-room', {
      kind: 'partition',
      partitionId: 'p-x',
      offsetMm: 500,
      side: 1,
    });
    const result = sanitizeElectrical(
      [socket('good', edgeAnchor(), { frameId: 'ok', seatIndex: 0 })],
      [good, missingWall, missingRoom],
      [room],
      [partition],
      thickness
    );
    const ids = result.frames.map((frame) => frame.id);
    assert.deepEqual(ids, ['ok']);
    assert.equal(result.devices.length, 1);
    assert.equal(result.devices[0].frameId, 'ok');
  });

  // ---------------------------------------------------------------
  // Стор
  // ---------------------------------------------------------------
  await test('store: addFrame creates a selected frame and uses active posts', () => {
    load([]);
    state().setActiveFramePosts(4);
    const id = state().addFrame(edgeAnchor());
    assert.ok(id, 'frame id returned');
    const frame = state().frames.find((candidate) => candidate.id === id);
    assert.ok(frame, 'frame stored');
    assert.equal(frame.posts, 4);
    assert.deepEqual(state().selection, { kind: 'frame', id });

    state().setActiveFramePosts(2);
    const second = state().addFrame(edgeAnchor(1, 1200));
    assert.equal(state().frames.find((candidate) => candidate.id === second).posts, 2);
  });

  await test('store: startFramePlacement arms the frame tool with the configured block', () => {
    load([]);
    state().setActiveFramePosts(3);
    state().setActiveFrameSeatType(0, 'socket_single');
    state().setActiveFrameMounting('surface');
    state().startFramePlacement();

    assert.equal(state().activeTool, 'place_frame');
    assert.equal(state().activeFramePosts, 3);
    assert.deepEqual(state().activeFrameSeatTypes, ['socket_single', null, null]);
    assert.equal(state().activeFrameMounting, 'surface');
    assert.equal(state().activeFrameHeightMm, DEVICE_CATALOG.socket_single.defaultHeightMm);
  });

  await test('store: addFrame places the whole block in one step, blanks stay empty', () => {
    load([]);
    state().setActiveFramePosts(3);
    state().setActiveFrameSeatType(0, 'socket_single');
    state().setActiveFrameSeatType(2, 'switch_1k');
    state().setActiveFrameMounting('surface');
    state().setActiveFrameHeight(1200);

    const id = state().addFrame(edgeAnchor(2, 1400));
    const frame = state().frames.find((candidate) => candidate.id === id);
    assert.equal(frame.posts, 3);
    assert.equal(frame.mounting, 'surface');
    assert.equal(frame.heightFromFloorMm, 1200, 'single block height');
    assert.equal(
      state().devices.filter((device) => device.frameId === id).length,
      2,
      'only filled seats create devices'
    );
    assert.equal(deviceAt(id, 1), undefined, 'blank seat is a заглушка, not a device');

    const socket = deviceAt(id, 0);
    assert.equal(socket.type, 'socket_single');
    assert.equal(socket.heightFromFloorMm, 1200);
    assert.equal(socket.name, 'Розетка одинарная 1');
    assert.deepEqual(socket.anchor, frameSeatAnchor(frame, 0));
    assert.equal(deviceAt(id, 2).type, 'switch_1k');
    assert.deepEqual(deviceAt(id, 2).anchor, frameSeatAnchor(frame, 2));

    const second = state().addFrame(edgeAnchor(3, 1400));
    assert.equal(
      state().devices.filter((device) => device.frameId === second).length,
      2,
      'the same block repeats'
    );

    useProjectStore.temporal.getState().undo();
    assert.equal(state().frames.length, 1, 'undo removes the second block');
    assert.equal(
      state().devices.filter((device) => device.frameId === second).length,
      0,
      'undo removes both mechanisms with the frame in one step'
    );
    assert.equal(
      state().devices.filter((device) => device.frameId === id).length,
      2,
      'the first block survives undo'
    );
  });

  await test('store: seat type creates a device, first seat fixes the frame height', () => {
    load([]);
    const id = state().addFrame(edgeAnchor());
    state().setFrameSeatType(id, 0, 'socket_single');
    const device = deviceAt(id, 0);
    assert.ok(device, 'device placed in the frame');
    assert.equal(device.type, 'socket_single');
    assert.equal(device.heightFromFloorMm, 300);
    assert.equal(state().frames[0].heightFromFloorMm, 300);

    // Второй механизм подстраивается под высоту рамки, третья — снова запоминает её.
    state().setFramePosts(id, 3);
    state().setFrameSeatType(id, 2, 'switch_1k');
    assert.equal(state().frames[0].heightFromFloorMm, 300, 'frame height unchanged');
    assert.equal(deviceAt(id, 2).heightFromFloorMm, 300, 'new device follows the frame');
    assert.equal(deviceAt(id, 0).heightFromFloorMm, 300);

    // Когда рамка пуста, первый слот снова задаёт высоту.
    const empty = state().addFrame(edgeAnchor(1, 1200));
    state().setFramePosts(empty, 2);
    state().setFrameSeatType(empty, 1, 'switch_1k');
    const emptyFrame = state().frames.find((candidate) => candidate.id === empty);
    assert.equal(emptyFrame.heightFromFloorMm, 900);
  });

  await test('store: setFramePosts refuses to shrink over an occupied seat', () => {
    load([]);
    const id = state().addFrame(edgeAnchor(0, 2000));
    state().setFramePosts(id, 4);
    state().setFrameSeatType(id, 0, 'socket_single');
    state().setFrameSeatType(id, 3, 'socket_single');
    const before = state().devices.map((device) => device.id).sort();

    state().setFramePosts(id, 2);
    assert.equal(state().frames[0].posts, 4, 'frame keeps four seats');
    assert.deepEqual(state().devices.map((device) => device.id).sort(), before, 'devices stay');
    assert.ok(state().toasts.at(-1)?.message.includes('освободите'));

    const before3 = deviceAt(id, 3).anchor.offsetMm;
    assert.equal(before3, 2000 + 106.5);
    state().setFrameSeatType(id, 3, null);
    state().setFramePosts(id, 2);
    assert.equal(state().frames[0].posts, 2, 'frame shrinks after the seat is freed');
    assert.equal(deviceAt(id, 0).anchor.offsetMm, 2000 - 35.5, 'remaining seat is re-centred');
  });

  await test('store: growth re-centres the plate so it stays on the wall', () => {
    load([]);
    // Рамка стоит у самого начала стены (4000 мм), где помещается только одна плата.
    const id = state().addFrame(edgeAnchor(0, 100));
    state().setFramePosts(id, 4);
    const frame = state().frames[0];
    assert.equal(frame.anchor.offsetMm, 177.5, 'centre moves to fit the 295 mm plate');

    for (let seat = 0; seat < 4; seat += 1) {
      state().setFrameSeatType(id, seat, 'socket_single');
      const device = deviceAt(id, seat);
      assert.ok(device, `seat ${seat} has a mechanism`);
      assert.equal(device.anchor.offsetMm, 177.5 + (seat - 1.5) * 71);
      assert.ok(device.anchor.offsetMm >= 0, `seat ${seat} stays on the wall`);
    }
  });

  await test('store: setFrameHeight syncs devices and clamps to the ceiling', () => {
    load([]);
    const id = state().addFrame(edgeAnchor());
    state().setFramePosts(id, 2);
    state().setFrameSeatType(id, 0, 'socket_single');
    state().setFrameSeatType(id, 1, 'switch_1k');

    state().setFrameHeight(id, 1200);
    assert.equal(state().frames[0].heightFromFloorMm, 1200);
    for (const seat of [0, 1]) {
      const device = deviceAt(id, seat);
      assert.ok(device, `seat ${seat} exists`);
      assert.equal(device.heightFromFloorMm, 1200, `seat ${seat} follows the frame`);
    }

    state().setFrameHeight(id, 99999);
    assert.equal(state().frames[0].heightFromFloorMm, settings.ceilingHeightMm);
    for (const seat of [0, 1]) {
      assert.equal(deviceAt(id, seat).heightFromFloorMm, settings.ceilingHeightMm);
    }
  });

  await test('store: deleteFrame removes the frame, its devices and panel refs', () => {
    load([]);
    state().placePanel(edgeAnchor(2, 1500));
    const id = state().addFrame(edgeAnchor(1, 1500));
    state().setFramePosts(id, 2);
    state().setFrameSeatType(id, 0, 'socket_single');
    state().setFrameSeatType(id, 1, 'socket_single');
    const doomed = [deviceAt(id, 0).id, deviceAt(id, 1).id];
    const keep = state().addFrame(edgeAnchor(3, 1500));
    state().setFrameSeatType(keep, 0, 'socket_single');
    const keepId = deviceAt(keep, 0).id;

    const lineId = state().createPanelLineFromDevices(doomed, 'sockets');
    assert.ok(lineId, 'line created');
    assert.ok(
      state().panel.lines.some((line) => line.deviceIds.includes(doomed[0])),
      'line holds the device'
    );

    state().deleteFrame(id);
    assert.equal(state().frames.some((frame) => frame.id === id), false);
    for (const deviceId of doomed) {
      assert.equal(state().devices.some((device) => device.id === deviceId), false);
    }
    assert.ok(state().devices.some((device) => device.id === keepId), 'other frame survives');
    const refs = state().panel.lines.flatMap((line) => line.deviceIds);
    assert.deepEqual(refs, [], 'panel lines no longer reference deleted devices');
  });

  await test('store: deletePartition removes only the frame on that partition', () => {
    load([]);
    const onPartition = state().addFrame(partitionAnchor());
    state().setFrameSeatType(onPartition, 0, 'socket_single');
    const onWall = state().addFrame(edgeAnchor(0, 1500));
    state().setFrameSeatType(onWall, 0, 'socket_single');
    const wallDevice = deviceAt(onWall, 0).id;

    state().deletePartition('p1');
    assert.equal(state().frames.some((frame) => frame.id === onPartition), false);
    assert.equal(
      state().devices.some((device) => device.frameId === onPartition),
      false
    );
    const wallFrame = state().frames.find((frame) => frame.id === onWall);
    assert.ok(wallFrame, 'wall frame remains');
    assert.ok(state().devices.some((device) => device.id === wallDevice), 'wall device remains');
  });

  await test('store: undo brings back the frame and its devices', () => {
    load([]);
    const id = state().addFrame(edgeAnchor());
    state().setFramePosts(id, 2);
    state().setFrameSeatType(id, 0, 'socket_single');
    state().setFrameSeatType(id, 1, 'switch_1k');
    const deviceIds = state().devices.map((device) => device.id).sort();

    state().deleteFrame(id);
    assert.equal(state().frames.length, 0);
    assert.equal(state().devices.length, 0);

    useProjectStore.temporal.getState().undo();
    const frame = state().frames.find((candidate) => candidate.id === id);
    assert.ok(frame, 'frame restored');
    assert.equal(frame.posts, 2);
    assert.deepEqual(state().devices.map((device) => device.id).sort(), deviceIds);
    assert.ok(state().devices.every((device) => device.frameId === id));
  });

  await test('snapshot: frames are saved and validated strictly', () => {
    load([]);
    const id = state().addFrame(edgeAnchor());
    const snapshot = getProjectSnapshot();
    assert.ok(Array.isArray(snapshot.frames));
    assert.equal(snapshot.frames.length, 1);
    assert.ok(isProjectSnapshot(snapshot), 'snapshot with frames is accepted');

    const withFrames = (frames) => ({ ...snapshot, frames });
    const withDevices = (devices) => ({ ...snapshot, devices });
    const frame = snapshot.frames[0];

    assert.ok(isProjectSnapshot(withFrames([{ ...frame, posts: 2 }])), 'posts 2 accepted');
    assert.equal(isProjectSnapshot(withFrames([{ ...frame, posts: 5 }])), false, 'posts 5 rejected');
    const badSeat = {
      ...socket('x', edgeAnchor()),
      frameId: id,
      seatIndex: 9,
    };
    assert.equal(isProjectSnapshot(withDevices([badSeat])), false, 'seatIndex 9 rejected');
    const halfRef = { ...socket('y', edgeAnchor()), frameId: id };
    assert.equal(isProjectSnapshot(withDevices([halfRef])), false, 'frameId without seatIndex rejected');
    const seatOnly = { ...socket('z', edgeAnchor()), seatIndex: 0 };
    assert.equal(isProjectSnapshot(withDevices([seatOnly])), false, 'seatIndex without frameId rejected');
  });

  await test('snapshot: legacy JSON without frames wraps wall devices', () => {
    load([
      socket('s1', edgeAnchor(0, 900)),
      socket('s2', edgeAnchor(1, 1600), { heightFromFloorMm: 900 }),
      lamp,
    ]);
    assert.equal(state().frames.length, 2, 'one frame per wall mechanism');
    const s1 = state().devices.find((device) => device.id === 's1');
    const s2 = state().devices.find((device) => device.id === 's2');
    for (const device of [s1, s2]) {
      assert.ok(device.frameId, `${device.id} gets a frame`);
      assert.equal(device.seatIndex, 0);
      const frame = state().frames.find((candidate) => candidate.id === device.frameId);
      assert.equal(frame.posts, 1);
      assert.equal(frame.heightFromFloorMm, device.heightFromFloorMm);
    }
    const storedLamp = state().devices.find((device) => device.id === 'lamp-1');
    assert.ok(storedLamp, 'lamp kept');
    assert.equal(storedLamp.frameId, undefined);
    assert.deepEqual(
      state().frames.map((frame) => frame.heightFromFloorMm).sort((a, b) => a - b),
      [300, 900]
    );
  });
} finally {
  await server?.close();
}

console.log(`\nframes: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

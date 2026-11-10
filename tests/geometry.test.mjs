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
const clone = (value) => structuredClone(value);
const ROOM_ID = 'geom-room';
const settings = {
  defaultWallThicknessMm: 120, exteriorWallThicknessMm: 250,
  ceilingHeightMm: 2800, floorLevelMm: -150, cableMarginPercent: 17.5,
  defaultRouting: 'ceiling', showDimensions: true,
};

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
  const { validateNewRoom, buildAutoLayout } =
    await server.ssrLoadModule('/src/core/geometry/autoLayout.ts');
  const { isSimplePolygon } = await server.ssrLoadModule('/src/core/geometry/math.ts');
  const { useProjectStore: store } =
    await server.ssrLoadModule('/src/store/useProjectStore.ts');
  const state = () => store.getState();

  // A room ring helper that supports rectangle and acute/obtuse parallelogram,
  // in either winding, so validation is exercised on non-right angles too.
  function roomRing(skew, reverse) {
    const verts = [
      { x: 0, y: 0 }, { x: 4000, y: 0 },
      { x: 4000 + skew, y: 3000 }, { x: skew, y: 3000 },
    ];
    return reverse ? verts.reverse() : verts;
  }

  // ---- #8: self-intersecting / degenerate room contours are rejected ----
  await test('#8 isSimplePolygon: rectangle and obtuse/acute parallelogram are simple', () => {
    assert.equal(isSimplePolygon(roomRing(0, false)), true);
    assert.equal(isSimplePolygon(roomRing(1500, false)), true);
    assert.equal(isSimplePolygon(roomRing(1500, true)), true);
    assert.equal(isSimplePolygon(roomRing(-1500, false)), true);
  });

  await test('#8 isSimplePolygon: bowtie, doubling-back, duplicate vertex, <3 pts rejected', () => {
    assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }, { x: 3000, y: 3000 }]), false, 'bowtie');
    assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 2000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }]), false, 'doubling back');
    assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }]), false, 'duplicate vertex');
    assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 4000, y: 0 }]), false, 'too few');
  });

  for (const skew of [0, 1500]) {
    for (const reverse of [false, true]) {
      const label = `${skew ? 'parallelogram' : 'rectangle'}/${reverse ? 'rev' : 'fwd'}`;
      await test(`#8 validateNewRoom accepts a valid ${label} room`, () => {
        const res = validateNewRoom([], settings.defaultWallThicknessMm, roomRing(skew, reverse));
        assert.equal(res.ok, true, JSON.stringify(res));
      });
    }
  }

  await test('#8 validateNewRoom rejects a self-intersecting (bowtie) contour', () => {
    const res = validateNewRoom([], settings.defaultWallThicknessMm,
      [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }, { x: 3000, y: 3000 }]);
    assert.equal(res.ok, false);
    assert.match(res.error, /самопересекается|вырожден/i);
  });

  // ---- shared snapshot builder (auto layout nodes/walls/apartment) ----
  function buildSnapshot(skew, { manual = false, shafts = [] } = {}) {
    const room = {
      id: ROOM_ID, name: 'Room', type: 'living', nodeIds: [],
      vertices: roomRing(skew, false), holes: [], color: '#888', wallThicknessMm: 120,
    };
    const layout = buildAutoLayout([room], shafts, [], [], settings.defaultWallThicknessMm);
    return {
      version: 1, savedAt: new Date(0).toISOString(),
      boundaryMode: manual ? 'manual' : 'auto',
      settings: clone(settings), apartment: clone(layout.apartment),
      rooms: clone(layout.rooms ?? [room]), nodes: clone(layout.nodes), walls: clone(layout.walls),
      openings: [], freePartitions: [], shafts: clone(shafts),
      devices: [], panel: null,
    };
  }

  // ---- #5: shafts can be deleted; room touching a shaft becomes removable ----
  await test('#5 deleteShaft removes the shaft, keeps the room, recomputes layout', () => {
    const shaft = { id: 'shaft-1', vertices: [{ x: 1000, y: 1000 }, { x: 1500, y: 1000 }, { x: 1500, y: 1500 }, { x: 1000, y: 1500 }] };
    state().loadProject(buildSnapshot(0, { shafts: [shaft] }));
    assert.equal(state().shafts.length, 1, 'shaft loaded');
    assert.equal(state().rooms.length, 1, 'room loaded');
    state().setSelection({ kind: 'shaft', id: 'shaft-1' });
    state().deleteShaft('shaft-1');
    assert.equal(state().shafts.length, 0, 'shaft removed');
    assert.equal(state().rooms.length, 1, 'room preserved');
    assert.equal(state().selection, null, 'selection cleared after deleting selected shaft');
    assert.ok(state().walls.length > 0, 'walls recomputed');
  });

  await test('#5 deleteShaft is undoable', () => {
    const shaft = { id: 'shaft-2', vertices: [{ x: 1000, y: 1000 }, { x: 1500, y: 1000 }, { x: 1500, y: 1500 }, { x: 1000, y: 1500 }] };
    state().loadProject(buildSnapshot(0, { shafts: [shaft] }));
    const past = store.temporal.getState().pastStates.length;
    state().deleteShaft('shaft-2');
    assert.equal(state().shafts.length, 0);
    assert.ok(store.temporal.getState().pastStates.length > past, 'history grew');
    store.temporal.getState().undo();
    assert.equal(state().shafts.length, 1, 'undo restored the shaft');
  });

  // ---- #6: overlapping openings on the same wall are rejected ----
  function wallPoints() {
    const wall = state().walls[0];
    const a = state().nodes[wall.nodeAId];
    const b = state().nodes[wall.nodeBId];
    const at = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    return { a, b, at, len: Math.hypot(b.x - a.x, b.y - a.y) };
  }
  await test('#6 second overlapping opening on the same wall is rejected', () => {
    state().loadProject(buildSnapshot(0));
    const w = wallPoints();
    assert.ok(w.len > 1000, 'wall long enough for two openings');
    state().setActiveTool('draw_opening');
    store.setState({ draftVertices: [w.at(0.2), w.at(0.4)] });
    state().finishDraft();
    assert.equal(state().openings.length, 1, 'first opening added');
    // Overlapping span on the same wall.
    state().setActiveTool('draw_opening');
    store.setState({ draftVertices: [w.at(0.3), w.at(0.5)] });
    state().finishDraft();
    assert.equal(state().openings.length, 1, 'overlapping opening rejected');
    // Non-overlapping span is accepted.
    state().setActiveTool('draw_opening');
    store.setState({ draftVertices: [w.at(0.6), w.at(0.8)] });
    state().finishDraft();
    assert.equal(state().openings.length, 2, 'disjoint opening accepted');
  });

  // ---- #7: manual-mode partition must lie fully inside one room ----
  await test('#7 manual partition with an endpoint outside the room is rejected', () => {
    state().loadProject(buildSnapshot(0, { manual: true }));
    assert.equal(state().boundaryMode, 'manual', 'manual mode loaded');
    state().setActiveTool('draw_partition');
    // midpoint inside (2000,1500); p2 far outside the 0..4000 room
    store.setState({ draftVertices: [{ x: 2000, y: 1500 }, { x: 6000, y: 1500 }] });
    state().finishDraft();
    assert.equal(state().freePartitions.length, 0, 'partition sticking out is rejected');
    // fully-inside partition is accepted
    state().setActiveTool('draw_partition');
    store.setState({ draftVertices: [{ x: 1000, y: 1500 }, { x: 3000, y: 1500 }] });
    state().finishDraft();
    assert.ok(state().freePartitions.length >= 1, 'inside partition accepted');
  });
} finally {
  await server?.close();
}

console.log(`\n${passed} passed; ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;

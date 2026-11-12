import type { Point2D, ProjectSettings, ProjectSnapshot } from '../../types';
import { DEVICE_TYPES } from '../electrical/devices';
import { LINE_PRESETS } from '../electrical/norms';

type RecordValue = Record<string, unknown>;
type Entity = RecordValue & { id: string };

function record(value: unknown): value is RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const id = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const oneOf = (value: unknown, choices: readonly unknown[]): boolean => choices.includes(value);

function arrayOf<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value)) return false;
  // Iteration also rejects sparse arrays passed directly to loadProject.
  for (const item of value) if (!check(item)) return false;
  return true;
}

function entities(value: unknown): value is Entity[] {
  const ids = new Set<string>();
  return arrayOf(value, (item): item is Entity => {
    if (!record(item) || !id(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
}

function point(value: unknown): value is Point2D {
  return record(value) && finite(value.x) && finite(value.y);
}

function segment(a: unknown, b: unknown): boolean {
  if (!point(a) || !point(b)) return false;
  const lengthSquared = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  return positive(lengthSquared);
}

function cross(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(p: Point2D, a: Point2D, b: Point2D): boolean {
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

function intersects(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (![abC, abD, cdA, cdB].every(Number.isFinite)) return true;
  return (abC === 0 && onSegment(c, a, b)) || (abD === 0 && onSegment(d, a, b)) ||
    (cdA === 0 && onSegment(a, c, d)) || (cdB === 0 && onSegment(b, c, d)) ||
    (Math.sign(abC) * Math.sign(abD) < 0 && Math.sign(cdA) * Math.sign(cdB) < 0);
}

function ring(value: unknown): value is Point2D[] {
  if (!arrayOf(value, point) || value.length < 3) return false;
  let area2 = 0;
  for (let i = 0; i < value.length; i++) {
    const a = value[i];
    const b = value[(i + 1) % value.length];
    const c = value[(i + 2) % value.length];
    if (!segment(a, b)) return false;
    area2 += a.x * b.y - b.x * a.y;
    // Collinear forward edges are valid; doubling back is not a simple ring.
    if (cross(a, b, c) === 0 &&
      (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) return false;
    for (let j = i + 2; j < value.length; j++) {
      if (i === 0 && j === value.length - 1) continue; // adjacent closing edge
      if (intersects(a, b, value[j], value[(j + 1) % value.length])) return false;
    }
  }
  // The model uses unclosed rings, in either winding, with no zero-length edges.
  return finite(area2) && area2 !== 0;
}

const holes = (value: unknown): boolean => value === undefined || arrayOf(value, ring);
const ids = (value: unknown): value is string[] => arrayOf(value, id);
function refs(value: unknown, existing: Set<string>): boolean {
  return ids(value) && new Set(value).size === value.length &&
    value.every((key) => existing.has(key));
}

function settings(value: unknown, defaults: ProjectSettings): boolean {
  if (!record(value)) return false;
  // Original settings are required; later additions keep loadProject's defaults.
  if (!positive(value.defaultWallThicknessMm) || !positive(value.exteriorWallThicknessMm) ||
    typeof value.showDimensions !== 'boolean') return false;
  const merged = { ...defaults, ...value };
  return positive(merged.ceilingHeightMm) && finite(merged.floorLevelMm) &&
    merged.floorLevelMm < merged.ceilingHeightMm && nonnegative(merged.cableMarginPercent) &&
    oneOf(merged.defaultRouting, ['ceiling', 'floor']);
}

function anchor(value: unknown, allowPoint: boolean): boolean {
  if (!record(value)) return false;
  if (value.kind === 'room_point') return allowPoint && id(value.roomId) && point(value);
  if (value.kind === 'partition') {
    return id(value.partitionId) && finite(value.offsetMm) && oneOf(value.side, [-1, 1]);
  }
  // resolveDevice wraps integer indices, clamps finite offsets, and drops missing
  // hosts. Keep those behaviors, but disallow fractional/non-finite indices.
  return value.kind === 'room_edge' && id(value.roomId) &&
    Number.isSafeInteger(value.edgeIndex) && finite(value.offsetMm);
}

function device(value: Entity): boolean {
  return oneOf(value.type, DEVICE_TYPES) && typeof value.name === 'string' &&
    anchor(value.anchor, true) && nonnegative(value.heightFromFloorMm) &&
    nonnegative(value.powerWatts) && typeof value.shared === 'boolean' &&
    (value.circuitId === undefined || id(value.circuitId));
}

function cable(value: unknown): boolean {
  return record(value) && positive(value.sectionMm2) && oneOf(value.cores, [3, 5]);
}

function breaker(value: unknown): boolean {
  return record(value) && oneOf(value.poles, [1, 2, 3, 4]) && positive(value.ratingA) &&
    oneOf(value.curve, ['B', 'C']);
}

function rcd(value: unknown): boolean {
  return value === null || (record(value) && oneOf(value.poles, [2, 4]) &&
    positive(value.ratingA) && positive(value.sensitivityMa) &&
    oneOf(value.type, ['A', 'AC']) &&
    (value.selective === undefined || typeof value.selective === 'boolean'));
}

function line(value: Entity): boolean {
  // sanitizeLines discards these entries before any nested data is consumed.
  if (!nonnegative(value.loadW)) return true;
  return typeof value.name === 'string' && typeof value.purpose === 'string' &&
    Object.hasOwn(LINE_PRESETS, value.purpose) &&
    (value.roomIds == null || ids(value.roomIds)) &&
    (value.deviceIds == null || ids(value.deviceIds)) &&
    cable(value.cable) && breaker(value.breaker) && rcd(value.rcd);
  // routing, colorIndex, manualRoute and waypoints are deliberately left to
  // sanitizeLines; stale/duplicate assignment references are pruned/normalized
  // by loadProject.
}

function panel(value: unknown): boolean {
  if (value == null) return true;
  if (!record(value) || !id(value.id) || typeof value.name !== 'string' ||
    !anchor(value.anchor, false) || !nonnegative(value.heightFromFloorMm) ||
    !oneOf(value.mounting, ['flush', 'surface']) ||
    !oneOf(value.strategy, ['budget', 'optimal', 'maximum', 'custom']) ||
    !entities(value.lines) || !value.lines.every(line)) return false;
  const supply = value.supply;
  // allocatedPowerW and voltageV are normalized by sanitizeSupply.
  return record(supply) && cable(supply.inputCable) && breaker(supply.inputBreaker) &&
    record(supply.meter) && typeof supply.meter.enabled === 'boolean' &&
    rcd(supply.mainRcd) && typeof supply.voltageRelay === 'boolean' &&
    typeof supply.surgeProtection === 'boolean';
}

/** Validate the import boundary, not room placement or electrical design rules.
 * Sanitizable electrical fields intentionally need not match their final TS type.
 */
export function validateProjectSnapshot(
  value: unknown,
  defaults: ProjectSettings
): value is ProjectSnapshot {
  if (!record(value) || value.version !== 1 || typeof value.savedAt !== 'string' ||
    !settings(value.settings, defaults) ||
    (value.boundaryMode !== undefined && !oneOf(value.boundaryMode, ['auto', 'manual'])) ||
    !record(value.nodes) || !entities(value.rooms) || !entities(value.walls) ||
    !entities(value.openings) || !entities(value.freePartitions) || !entities(value.shafts) ||
    (value.devices !== undefined && (!entities(value.devices) || !value.devices.every(device)))) {
    return false;
  }

  const nodeIds = new Set(Object.keys(value.nodes));
  for (const [key, node] of Object.entries(value.nodes)) {
    if (!id(key) || !record(node) || node.id !== key || !point(node)) return false;
  }
  const roomIds = new Set(value.rooms.map((room) => room.id));
  for (const room of value.rooms) {
    if (typeof room.name !== 'string' || typeof room.color !== 'string' ||
      !oneOf(room.type, ['living', 'bedroom', 'kitchen', 'bathroom', 'toilet',
        'corridor', 'balcony', 'storage', 'custom']) ||
      !ring(room.vertices) || !holes(room.holes) || !positive(room.wallThicknessMm) ||
      !refs(room.nodeIds, nodeIds)) return false;
  }

  const apartment = value.apartment;
  if (apartment !== null && (!record(apartment) || !id(apartment.id) ||
    typeof apartment.name !== 'string' || !ring(apartment.vertices) || !holes(apartment.holes) ||
    !positive(apartment.exteriorWallThicknessMm) || !refs(apartment.nodeIds, nodeIds))) return false;

  for (const shaft of value.shafts) if (!ring(shaft.vertices)) return false;
  for (const partition of value.freePartitions) {
    if (!segment(partition.p1, partition.p2) || !positive(partition.thicknessMm) ||
      !id(partition.roomId) || !roomIds.has(partition.roomId)) return false;
  }
  for (const wall of value.walls) {
    if (!id(wall.nodeAId) || !id(wall.nodeBId) || !nodeIds.has(wall.nodeAId) ||
      !nodeIds.has(wall.nodeBId) || !segment(value.nodes[wall.nodeAId], value.nodes[wall.nodeBId]) ||
      !positive(wall.thicknessMm) || typeof wall.isExterior !== 'boolean' ||
      !refs(wall.roomIds, roomIds) || (wall.ownerRoomId !== undefined &&
        (!id(wall.ownerRoomId) || !roomIds.has(wall.ownerRoomId)))) return false;
  }
  // Openings may be hosted by a graph wall OR a free partition.
  const hosts = new Set(value.walls.map((wall) => wall.id));
  for (const partition of value.freePartitions) {
    if (hosts.has(partition.id)) return false; // ambiguous opening host
    hosts.add(partition.id);
  }
  for (const opening of value.openings) {
    if (!oneOf(opening.type, ['door', 'window']) || !id(opening.wallId) ||
      !hosts.has(opening.wallId) || !segment(opening.p1, opening.p2) ||
      !positive(opening.widthMm) || !positive(opening.heightMm) ||
      !nonnegative(opening.elevationMm) || !positive(opening.wallThicknessMm)) return false;
  }
  return panel(value.panel);
}

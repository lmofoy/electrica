import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping';
import type {
  ApartmentBoundary,
  FreePartition,
  Node2D,
  Opening,
  Point2D,
  RoomZone,
  ShaftCutout,
  Wall,
} from '../../types';
import {
  calculatePolygonAreaM2,
  computeOutwardWallPolygon,
  distance,
  isPointInPolygon,
  isPolygonClockwise,
  isSimplePolygon,
  pointToSegmentDistance,
} from './math';
import { buildPerimeterWallStrips } from './wallsGraph';

const AREA_TOLERANCE_M2 = 0.0001; // 100 мм²
const MIN_ROOM_AREA_M2 = 0.25;
const MIN_CONTACT_M2 = 0.0001;
const MIN_PARTITION_INSIDE_RATIO = 0.75;

type Geom = Polygon | MultiPolygon;

export interface AutoFloor {
  roomId: string;
  rings: Point2D[][]; // [внешнее кольцо, отверстия...]
  areaM2: number;
  isConnected: boolean;
}

export interface AutoLayout {
  apartment: ApartmentBoundary | null;
  floors: AutoFloor[];
  wallMesh: Point2D[][][];
  footprintRings: Point2D[][];
  nodes: Record<string, Node2D>;
  walls: Wall[];
  openings: Opening[];
  isConnected: boolean;
  apartmentAreaM2: number;
  totalFloorAreaM2: number;
}

export interface AutoValidation {
  ok: boolean;
  error?: string;
  roomId?: string;
}

// -------------------------------------------------------------
// Геометрические утилиты
// -------------------------------------------------------------
function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

function ringOf(points: Point2D[]): Ring {
  const ring: Ring = points.map((p) => [roundCoord(p.x), roundCoord(p.y)]);
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
}

function ringToPoints(ring: Ring): Point2D[] {
  const count =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1
      : ring.length;
  const points: Point2D[] = [];
  for (let i = 0; i < count; i++) {
    points.push({ x: ring[i][0], y: ring[i][1] });
  }
  return points;
}

function polygonOf(vertices: Point2D[], holes: Point2D[][] = []): Polygon {
  return [ringOf(vertices), ...holes.map((hole) => ringOf(hole))];
}

function pointsOfRing(ring: Ring): Point2D[] {
  return ringToPoints(ring);
}

function isEmptyGeom(geom: Geom): boolean {
  return !geom || geom.length === 0;
}

function unionGeoms(geoms: Geom[]): MultiPolygon {
  const filled = geoms.filter((geom) => !isEmptyGeom(geom));
  if (filled.length === 0) return [];
  return polygonClipping.union(filled[0], ...filled.slice(1));
}

function asMultiPolygon(geom: Geom): MultiPolygon {
  if (geom.length === 0) return [];
  const probe = geom[0] as unknown as number[][][];
  return typeof probe?.[0]?.[0] === 'number' ? [geom as Polygon] : (geom as MultiPolygon);
}

function differenceAll(subject: Geom, cutters: Geom[]): MultiPolygon {
  const filled = cutters.filter((geom) => !isEmptyGeom(geom));
  const subjectMulti = asMultiPolygon(subject);
  if (filled.length === 0) return subjectMulti;
  return polygonClipping.difference(subjectMulti, ...filled);
}

function multiAreaM2(multi: MultiPolygon): number {
  let area = 0;
  for (const poly of multi) {
    poly.forEach((ring, index) => {
      const ringArea = calculatePolygonAreaM2(ringToPoints(ring));
      area += index === 0 ? ringArea : -ringArea;
    });
  }
  return Math.max(0, area);
}

function polygonAreaM2(poly: Polygon): number {
  return multiAreaM2([poly]);
}

function intersectionAreaM2(a: Geom, b: Geom): number {
  if (isEmptyGeom(a) || isEmptyGeom(b)) return 0;
  try {
    return multiAreaM2(polygonClipping.intersection(a, b));
  } catch {
    return 0;
  }
}

function footprintOfRoom(roomVertices: Point2D[], thickness: number): MultiPolygon {
  const strips = buildPerimeterWallStrips(roomVertices, thickness);
  return unionGeoms([polygonOf(roomVertices), ...strips]);
}

function footprintUnionOf(rooms: RoomZone[], thickness: number): MultiPolygon {
  return unionGeoms(rooms.map((room) => footprintOfRoom(room.vertices, thickness)));
}

function floorUnionOf(rooms: RoomZone[]): MultiPolygon {
  return unionGeoms(rooms.map((room) => polygonOf(room.vertices, room.holes ?? [])));
}

export function partitionStripPolygon(
  partition: Pick<FreePartition, 'p1' | 'p2'>,
  thickness: number
): Polygon {
  const dx = partition.p2.x - partition.p1.x;
  const dy = partition.p2.y - partition.p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];

  const nx = -dy / len;
  const ny = dx / len;
  const half = thickness / 2;

  return [
    ringOf([
      { x: partition.p1.x - nx * half, y: partition.p1.y - ny * half },
      { x: partition.p2.x - nx * half, y: partition.p2.y - ny * half },
      { x: partition.p2.x + nx * half, y: partition.p2.y + ny * half },
      { x: partition.p1.x + nx * half, y: partition.p1.y + ny * half },
    ]),
  ];
}

export function shaftCutbackPolygon(shaftVertices: Point2D[], thickness: number): Polygon {
  return polygonOf(computeOutwardWallPolygon(shaftVertices, thickness));
}

function distanceToOutline(point: Point2D, vertices: Point2D[]): number {
  let min = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const d = pointToSegmentDistance(point, vertices[i], vertices[(i + 1) % vertices.length]);
    if (d < min) min = d;
  }
  return min;
}

function isInsideRoom(point: Point2D, room: RoomZone): boolean {
  if (isPointInPolygon(point, room.vertices)) {
    return !(room.holes ?? []).some((hole) => isPointInPolygon(point, hole));
  }
  return distanceToOutline(point, room.vertices) < 1.5;
}

// -------------------------------------------------------------
// Производные полы и планировка
// -------------------------------------------------------------
export function computeAutoFloors(
  rooms: RoomZone[],
  shafts: ShaftCutout[],
  partitions: FreePartition[],
  thickness: number
): AutoFloor[] {
  const shaftCutters = shafts.map((shaft) => shaftCutbackPolygon(shaft.vertices, thickness));

  return rooms.map((room) => {
    const cutters: Geom[] = [
      ...shaftCutters,
      ...partitions
        .filter((partition) => partition.roomId === room.id)
        .map((partition) => partitionStripPolygon(partition, thickness)),
    ];

    let result: MultiPolygon;
    try {
      result = differenceAll(polygonOf(room.vertices, room.holes ?? []), cutters);
    } catch {
      result = [polygonOf(room.vertices, room.holes ?? [])];
    }

    const rings = result[0] ? result[0].map((ring) => ringToPoints(ring)) : [];
    return {
      roomId: room.id,
      rings,
      areaM2: multiAreaM2(result),
      isConnected: result.length <= 1 && rings.length > 0,
    };
  });
}

// -------------------------------------------------------------
// Граф стен авто-режима: осевые линии на T/2 наружу от пола
// -------------------------------------------------------------
function makeHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function segmentKey(a: Point2D, b: Point2D): string {
  const first = `${Math.round(a.x)},${Math.round(a.y)}`;
  const second = `${Math.round(b.x)},${Math.round(b.y)}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function splitEdgeAtPoints(p1: Point2D, p2: Point2D, allPoints: Point2D[]): Point2D[][] {
  const onEdge = allPoints
    .filter((point) => {
      if (distance(point, p1) < 1 || distance(point, p2) < 1) return false;
      return pointToSegmentDistance(point, p1, p2) < 1;
    })
    .sort((a, b) => distance(p1, a) - distance(p1, b));

  const unique: Point2D[] = [];
  for (const point of onEdge) {
    if (unique.length === 0 || distance(unique[unique.length - 1], point) > 1) {
      unique.push(point);
    }
  }

  const chain = [p1, ...unique, p2];
  const segments: Point2D[][] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    if (distance(chain[i], chain[i + 1]) > 1) {
      segments.push([chain[i], chain[i + 1]]);
    }
  }
  return segments;
}

function buildAutoGraph(
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): { nodes: Record<string, Node2D>; walls: Wall[] } {
  const allPoints: Point2D[] = [];
  for (const room of rooms) {
    allPoints.push(...room.vertices);
  }
  for (const partition of partitions) {
    allPoints.push(partition.p1, partition.p2);
  }

  const edgeMap = new Map<
    string,
    { a: Point2D; b: Point2D; roomIds: string[]; partitionId?: string }
  >();

  const registerEdge = (
    a: Point2D,
    b: Point2D,
    roomId: string,
    partitionId?: string
  ) => {
    const key = partitionId ? `part-${partitionId}` : segmentKey(a, b);
    const existing = edgeMap.get(key);
    if (existing) {
      if (partitionId) return;
      if (!existing.roomIds.includes(roomId)) existing.roomIds.push(roomId);
      return;
    }
    edgeMap.set(key, { a, b, roomIds: [roomId], partitionId });
  };

  for (const room of rooms) {
    if (room.vertices.length < 3) continue;
    const isCW = isPolygonClockwise(room.vertices);
    const n = room.vertices.length;

    for (let i = 0; i < n; i++) {
      const p1 = room.vertices[i];
      const p2 = room.vertices[(i + 1) % n];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;

      const nx = isCW ? -dy / len : dy / len;
      const ny = isCW ? dx / len : -dx / len;
      const half = thickness / 2;

      const pieces = splitEdgeAtPoints(p1, p2, allPoints);
      for (const [pa, pb] of pieces) {
        const a = { x: pa.x + nx * half, y: pa.y + ny * half };
        const b = { x: pb.x + nx * half, y: pb.y + ny * half };
        registerEdge(a, b, room.id);
      }
    }
  }

  for (const partition of partitions) {
    registerEdge(partition.p1, partition.p2, partition.roomId, partition.id);
  }

  const nodes: Record<string, Node2D> = {};
  const nodeList: Node2D[] = [];
  const getOrCreateNode = (point: Point2D): string => {
    for (const node of nodeList) {
      if (distance(point, { x: node.x, y: node.y }) < 1) return node.id;
    }
    const id = `auto-node-${nodeList.length + 1}`;
    const node: Node2D = {
      id,
      x: roundCoord(point.x),
      y: roundCoord(point.y),
    };
    nodeList.push(node);
    nodes[id] = node;
    return id;
  };

  const walls: Wall[] = [];
  const usedIds = new Set<string>();

  for (const [key, edge] of edgeMap.entries()) {
    const nodeAId = getOrCreateNode(edge.a);
    const nodeBId = getOrCreateNode(edge.b);
    if (nodeAId === nodeBId) continue;

    let id = edge.partitionId
      ? `wall-part-${edge.partitionId}`
      : `wall-auto-${makeHash(key)}`;
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) suffix += 1;
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);

    walls.push({
      id,
      nodeAId,
      nodeBId,
      thicknessMm: thickness,
      isExterior: !edge.partitionId && edge.roomIds.length === 1,
      roomIds: edge.roomIds,
      ownerRoomId: edge.roomIds[0],
    });
  }

  return { nodes, walls };
}

// -------------------------------------------------------------
// Сборка производной планировки
// -------------------------------------------------------------
export function buildAutoLayout(
  rooms: RoomZone[],
  shafts: ShaftCutout[],
  partitions: FreePartition[],
  openings: Opening[],
  thickness: number
): AutoLayout {
  const floors = computeAutoFloors(rooms, shafts, partitions, thickness);
  const totalFloorAreaM2 = floors.reduce((sum, floor) => sum + floor.areaM2, 0);

  const footprints = footprintUnionOf(rooms, thickness);
  const shaftVoids = shafts.map((shaft) => polygonOf(shaft.vertices));

  let derived: MultiPolygon = [];
  try {
    derived = differenceAll(footprints, shaftVoids);
  } catch {
    derived = footprints;
  }

  const main = [...derived].sort((a, b) => polygonAreaM2(b) - polygonAreaM2(a))[0] ?? null;
  const apartment: ApartmentBoundary | null = main
    ? {
        id: 'apartment-auto',
        name: 'Контур квартиры',
        nodeIds: [],
        vertices: ringToPoints(main[0]),
        holes: main.slice(1).map((ring) => ringToPoints(ring)),
        exteriorWallThicknessMm: thickness,
      }
    : null;

  const floorUnion = floorUnionOf(rooms);
  let wallRegion: MultiPolygon = [];
  try {
    wallRegion = differenceAll(footprints, [floorUnion]);
  } catch {
    wallRegion = [];
  }

  const shaftRings: Polygon[] = [];
  for (const shaft of shafts) {
    try {
      const ring = differenceAll(shaftCutbackPolygon(shaft.vertices, thickness), [
        polygonOf(shaft.vertices),
      ]);
      shaftRings.push(...ring);
    } catch {
      // Вырожденная шахта — стену вокруг не строим
    }
  }

  const partitionPolys = partitions
    .map((partition) => partitionStripPolygon(partition, thickness))
    .filter((poly) => poly.length > 0);

  const wallGeoms: Geom[] = [wallRegion, ...shaftRings, ...partitionPolys];
  let rawWalls: MultiPolygon = [];
  try {
    rawWalls = unionGeoms(wallGeoms);
  } catch {
    rawWalls = [];
  }

  const openingCutters: Polygon[] = [];
  for (const opening of openings) {
    const dx = opening.p2.x - opening.p1.x;
    const dy = opening.p2.y - opening.p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const nx = -dy / len;
    const ny = dx / len;
    const halfDepth = thickness + 50;

    openingCutters.push([
      ringOf([
        { x: opening.p1.x - nx * halfDepth, y: opening.p1.y - ny * halfDepth },
        { x: opening.p2.x - nx * halfDepth, y: opening.p2.y - ny * halfDepth },
        { x: opening.p2.x + nx * halfDepth, y: opening.p2.y + ny * halfDepth },
        { x: opening.p1.x + nx * halfDepth, y: opening.p1.y + ny * halfDepth },
      ]),
    ]);
  }

  let wallMulti: MultiPolygon = [];
  try {
    wallMulti = differenceAll(rawWalls, openingCutters);
  } catch {
    wallMulti = rawWalls;
  }

  const wallMesh = wallMulti
    .map((poly) => poly.map((ring) => ringToPoints(ring)))
    .filter((rings) => rings.length > 0);

  const footprintRings = footprints.flatMap((poly) =>
    poly.map((ring) => ringToPoints(ring))
  );

  const { nodes, walls } = buildAutoGraph(rooms, partitions, thickness);

  const remappedOpenings: Opening[] = [];
  for (const opening of openings) {
    const mid = {
      x: (opening.p1.x + opening.p2.x) / 2,
      y: (opening.p1.y + opening.p2.y) / 2,
    };

    let bestWall: Wall | null = null;
    let bestDistance = Infinity;
    for (const wall of walls) {
      const nodeA = nodes[wall.nodeAId];
      const nodeB = nodes[wall.nodeBId];
      if (!nodeA || !nodeB) continue;
      const d = pointToSegmentDistance(mid, nodeA, nodeB);
      if (d < bestDistance) {
        bestDistance = d;
        bestWall = wall;
      }
    }

    if (!bestWall || bestDistance > Math.max(600, thickness * 3)) continue;
    remappedOpenings.push({
      ...opening,
      wallId: bestWall.id,
      wallThicknessMm: bestWall.thicknessMm,
    });
  }

  return {
    apartment,
    floors,
    wallMesh,
    footprintRings,
    nodes,
    walls,
    openings: remappedOpenings,
    isConnected: derived.length <= 1,
    apartmentAreaM2: multiAreaM2(derived),
    totalFloorAreaM2,
  };
}

// -------------------------------------------------------------
// Проверки размещения
// -------------------------------------------------------------
export function validateNewRoom(
  rooms: RoomZone[],
  thickness: number,
  newFloor: Point2D[]
): AutoValidation {
  if (newFloor.length < 3) {
    return { ok: false, error: 'Контур комнаты должен содержать минимум 3 точки.' };
  }

  if (!isSimplePolygon(newFloor)) {
    return {
      ok: false,
      error: 'Контур комнаты самопересекается или содержит вырожденные точки. Проверьте порядок вершин.',
    };
  }

  const areaM2 = calculatePolygonAreaM2(newFloor);
  if (areaM2 < MIN_ROOM_AREA_M2) {
    return { ok: false, error: 'Комната слишком мала. Очертите контур площадью больше 0,25 м².' };
  }

  try {
    const newFloorPoly = polygonOf(newFloor);

    for (const room of rooms) {
      const overlap = intersectionAreaM2(
        newFloorPoly,
        polygonOf(room.vertices, room.holes ?? [])
      );
      if (overlap > AREA_TOLERANCE_M2) {
        return {
          ok: false,
          error: 'Комнаты пересекаются. Измените контур комнаты — наложение не допускается.',
        };
      }
    }

    const existingFloors = floorUnionOf(rooms);
    const existingFootprints = footprintUnionOf(rooms, thickness);
    const existingWalls = differenceAll(existingFootprints, [existingFloors]);

    if (intersectionAreaM2(newFloorPoly, existingWalls) > AREA_TOLERANCE_M2) {
      return {
        ok: false,
        error:
          'Комната заходит на существующую стену. Привяжитесь к внешней грани стены и начните от неё.',
      };
    }

    const newFootprint = footprintOfRoom(newFloor, thickness);
    const newWalls = differenceAll(newFootprint, [newFloorPoly]);

    if (intersectionAreaM2(newWalls, existingFloors) > AREA_TOLERANCE_M2) {
      return {
        ok: false,
        error:
          'Стена новой комнаты заходит в существующее помещение. Отступите от комнаты на толщину стены.',
      };
    }

    if (rooms.length > 0) {
      const expandedFootprint = unionGeoms([
        newFootprint,
        ...newFootprint.map((poly) =>
          polygonOf(computeOutwardWallPolygon(pointsOfRing(poly[0]), 2))
        ),
      ]);
      const contactArea = intersectionAreaM2(expandedFootprint, existingFootprints);
      if (contactArea < MIN_CONTACT_M2) {
        return {
          ok: false,
          error:
            'Комната должна примыкать к существующим стенам. Отдельно стоящие комнаты не допускаются.',
        };
      }
    }

    if (newFootprint.length > 1) {
      return {
        ok: false,
        error: 'Контур комнаты самопересекается. Проверьте точки контура.',
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'Не удалось проверить геометрию комнаты. Проверьте контур.' };
  }
}

export function validateShaftPlacement(
  rooms: RoomZone[],
  shafts: ShaftCutout[],
  partitions: FreePartition[],
  thickness: number,
  shaftVertices: Point2D[]
): AutoValidation {
  if (rooms.length === 0) {
    return { ok: false, error: 'Сначала создайте хотя бы одну комнату.' };
  }
  if (shaftVertices.length < 3) {
    return { ok: false, error: 'Шахта должна быть замкнутым контуром.' };
  }
  if (calculatePolygonAreaM2(shaftVertices) < 0.01) {
    return { ok: false, error: 'Шахта слишком мала.' };
  }

  try {
    const shaftPoly = polygonOf(shaftVertices);
    const cutbackPoly = shaftCutbackPolygon(shaftVertices, thickness);
    const cutbackArea = polygonAreaM2(cutbackPoly);
    // Стену вокруг шахты можно строить по существующим стенам и по полу,
    // поэтому проверяем габарит комнат вместе со стенами: шахта может
    // вырезаться сразу из нескольких смежных комнат через общую стену.
    const footprintUnion = footprintUnionOf(rooms, thickness);

    const affectedRooms = rooms.filter(
      (room) => intersectionAreaM2(shaftPoly, polygonOf(room.vertices, room.holes ?? [])) > AREA_TOLERANCE_M2
    );
    if (affectedRooms.length === 0) {
      return { ok: false, error: 'Шахта должна находиться внутри комнаты.' };
    }

    const containedArea = intersectionAreaM2(cutbackPoly, footprintUnion);
    if (containedArea < cutbackArea - Math.max(0.0005, cutbackArea * 0.002)) {
      return {
        ok: false,
        error:
          'Шахта слишком близко к внешней стене: стена вокруг шахты выйдет за пределы квартиры.',
      };
    }

    for (const existing of shafts) {
      const existingPoly = polygonOf(existing.vertices);
      if (intersectionAreaM2(shaftPoly, existingPoly) > AREA_TOLERANCE_M2) {
        return { ok: false, error: 'Шахты пересекаются. Разместите их отдельно друг от друга.' };
      }
      const existingCutback = shaftCutbackPolygon(existing.vertices, thickness);
      if (
        intersectionAreaM2(shaftPoly, existingCutback) > AREA_TOLERANCE_M2 ||
        intersectionAreaM2(cutbackPoly, existingPoly) > AREA_TOLERANCE_M2
      ) {
        return {
          ok: false,
          error: 'Стена новой шахты заходит в существующую шахту. Оставьте между ними зазор.',
        };
      }
    }

    for (const partition of partitions) {
      const strip = partitionStripPolygon(partition, thickness);
      if (
        intersectionAreaM2(strip, shaftPoly) > AREA_TOLERANCE_M2 ||
        intersectionAreaM2(strip, cutbackPoly) > AREA_TOLERANCE_M2
      ) {
        return { ok: false, error: 'Шахта пересекает перегородку. Сдвиньте шахту или перегородку.' };
      }
    }

    const existingCutbacks = shafts.map((shaft) =>
      shaftCutbackPolygon(shaft.vertices, thickness)
    );
    const roomsWithWall = rooms.filter(
      (room) => intersectionAreaM2(cutbackPoly, polygonOf(room.vertices, room.holes ?? [])) > AREA_TOLERANCE_M2
    );

    for (const room of roomsWithWall) {
      const roomPartitions = partitions
        .filter((partition) => partition.roomId === room.id)
        .map((partition) => partitionStripPolygon(partition, thickness));

      const result = differenceAll(polygonOf(room.vertices, room.holes ?? []), [
        ...existingCutbacks,
        cutbackPoly,
        ...roomPartitions,
      ]);

      if (result.length > 1) {
        return {
          ok: false,
          error: `Шахта разделяет комнату «${room.name}» на части. Уменьшите шахту или прижмите её к стене.`,
        };
      }
      if (multiAreaM2(result) < 0.1) {
        return {
          ok: false,
          error: `После выреза в комнате «${room.name}» почти не остаётся площади.`,
        };
      }
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'Не удалось проверить геометрию шахты.' };
  }
}

export function validatePartitionPlacement(
  rooms: RoomZone[],
  shafts: ShaftCutout[],
  partitions: FreePartition[],
  thickness: number,
  p1: Point2D,
  p2: Point2D
): AutoValidation {
  if (distance(p1, p2) < 50) {
    return { ok: false, error: 'Перегородка слишком короткая.' };
  }

  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const matchedRooms = rooms.filter((room) => isInsideRoom(mid, room));

  if (matchedRooms.length === 0) {
    return { ok: false, error: 'Перегородка должна находиться внутри комнаты.' };
  }
  if (matchedRooms.length > 1) {
    return { ok: false, error: 'Перегородка не может принадлежать сразу нескольким комнатам.' };
  }

  const room = matchedRooms[0];
  if (!isInsideRoom(p1, room) || !isInsideRoom(p2, room)) {
    return {
      ok: false,
      error: 'Перегородка должна целиком находиться внутри одной комнаты.',
    };
  }

  try {
    const strip = partitionStripPolygon({ p1, p2 }, thickness);
    if (strip.length === 0) {
      return { ok: false, error: 'Не удалось построить перегородку.' };
    }

    const roomPoly = polygonOf(room.vertices, room.holes ?? []);
    const stripArea = polygonAreaM2(strip);
    const insideArea = intersectionAreaM2(strip, roomPoly);
    if (stripArea > 0 && insideArea < stripArea * MIN_PARTITION_INSIDE_RATIO) {
      return {
        ok: false,
        error: 'Перегородка выходит за пределы комнаты. Нарисуйте её внутри помещения.',
      };
    }

    for (const other of rooms) {
      if (other.id === room.id) continue;
      if (
        intersectionAreaM2(strip, polygonOf(other.vertices, other.holes ?? [])) >
        AREA_TOLERANCE_M2
      ) {
        return {
          ok: false,
          error: 'Перегородка заходит в другую комнату. Она должна быть строго внутри одной комнаты.',
        };
      }
    }

    for (const shaft of shafts) {
      if (
        intersectionAreaM2(strip, polygonOf(shaft.vertices)) > AREA_TOLERANCE_M2 ||
        intersectionAreaM2(strip, shaftCutbackPolygon(shaft.vertices, thickness)) >
          AREA_TOLERANCE_M2
      ) {
        return {
          ok: false,
          error: 'Перегородка пересекает шахту. Сдвиньте перегородку.',
        };
      }
    }

    for (const partition of partitions) {
      if (
        intersectionAreaM2(strip, partitionStripPolygon(partition, thickness)) >
        AREA_TOLERANCE_M2
      ) {
        return {
          ok: false,
          error: 'Перегородки пересекаются. Разместите их отдельно.',
        };
      }
    }

    const roomCutters: Geom[] = [
      ...shafts.map((shaft) => shaftCutbackPolygon(shaft.vertices, thickness)),
      ...partitions
        .filter((partition) => partition.roomId === room.id)
        .map((partition) => partitionStripPolygon(partition, thickness)),
      strip,
    ];

    const result = differenceAll(roomPoly, roomCutters);
    if (result.length > 1) {
      return {
        ok: false,
        error:
          'Перегородка делит комнату на части. Нарисуйте две отдельные комнаты вместо одной.',
      };
    }

    const remainingArea = multiAreaM2(result);
    if (remainingArea < 0.1) {
      return {
        ok: false,
        error: 'Перегородка оставляет слишком мало площади. Уменьшите её.',
      };
    }

    return { ok: true, roomId: room.id };
  } catch {
    return { ok: false, error: 'Не удалось проверить геометрию перегородки.' };
  }
}

export function isAutoLayoutConnected(
  rooms: RoomZone[],
  shafts: ShaftCutout[],
  thickness: number
): boolean {
  if (rooms.length === 0) return true;
  try {
    const footprints = footprintUnionOf(rooms, thickness);
    if (footprints.length === 0) return false;
    const derived = differenceAll(
      footprints,
      shafts.map((shaft) => polygonOf(shaft.vertices))
    );
    return derived.length <= 1;
  } catch {
    return false;
  }
}

export function roomTouchesShafts(
  room: RoomZone,
  shafts: ShaftCutout[],
  thickness: number
): boolean {
  const roomPoly = polygonOf(room.vertices, room.holes ?? []);
  return shafts.some(
    (shaft) =>
      intersectionAreaM2(roomPoly, polygonOf(shaft.vertices)) > AREA_TOLERANCE_M2 ||
      intersectionAreaM2(roomPoly, shaftCutbackPolygon(shaft.vertices, thickness)) >
        AREA_TOLERANCE_M2
  );
}

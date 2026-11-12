import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping';
import type { Point2D, RoomZone, ApartmentBoundary } from '../../types';
import { calculatePolygonAreaM2, computeOutwardWallPolygon, distance, pointToSegmentDistance } from './math';

function pointsToRing(points: Point2D[]): Ring {
  const ring: Ring = points.map((p) => [p.x, p.y]);
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
}

function ringToPoints(ring: Ring): Point2D[] {
  const points: Point2D[] = [];
  const len = ring.length;
  const count = len > 1 && ring[0][0] === ring[len - 1][0] && ring[0][1] === ring[len - 1][1] ? len - 1 : len;
  for (let i = 0; i < count; i++) {
    points.push({ x: Math.round(ring[i][0]), y: Math.round(ring[i][1]) });
  }
  return points;
}

export function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface ClippedRoom {
  vertices: Point2D[];
  holes: Point2D[][];
}

export function clipRoomToApartment(
  roomVertices: Point2D[],
  apartmentVertices: Point2D[],
  apartmentHoles: Point2D[][] = []
): ClippedRoom[] {
  try {
    const polyRoom: Polygon = [pointsToRing(roomVertices)];
    const polyApt: Polygon = [
      pointsToRing(apartmentVertices),
      ...apartmentHoles.map((hole) => pointsToRing(hole)),
    ];
    const result = polygonClipping.intersection(polyRoom, polyApt);

    return result
      .filter((multiPoly) => multiPoly.length > 0)
      .map((multiPoly) => ({
        vertices: ringToPoints(multiPoly[0]),
        holes: multiPoly.slice(1).map((hole) => ringToPoints(hole)),
      }));
  } catch (err) {
    console.error('Ошибка ограничения комнаты квартирой:', err);
    return [{ vertices: roomVertices, holes: [] }];
  }
}

export function calculateRoomsOverlapAreaM2(
  roomAVertices: Point2D[],
  roomAHoles: Point2D[][],
  roomBVertices: Point2D[],
  roomBHoles: Point2D[][]
): number {
  try {
    const polyA: Polygon = [
      pointsToRing(roomAVertices),
      ...roomAHoles.map((hole) => pointsToRing(hole)),
    ];
    const polyB: Polygon = [
      pointsToRing(roomBVertices),
      ...roomBHoles.map((hole) => pointsToRing(hole)),
    ];
    const result = polygonClipping.intersection(polyA, polyB);

    let area = 0;
    for (const multiPoly of result) {
      multiPoly.forEach((ring, index) => {
        const ringArea = calculatePolygonAreaM2(ringToPoints(ring));
        area += index === 0 ? ringArea : -ringArea;
      });
    }
    return Math.max(0, area);
  } catch (err) {
    console.error('Ошибка проверки пересечения комнат:', err);
    return 0;
  }
}

export interface RoomPart {
  vertices: Point2D[];
  holes: Point2D[][];
}

interface LineCrossing {
  point: Point2D;
  edgeIndex: number;
  lineT: number;
}

const PARTITION_END_TOLERANCE_MM = 150;
const MIN_ROOM_PART_AREA_M2 = 0.01;

function distanceToOutline(point: Point2D, vertices: Point2D[]): number {
  let min = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const d = pointToSegmentDistance(point, vertices[i], vertices[(i + 1) % vertices.length]);
    if (d < min) min = d;
  }
  return min;
}

function dedupePoints(points: Point2D[]): Point2D[] {
  return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 0.01);
}

/**
 * Разрезает комнату по линии перегородки на две части.
 * Возвращает null, если перегородка не доходит до стен или линия не делит комнату.
 */
export function splitRoomByPartition(
  room: RoomZone,
  p1: Point2D,
  p2: Point2D
): RoomPart[] | null {
  const vertices = room.vertices;
  const n = vertices.length;
  if (n < 3) return null;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  if (length < 50) return null;

  // Перегородка должна упираться в стены комнаты: иначе это простенок, а не разделение
  if (
    distanceToOutline(p1, vertices) > PARTITION_END_TOLERANCE_MM ||
    distanceToOutline(p2, vertices) > PARTITION_END_TOLERANCE_MM
  ) {
    return null;
  }

  const ux = dx / length;
  const uy = dy / length;
  const crossings: LineCrossing[] = [];

  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = ux * ey - uy * ex;
    if (Math.abs(denom) < 1e-9) continue;

    const ax = p1.x - a.x;
    const ay = p1.y - a.y;
    const edgeT = (ux * ay - uy * ax) / denom;
    if (edgeT < -1e-6 || edgeT > 1 + 1e-6) continue;

    const t = Math.min(1, Math.max(0, edgeT));
    const point = {
      x: Math.round(a.x + t * ex),
      y: Math.round(a.y + t * ey),
    };

    if (!crossings.some((c) => distance(c.point, point) <= 1)) {
      crossings.push({
        point,
        edgeIndex: i,
        lineT: (point.x - p1.x) * ux + (point.y - p1.y) * uy,
      });
    }
  }

  if (crossings.length !== 2) return null;
  crossings.sort((a, b) => a.lineT - b.lineT);
  const [first, second] = crossings;
  if (first.edgeIndex === second.edgeIndex) return null;

  const cutMidpoint = {
    x: (first.point.x + second.point.x) / 2,
    y: (first.point.y + second.point.y) / 2,
  };
  if (!isPointInPolygon(cutMidpoint, vertices)) return null;

  const collectBoundary = (from: LineCrossing, to: LineCrossing): Point2D[] => {
    const result: Point2D[] = [{ ...from.point }];
    let i = (from.edgeIndex + 1) % n;
    for (let step = 0; step < n; step++) {
      result.push({ ...vertices[i] });
      if (i === to.edgeIndex) break;
      i = (i + 1) % n;
    }
    result.push({ ...to.point });
    return dedupePoints(result);
  };

  const partA = collectBoundary(first, second);
  const partB = collectBoundary(second, first);

  if (
    calculatePolygonAreaM2(partA) < MIN_ROOM_PART_AREA_M2 ||
    calculatePolygonAreaM2(partB) < MIN_ROOM_PART_AREA_M2
  ) {
    return null;
  }

  const sideOf = (point: Point2D) => (point.x - p1.x) * -uy + (point.y - p1.y) * ux;
  const sideOfPart = (part: Point2D[]): number => {
    for (const vertex of part) {
      const side = sideOf(vertex);
      if (Math.abs(side) > 1) return Math.sign(side);
    }
    return 0;
  };

  const parts: RoomPart[] = [
    { vertices: partA, holes: [] },
    { vertices: partB, holes: [] },
  ];
  const partSides = [sideOfPart(partA), sideOfPart(partB)];

  for (const hole of room.holes ?? []) {
    const holeSides = hole.map(sideOf);
    const hasPositive = holeSides.some((side) => side > 1);
    const hasNegative = holeSides.some((side) => side < -1);
    // Вырез, который пересекает линию разреза, корректно распределить нельзя
    if (hasPositive && hasNegative) return null;

    const holeSide = holeSides.find((side) => Math.abs(side) > 1);
    if (holeSide === undefined) continue;
    const sign = Math.sign(holeSide);
    const targetIndex = partSides[0] === sign ? 0 : partSides[1] === sign ? 1 : -1;
    if (targetIndex >= 0) parts[targetIndex].holes.push(hole);
  }

  return parts;
}

export interface BoundaryResult {
  vertices: Point2D[];
  holes: Point2D[][];
  success: boolean;
  error?: string;
}

export function unionApartmentBoundary(
  existingVertices: Point2D[],
  existingHoles: Point2D[][],
  newVertices: Point2D[]
): BoundaryResult {
  try {
    const poly1: Polygon = [
      pointsToRing(existingVertices),
      ...existingHoles.map((hole) => pointsToRing(hole)),
    ];
    const poly2: Polygon = [pointsToRing(newVertices)];

    // Касание ребром — валидный случай: intersection пустой, а union корректен.
    const result = polygonClipping.union(poly1, poly2);
    if (result.length !== 1 || result[0].length === 0) {
      return {
        vertices: existingVertices,
        holes: existingHoles,
        success: false,
        error: 'Области не примыкают друг к другу. Новый контур должен касаться или пересекать существующий.',
      };
    }

    const [outer, ...holes] = result[0];
    return {
      vertices: ringToPoints(outer),
      holes: holes.map((hole) => ringToPoints(hole)),
      success: true,
    };
  } catch (err) {
    console.error('Ошибка объединения контура квартиры:', err);
    return { vertices: existingVertices, holes: existingHoles, success: false, error: 'Критическая ошибка геометрии.' };
  }
}

/**
 * ЕДИНЫЙ ОБЪЕДИНЕННЫЙ МАССИВ СТЕН (CSG Union)
 * Стены квартиры и стены всех комнат объединяются в единое монолитное тело!
 */
export function computeUnifiedWallPolygons(
  apartment: ApartmentBoundary | null,
  rooms: RoomZone[],
  defaultWallThicknessMm: number
): Point2D[][] {
  try {
    const wallPolygonsToUnion: Polygon[] = [];

    // 1. Наружная стена квартиры
    if (apartment && apartment.vertices.length >= 3) {
      const extThickness = apartment.exteriorWallThicknessMm || 250;
      const outerApt = computeOutwardWallPolygon(apartment.vertices, extThickness);
      const outerRing = pointsToRing(outerApt);
      const innerRing = pointsToRing(apartment.vertices);

      wallPolygonsToUnion.push([outerRing, innerRing]);
    }

    // 2. Межкомнатные стены комнат
    for (const room of rooms) {
      if (room.vertices.length < 3) continue;
      const thickness = room.wallThicknessMm || defaultWallThicknessMm;
      const outerRoom = computeOutwardWallPolygon(room.vertices, thickness);

      const outerRing = pointsToRing(outerRoom);
      const innerRing = pointsToRing(room.vertices);

      wallPolygonsToUnion.push([outerRing, innerRing]);
    }

    if (wallPolygonsToUnion.length === 0) return [];

    // Объединяем геометрии стен
    let united = wallPolygonsToUnion[0];
    for (let i = 1; i < wallPolygonsToUnion.length; i++) {
      const nextGeom = wallPolygonsToUnion[i];
      const res = polygonClipping.union(united, nextGeom);
      if (res.length > 0) {
        united = res[0];
      }
    }

    const result: Point2D[][] = [];
    for (const ring of united) {
      if (ring.length >= 3) {
        result.push(ringToPoints(ring));
      }
    }
    return result;
  } catch (err) {
    console.error('Ошибка объединения стен:', err);
    return [];
  }
}

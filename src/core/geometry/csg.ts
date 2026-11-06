import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping';
import type { Point2D } from '../../types';

// Преобразование Point2D[] -> Ring [number, number][]
function pointsToRing(points: Point2D[]): Ring {
  const ring: Ring = points.map((p) => [p.x, p.y]);
  // Замыкаем кольцо, если не замкнуто
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
}

// Преобразование Ring -> Point2D[] (без дублирующей замыкающей точки)
function ringToPoints(ring: Ring): Point2D[] {
  const points: Point2D[] = [];
  const len = ring.length;
  // Исключаем последнюю точку, если она совпадает с первой
  const count = len > 1 && ring[0][0] === ring[len - 1][0] && ring[0][1] === ring[len - 1][1] ? len - 1 : len;
  for (let i = 0; i < count; i++) {
    points.push({ x: Math.round(ring[i][0]), y: Math.round(ring[i][1]) });
  }
  return points;
}

/**
 * Вырезает контур шахты/колонны из контура комнаты
 */
export function subtractShaftFromRoom(
  roomVertices: Point2D[],
  shaftVertices: Point2D[]
): Point2D[][] {
  try {
    const poly1: Polygon = [pointsToRing(roomVertices)];
    const poly2: Polygon = [pointsToRing(shaftVertices)];
    const result = polygonClipping.difference(poly1, poly2);

    const resultingPolygons: Point2D[][] = [];
    for (const multiPoly of result) {
      if (multiPoly.length > 0) {
        resultingPolygons.push(ringToPoints(multiPoly[0]));
      }
    }
    return resultingPolygons;
  } catch (err) {
    console.error('Ошибка булевой операции вычитания:', err);
    return [roomVertices];
  }
}

/**
 * Объединение двух контуров (комнат)
 */
export function unionRooms(polyA: Point2D[], polyB: Point2D[]): Point2D[][] {
  try {
    const pA: Polygon = [pointsToRing(polyA)];
    const pB: Polygon = [pointsToRing(polyB)];
    const result = polygonClipping.union(pA, pB);

    const resultingPolygons: Point2D[][] = [];
    for (const multiPoly of result) {
      if (multiPoly.length > 0) {
        resultingPolygons.push(ringToPoints(multiPoly[0]));
      }
    }
    return resultingPolygons;
  } catch (err) {
    console.error('Ошибка булевой операции объединения:', err);
    return [polyA];
  }
}

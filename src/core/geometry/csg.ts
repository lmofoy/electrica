import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping';
import type { Point2D, RoomZone } from '../../types';

// Преобразование Point2D[] -> Ring [number, number][]
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

// Преобразование Ring -> Point2D[]
function ringToPoints(ring: Ring): Point2D[] {
  const points: Point2D[] = [];
  const len = ring.length;
  const count = len > 1 && ring[0][0] === ring[len - 1][0] && ring[0][1] === ring[len - 1][1] ? len - 1 : len;
  for (let i = 0; i < count; i++) {
    points.push({ x: Math.round(ring[i][0]), y: Math.round(ring[i][1]) });
  }
  return points;
}

/**
 * Проверка попадания точки внутрь полигона (Ray casting algorithm)
 */
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

/**
 * Обрезка комнаты по границам квартиры (комната не может выходить за пределы квартиры)
 */
export function clipRoomToApartment(
  roomVertices: Point2D[],
  apartmentVertices: Point2D[]
): Point2D[][] {
  try {
    const polyRoom: Polygon = [pointsToRing(roomVertices)];
    const polyApt: Polygon = [pointsToRing(apartmentVertices)];
    const result = polygonClipping.intersection(polyRoom, polyApt);

    const resultingPolygons: Point2D[][] = [];
    for (const multiPoly of result) {
      if (multiPoly.length > 0) {
        resultingPolygons.push(ringToPoints(multiPoly[0]));
      }
    }
    return resultingPolygons;
  } catch (err) {
    console.error('Ошибка ограничения комнаты квартирой:', err);
    return [roomVertices];
  }
}

/**
 * Автоматическое вычитание пересечений: если новая комната перекрывает старые,
 * из старых комнат вычитается этот участок.
 */
export function resolveRoomOverlaps(
  existingRooms: RoomZone[],
  newRoomVertices: Point2D[]
): RoomZone[] {
  const polyNew: Polygon = [pointsToRing(newRoomVertices)];
  const updatedRooms: RoomZone[] = [];

  for (const room of existingRooms) {
    try {
      const polyOld: Polygon = [pointsToRing(room.vertices)];
      const diffResult = polygonClipping.difference(polyOld, polyNew);

      if (diffResult.length === 0) {
        // Старая комната была полностью поглощена новой — удаляем ее
        continue;
      }

      // Если старая комната осталась одним куском
      const mainPoly = ringToPoints(diffResult[0][0]);
      if (mainPoly.length >= 3) {
        updatedRooms.push({
          ...room,
          vertices: mainPoly,
        });
      }

      // Если комната разрезалась на несколько частей
      for (let i = 1; i < diffResult.length; i++) {
        const subPoly = ringToPoints(diffResult[i][0]);
        if (subPoly.length >= 3) {
          updatedRooms.push({
            ...room,
            id: `room-${Date.now()}-${i}`,
            name: `${room.name} (часть ${i + 1})`,
            vertices: subPoly,
          });
        }
      }
    } catch (err) {
      console.error('Ошибка вычитания пересечения комнат:', err);
      updatedRooms.push(room);
    }
  }

  return updatedRooms;
}

/**
 * Вырезает шахту из контура комнаты
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
    console.error('Ошибка вычитания шахты:', err);
    return [roomVertices];
  }
}

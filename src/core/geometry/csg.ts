import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping';
import type { Point2D, RoomZone, ApartmentBoundary } from '../../types';
import { computeOutwardWallPolygon } from './math';

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
        continue;
      }

      const mainPoly = ringToPoints(diffResult[0][0]);
      if (mainPoly.length >= 3) {
        updatedRooms.push({
          ...room,
          vertices: mainPoly,
        });
      }

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

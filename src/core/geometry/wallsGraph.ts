import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping';
import type { Point2D, Node2D, Wall, RoomZone, ApartmentBoundary } from '../../types';
import { distance, computeOutwardWallPolygon } from './math';

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

function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function isSegmentOnBoundary(p1: Point2D, p2: Point2D, boundary: Point2D[]): boolean {
  const n = boundary.length;
  for (let i = 0; i < n; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % n];
    const d1 = pointToSegmentDistance(p1, a, b);
    const d2 = pointToSegmentDistance(p2, a, b);
    if (d1 < 10 && d2 < 10) return true;
  }
  return false;
}

function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
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
 * Разбивает длинные ребра комнат в местах Т-образных стыков и примыканий
 * смежных комнат, чтобы общие участки стен имели строго совпадающие вершины.
 */
export function splitEdgesAtCollinearVertices(
  rooms: RoomZone[],
  apartment: ApartmentBoundary | null
): RoomZone[] {
  const allPoints: Point2D[] = [];
  if (apartment && apartment.vertices.length >= 3) {
    apartment.vertices.forEach((v) => allPoints.push(v));
  }
  rooms.forEach((r) => r.vertices.forEach((v) => allPoints.push(v)));

  return rooms.map((room) => {
    const newVertices: Point2D[] = [];
    const n = room.vertices.length;

    for (let i = 0; i < n; i++) {
      const p1 = room.vertices[i];
      const p2 = room.vertices[(i + 1) % n];
      newVertices.push(p1);

      const onSegment: Point2D[] = [];
      for (const pt of allPoints) {
        if (distance(pt, p1) < 10 || distance(pt, p2) < 10) continue;
        const d = pointToSegmentDistance(pt, p1, p2);
        if (d < 10) {
          onSegment.push(pt);
        }
      }

      if (onSegment.length > 0) {
        onSegment.sort((a, b) => distance(p1, a) - distance(p1, b));
        for (const pt of onSegment) {
          newVertices.push(pt);
        }
      }
    }

    return { ...room, vertices: newVertices };
  });
}

export type MonolithicWallPolygon = Point2D[][]; // [OuterRing, HoleRing1, HoleRing2, ...]

/**
 * Преобразует планировку в графовую модель (Nodes + Walls + Rooms):
 * Смежные перегородки между комнатами становятся ОДНОЙ общей стеной с одной толщиной.
 */
export function extractGraphFromPlan(
  apartment: ApartmentBoundary | null,
  rooms: RoomZone[],
  defaultWallThicknessMm: number,
  exteriorWallThicknessMm: number
): {
  nodes: Record<string, Node2D>;
  walls: Wall[];
  updatedRooms: RoomZone[];
  updatedApartment: ApartmentBoundary | null;
} {
  const nodes: Record<string, Node2D> = {};
  const nodesList: Node2D[] = [];

  // Найти или создать уникальный узел (слияние точек в радиусе 12 мм)
  const getOrCreateNode = (pt: Point2D): string => {
    for (const node of nodesList) {
      if (distance(pt, { x: node.x, y: node.y }) < 12) {
        return node.id;
      }
    }
    const id = `node-${nodesList.length + 1}`;
    const newNode: Node2D = { id, x: Math.round(pt.x), y: Math.round(pt.y) };
    nodesList.push(newNode);
    nodes[id] = newNode;
    return id;
  };

  // 1. Контур квартиры
  let updatedApartment: ApartmentBoundary | null = null;
  const aptEdgeKeys = new Set<string>();

  if (apartment && apartment.vertices.length >= 3) {
    const aptNodeIds: string[] = apartment.vertices.map((v) => getOrCreateNode(v));
    const aptVertices = aptNodeIds.map((id) => ({ x: nodes[id].x, y: nodes[id].y }));

    updatedApartment = {
      ...apartment,
      nodeIds: aptNodeIds,
      vertices: aptVertices,
      exteriorWallThicknessMm: apartment.exteriorWallThicknessMm || exteriorWallThicknessMm,
    };

    for (let i = 0; i < aptNodeIds.length; i++) {
      const a = aptNodeIds[i];
      const b = aptNodeIds[(i + 1) % aptNodeIds.length];
      const key = a < b ? `${a}--${b}` : `${b}--${a}`;
      aptEdgeKeys.add(key);
    }
  }

  // Сначала разбиваем ребра на стыках
  const refinedRooms = splitEdgesAtCollinearVertices(rooms, updatedApartment);

  // 2. Комнаты
  const updatedRooms: RoomZone[] = [];
  const edgeMap = new Map<string, { nodeA: string; nodeB: string; roomIds: string[] }>();

  for (const room of refinedRooms) {
    if (room.vertices.length < 3) continue;

    const roomNodeIds: string[] = room.vertices.map((v) => getOrCreateNode(v));
    const roomVertices = roomNodeIds.map((id) => ({ x: nodes[id].x, y: nodes[id].y }));

    updatedRooms.push({
      ...room,
      nodeIds: roomNodeIds,
      vertices: roomVertices,
      wallThicknessMm: room.wallThicknessMm || defaultWallThicknessMm,
    });

    for (let i = 0; i < roomNodeIds.length; i++) {
      const a = roomNodeIds[i];
      const b = roomNodeIds[(i + 1) % roomNodeIds.length];
      const key = a < b ? `${a}--${b}` : `${b}--${a}`;

      const existing = edgeMap.get(key);
      if (existing) {
        if (!existing.roomIds.includes(room.id)) {
          existing.roomIds.push(room.id);
        }
      } else {
        edgeMap.set(key, { nodeA: a, nodeB: b, roomIds: [room.id] });
      }
    }
  }

  // 3. Формирование единого списка стен (Wall):
  const walls: Wall[] = [];

  // Наружные стены
  if (updatedApartment) {
    const nIds = updatedApartment.nodeIds;
    for (let i = 0; i < nIds.length; i++) {
      const a = nIds[i];
      const b = nIds[(i + 1) % nIds.length];
      const key = a < b ? `${a}--${b}` : `${b}--${a}`;

      const existingRoomEdge = edgeMap.get(key);
      const roomIds = existingRoomEdge ? existingRoomEdge.roomIds : [];

      walls.push({
        id: `wall-ext-${i + 1}`,
        nodeAId: a,
        nodeBId: b,
        thicknessMm: updatedApartment.exteriorWallThicknessMm,
        isExterior: true,
        roomIds,
      });

      edgeMap.delete(key);
    }
  }

  // Межкомнатные перегородки (смежная перегородка существует строго в 1 экземпляре!)
  let wallIdx = 1;
  for (const [, edge] of edgeMap.entries()) {
    walls.push({
      id: `wall-int-${wallIdx++}`,
      nodeAId: edge.nodeA,
      nodeBId: edge.nodeB,
      thicknessMm: defaultWallThicknessMm,
      isExterior: false,
      roomIds: edge.roomIds,
    });
  }

  return {
    nodes,
    walls,
    updatedRooms,
    updatedApartment,
  };
}

/**
 * Генерирует единый монолитный массив стен (CSG Union всех стен):
 * - Наружные стены квартиры (250 мм наружу)
 * - Межкомнатные смежные стены (120 мм ровно посередине между комнатами, без задвоения)
 * - Перегородки комнат, выходящие в общий коридор (120 мм наружу от комнаты)
 * - Чистые полы комнат и коридоров остаются без штриховки!
 */
export function buildMonolithicWallMesh(
  apartment: ApartmentBoundary | null,
  rooms: RoomZone[],
  defaultWallThicknessMm: number,
  exteriorWallThicknessMm: number
): MonolithicWallPolygon[] {
  try {
    const wallStripsToUnion: Polygon[] = [];

    // 1. Наружные стены квартиры (полосы вокруг периметра квартиры наружу)
    if (apartment && apartment.vertices.length >= 3) {
      const extThickness = apartment.exteriorWallThicknessMm || exteriorWallThicknessMm;
      const outerApt = computeOutwardWallPolygon(apartment.vertices, extThickness);
      const n = apartment.vertices.length;

      for (let i = 0; i < n; i++) {
        const p1 = apartment.vertices[i];
        const p2 = apartment.vertices[(i + 1) % n];
        const o2 = outerApt[(i + 1) % n];
        const o1 = outerApt[i];
        wallStripsToUnion.push([pointsToRing([p1, p2, o2, o1])]);
      }
    }

    // 2. Межкомнатные стены и перегородки
    // Сначала разбиваем ребра на стыках смежных комнат
    const refinedRooms = splitEdgesAtCollinearVertices(rooms, apartment);

    // Собираем все уникальные внутренние ребра
    const interiorEdges = new Map<
      string,
      { p1: Point2D; p2: Point2D; roomIds: string[] }
    >();

    for (const room of refinedRooms) {
      if (room.vertices.length < 3) continue;
      const n = room.vertices.length;

      for (let i = 0; i < n; i++) {
        const p1 = room.vertices[i];
        const p2 = room.vertices[(i + 1) % n];

        // Пропускаем ребра, идущие вдоль наружной стены квартиры
        if (apartment && isSegmentOnBoundary(p1, p2, apartment.vertices)) {
          continue;
        }

        const k =
          p1.x < p2.x || (p1.x === p2.x && p1.y < p2.y)
            ? `${p1.x},${p1.y}--${p2.x},${p2.y}`
            : `${p2.x},${p2.y}--${p1.x},${p1.y}`;

        const existing = interiorEdges.get(k);
        if (existing) {
          if (!existing.roomIds.includes(room.id)) {
            existing.roomIds.push(room.id);
          }
        } else {
          interiorEdges.set(k, { p1, p2, roomIds: [room.id] });
        }
      }
    }

    // Строим геометрические полосы стен
    for (const [, edge] of interiorEdges.entries()) {
      const { p1, p2, roomIds } = edge;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 10) continue;

      const nx = -dy / len;
      const ny = dx / len;
      const T = defaultWallThicknessMm;

      if (roomIds.length >= 2) {
        // Смежная перегородка между двумя комнатами: центрирована на ребре (+/- T/2)
        // Ровно 120 мм, без задвоения!
        const half = T / 2;
        const quad: Point2D[] = [
          { x: p1.x - nx * half, y: p1.y - ny * half },
          { x: p2.x - nx * half, y: p2.y - ny * half },
          { x: p2.x + nx * half, y: p2.y + ny * half },
          { x: p1.x + nx * half, y: p1.y + ny * half },
        ];
        wallStripsToUnion.push([pointsToRing(quad)]);
      } else {
        // Перегородка одной комнаты, выходящая в коридор / свободную область квартиры:
        // Строим полосу толщиной T наружу от комнаты
        const ownerRoom = refinedRooms.find((r) => r.id === roomIds[0]);
        const mid: Point2D = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const testPt: Point2D = { x: mid.x + nx * 10, y: mid.y + ny * 10 };
        const isIn = ownerRoom ? isPointInPolygon(testPt, ownerRoom.vertices) : false;

        const sign = isIn ? -1 : 1;
        const quad: Point2D[] = [
          { x: p1.x, y: p1.y },
          { x: p2.x, y: p2.y },
          { x: p2.x + nx * sign * T, y: p2.y + ny * sign * T },
          { x: p1.x + nx * sign * T, y: p1.y + ny * sign * T },
        ];
        wallStripsToUnion.push([pointsToRing(quad)]);
      }
    }

    if (wallStripsToUnion.length === 0) return [];

    // 3. Выполняем БУЛЕВО СЛИЯНИЕ (Union) всех стен в единый монолит
    const united = polygonClipping.union(
      wallStripsToUnion[0],
      ...wallStripsToUnion.slice(1)
    );

    // Преобразуем MultiPolygon в типизированную структуру
    const finalMesh: MonolithicWallPolygon[] = [];
    for (const poly of united) {
      const polyRings: Point2D[][] = [];
      for (const ring of poly) {
        if (ring.length >= 3) {
          polyRings.push(ringToPoints(ring));
        }
      }
      if (polyRings.length > 0) {
        finalMesh.push(polyRings);
      }
    }

    return finalMesh;
  } catch (err) {
    console.error('Ошибка создания монолитного массива стен:', err);
    return [];
  }
}

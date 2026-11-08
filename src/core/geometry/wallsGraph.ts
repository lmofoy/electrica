import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping';
import type {
  Point2D,
  Node2D,
  Wall,
  RoomZone,
  ApartmentBoundary,
  Opening,
  FreePartition,
} from '../../types';
import { distance, isPolygonClockwise, lineIntersection, calculatePolygonAreaM2 } from './math';

export function pointsToRing(points: Point2D[]): Ring {
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
 * Разбивает длинные ребра комнат и контура квартиры в местах Т-образных стыков,
 * чтобы общие участки стен имели строго совпадающие вершины.
 */
export function splitEdgesAtCollinearVertices(
  rooms: RoomZone[],
  apartment: ApartmentBoundary | null
): { refinedRooms: RoomZone[]; refinedApartment: ApartmentBoundary | null } {
  const allPoints: Point2D[] = [];
  if (apartment && apartment.vertices.length >= 3) {
    apartment.vertices.forEach((v) => allPoints.push(v));
  }
  rooms.forEach((r) => r.vertices.forEach((v) => allPoints.push(v)));

  const splitVertices = (vertices: Point2D[]): Point2D[] => {
    const newVertices: Point2D[] = [];
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
      const p1 = vertices[i];
      const p2 = vertices[(i + 1) % n];
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
    return newVertices;
  };

  const refinedRooms = rooms.map((room) => ({
    ...room,
    vertices: splitVertices(room.vertices),
  }));

  const refinedApartment = apartment
    ? { ...apartment, vertices: splitVertices(apartment.vertices) }
    : null;

  return { refinedRooms, refinedApartment };
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
  const { refinedRooms, refinedApartment: finalApartment } = splitEdgesAtCollinearVertices(rooms, updatedApartment);

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
  if (finalApartment) {
    const nIds = finalApartment.nodeIds;
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
        thicknessMm: finalApartment.exteriorWallThicknessMm,
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
    updatedApartment: finalApartment,
  };
}

interface PerimeterEdge {
  p1: Point2D;
  p2: Point2D;
  nx: number;
  ny: number;
}

/**
 * Полосы наружных стен без «удлинения» граней.
 * Удлинение каждой грани на полную толщину давало диагональные «пики» в углах:
 * конец полосы уходил внутрь комнаты, а внешняя точка оставалась на miter-стыке.
 * Здесь полосы стыкуются точно, а выпуклые углы закрываются отдельным заполнителем.
 */
export function buildPerimeterWallStrips(vertices: Point2D[], thickness: number): Polygon[] {
  const n = vertices.length;
  if (n < 3) return [];

  const isCW = isPolygonClockwise(vertices);
  const edges: PerimeterEdge[] = [];

  for (let i = 0; i < n; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return [];

    edges.push({
      p1,
      p2,
      nx: isCW ? -dy / len : dy / len,
      ny: isCW ? dx / len : -dx / len,
    });
  }

  const strips: Polygon[] = [];

  // 1. Прямоугольная полоса на каждую грань, без удлинения
  for (const e of edges) {
    const a1 = { x: e.p1.x + e.nx * thickness, y: e.p1.y + e.ny * thickness };
    const a2 = { x: e.p2.x + e.nx * thickness, y: e.p2.y + e.ny * thickness };
    strips.push([pointsToRing([e.p1, e.p2, a2, a1])]);
  }

  // 2. Заполнитель только для выпуклых (внешних) углов.
  //    Во входящих углах полосы и так перекрываются, а miter-точка лежит
  //    с неверной стороны и превращает угол в самопересекающийся «бант».
  for (let i = 0; i < n; i++) {
    const p = vertices[i];
    const prev = edges[(i - 1 + n) % n];
    const curr = edges[i];

    const v1x = p.x - prev.p1.x;
    const v1y = p.y - prev.p1.y;
    const v2x = curr.p2.x - p.x;
    const v2y = curr.p2.y - p.y;
    const cross = v1x * v2y - v1y * v2x;
    const isConvex = isCW ? cross < 0 : cross > 0;
    if (!isConvex) continue;

    const aPrev = { x: p.x + prev.nx * thickness, y: p.y + prev.ny * thickness };
    const aCurr = { x: p.x + curr.nx * thickness, y: p.y + curr.ny * thickness };
    const miter = lineIntersection(
      { x: prev.p1.x + prev.nx * thickness, y: prev.p1.y + prev.ny * thickness },
      { x: prev.p2.x + prev.nx * thickness, y: prev.p2.y + prev.ny * thickness },
      { x: curr.p1.x + curr.nx * thickness, y: curr.p1.y + curr.ny * thickness },
      { x: curr.p2.x + curr.nx * thickness, y: curr.p2.y + curr.ny * thickness }
    );

    if (miter && distance(p, miter) <= thickness * 3) {
      strips.push([pointsToRing([p, aPrev, miter, aCurr])]);
    } else {
      strips.push([pointsToRing([p, aPrev, aCurr])]);
    }
  }

  return strips;
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
  openings: Opening[],
  freePartitions: FreePartition[],
  defaultWallThicknessMm: number,
  exteriorWallThicknessMm: number
): MonolithicWallPolygon[] {
  try {
    const wallStripsToUnion: Polygon[] = [];

    // 1. Наружные стены квартиры (толщина наружу от чистового контура)
    if (apartment && apartment.vertices.length >= 3) {
      const extThickness = apartment.exteriorWallThicknessMm || exteriorWallThicknessMm;
      wallStripsToUnion.push(...buildPerimeterWallStrips(apartment.vertices, extThickness));
    }

    // 2. Свободные перегородки
    for (const part of freePartitions) {
      const dx = part.p2.x - part.p1.x;
      const dy = part.p2.y - part.p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 10) continue;

      const nx = -dy / len;
      const ny = dx / len;
      const half = part.thicknessMm / 2;
      const ux = dx / len;
      const uy = dy / len;
      // Небольшое продление концов закрывает зазоры в стыках со стенами
      const endExtension = half;
      const q1 = {
        x: part.p1.x - ux * endExtension - nx * half,
        y: part.p1.y - uy * endExtension - ny * half,
      };
      const q2 = {
        x: part.p2.x + ux * endExtension - nx * half,
        y: part.p2.y + uy * endExtension - ny * half,
      };
      const q3 = {
        x: part.p2.x + ux * endExtension + nx * half,
        y: part.p2.y + uy * endExtension + ny * half,
      };
      const q4 = {
        x: part.p1.x - ux * endExtension + nx * half,
        y: part.p1.y - uy * endExtension + ny * half,
      };
      wallStripsToUnion.push([pointsToRing([q1, q2, q3, q4])]);
    }

    // 3. Межкомнатные стены и перегородки
    // Сначала разбиваем ребра на стыках смежных комнат
    const { refinedRooms, refinedApartment: finalApartment } = splitEdgesAtCollinearVertices(rooms, apartment);
    const currentApartment = finalApartment || apartment;

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
        if (currentApartment && isSegmentOnBoundary(p1, p2, currentApartment.vertices)) {
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

      const ux = dx / len;
      const uy = dy / len;
      const nx = -dy / len;
      const ny = dx / len;
      const T = defaultWallThicknessMm;

      // Продлеваем полосу за узел, иначе на углах остаются квадратные дыры
      const isShared = roomIds.length >= 2;
      const endExtension = isShared ? T / 2 : T;
      const a: Point2D = { x: p1.x - ux * endExtension, y: p1.y - uy * endExtension };
      const b: Point2D = { x: p2.x + ux * endExtension, y: p2.y + uy * endExtension };

      if (isShared) {
        // Смежная перегородка между двумя комнатами: центрирована на ребре (+/- T/2)
        const half = T / 2;
        const quad: Point2D[] = [
          { x: a.x - nx * half, y: a.y - ny * half },
          { x: b.x - nx * half, y: b.y - ny * half },
          { x: b.x + nx * half, y: b.y + ny * half },
          { x: a.x + nx * half, y: a.y + ny * half },
        ];
        wallStripsToUnion.push([pointsToRing(quad)]);
      } else {
        // Перегородка одной комнаты, выходящая в коридор: строим полосу T наружу
        const ownerRoom = refinedRooms.find((r) => r.id === roomIds[0]);
        const mid: Point2D = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const testPt: Point2D = { x: mid.x + nx * 10, y: mid.y + ny * 10 };
        const isIn = ownerRoom ? isPointInPolygon(testPt, ownerRoom.vertices) : false;

        const sign = isIn ? -1 : 1;
        const quad: Point2D[] = [
          { x: a.x, y: a.y },
          { x: b.x, y: b.y },
          { x: b.x + nx * sign * T, y: b.y + ny * sign * T },
          { x: a.x + nx * sign * T, y: a.y + ny * sign * T },
        ];
        wallStripsToUnion.push([pointsToRing(quad)]);
      }
    }

    if (wallStripsToUnion.length === 0) return [];

    // 3. Выполняем БУЛЕВО СЛИЯНИЕ (Union) всех полос в единый черновой массив
    const rawUnion = polygonClipping.union(
      wallStripsToUnion[0],
      ...wallStripsToUnion.slice(1)
    );

    // 4. ВЫЧИТАЕМ ПРОЕМЫ (Двери и Окна).
    //    Полы комнат НЕ вычитаем: общая стена двух комнат лежит ровно на их
    //    границе, и вычитание полов удаляло её целиком.
    const openingPolygons: Polygon[] = [];
    for (const op of openings) {
      const dx = op.p2.x - op.p1.x;
      const dy = op.p2.y - op.p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;

      const nx = -dy / len;
      const ny = dx / len;
      // Проем задан точками на чистовой грани: у наружных стен ось смещена наружу,
      // поэтому режем с запасом в обе стороны. Лишнее попадёт в пустоту, а стена
      // будет прорезана на всю толщину. Раньше резали на 1000 мм и задевали соседей.
      const halfDepth = op.wallThicknessMm + 50;

      openingPolygons.push([pointsToRing([
        { x: op.p1.x - nx * halfDepth, y: op.p1.y - ny * halfDepth },
        { x: op.p2.x - nx * halfDepth, y: op.p2.y - ny * halfDepth },
        { x: op.p2.x + nx * halfDepth, y: op.p2.y + ny * halfDepth },
        { x: op.p1.x + nx * halfDepth, y: op.p1.y + ny * halfDepth },
      ])]);
    }

    const united = polygonClipping.difference(rawUnion, ...openingPolygons);

    // Преобразуем MultiPolygon в типизированную структуру...
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

function sumPolygonArea(polygons: Polygon[]): number {
  let area = 0;
  for (const poly of polygons) {
    poly.forEach((ring, index) => {
      const ringArea = calculatePolygonAreaM2(ringToPoints(ring));
      area += index === 0 ? ringArea : -ringArea;
    });
  }
  return Math.max(0, area);
}

/**
 * Площадь квартиры, закрытая комнатами или стенами.
 * Стены считаются «заполнением»: иначе при полностью расставленных комнатах
 * процент покрытия занижается на площадь перегородок.
 */
export function calculateCoveredAreaM2(
  apartment: ApartmentBoundary | null,
  rooms: RoomZone[],
  openings: Opening[],
  freePartitions: FreePartition[],
  defaultWallThicknessMm: number,
  exteriorWallThicknessMm: number
): number {
  if (!apartment || apartment.vertices.length < 3) return 0;

  try {
    const apartmentPoly: Polygon = [
      pointsToRing(apartment.vertices),
      ...(apartment.holes ?? []).map((hole) => pointsToRing(hole)),
    ];

    const clippedParts: Polygon[] = [];
    const clipToApartment = (part: Polygon) => {
      try {
        clippedParts.push(...polygonClipping.intersection(apartmentPoly, part));
      } catch {
        // Вырожденный/касательный контур (например, наружная стена вне квартиры)
      }
    };

    for (const room of rooms) {
      if (room.vertices.length < 3) continue;
      clipToApartment([
        pointsToRing(room.vertices),
        ...(room.holes ?? []).map((hole) => pointsToRing(hole)),
      ]);
    }

    for (const meshPoly of buildMonolithicWallMesh(
      apartment,
      rooms,
      openings,
      freePartitions,
      defaultWallThicknessMm,
      exteriorWallThicknessMm
    )) {
      clipToApartment(meshPoly.map((ring) => pointsToRing(ring)) as Polygon);
    }

    if (clippedParts.length === 0) return 0;

    const united = polygonClipping.union(clippedParts[0], ...clippedParts.slice(1));
    return sumPolygonArea(united);
  } catch (err) {
    console.error('Ошибка расчёта покрытия площади:', err);
    return 0;
  }
}

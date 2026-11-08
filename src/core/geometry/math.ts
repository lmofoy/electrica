import type { Point2D } from '../../types';

// Расстояние между двумя точками в мм
export function distance(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

// Угол в градусах (-180..180) от p1 к p2
export function angleDeg(p1: Point2D, p2: Point2D): number {
  const rad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  return (rad * 180) / Math.PI;
}

// Нормализованный угол (0..360)
export function normalizeAngle360(deg: number): number {
  let angle = deg % 360;
  if (angle < 0) angle += 360;
  return angle;
}

// Полярные координаты -> декартова точка
export function polarToPoint(origin: Point2D, len: number, deg: number): Point2D {
  const rad = (deg * Math.PI) / 180;
  return {
    x: Math.round(origin.x + len * Math.cos(rad)),
    y: Math.round(origin.y + len * Math.sin(rad)),
  };
}

// Привязка угла к ортогональным осям (0, 90, 180, 270) и диагоналям 45°
export function snapAngle(deg: number, thresholdDeg: number = 6): number {
  const norm = normalizeAngle360(deg);
  const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315, 360];

  for (const target of snapAngles) {
    if (Math.abs(norm - target) <= thresholdDeg) {
      return target === 360 ? 0 : target;
    }
  }
  return deg;
}

// Привязка к координатной сетке (кратно 100 мм по умолчанию)
export function snapToGrid(point: Point2D, gridSizeMm: number = 100): Point2D {
  return {
    x: Math.round(point.x / gridSizeMm) * gridSizeMm,
    y: Math.round(point.y / gridSizeMm) * gridSizeMm,
  };
}

// Вычисление площади многоугольника (Формула Гаусса) в м²
export function calculatePolygonAreaM2(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area / 2) / 1_000_000;
}

// Площадь многоугольника с вычетами (шахты, колонны)
export function calculateNetAreaM2(vertices: Point2D[], holes: Point2D[][] = []): number {
  const holesArea = holes.reduce((sum, hole) => sum + calculatePolygonAreaM2(hole), 0);
  return Math.max(0, calculatePolygonAreaM2(vertices) - holesArea);
}

// Вычисление геометрического центра многоугольника
export function calculateCentroid(vertices: Point2D[]): Point2D {
  if (vertices.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const v of vertices) {
    x += v.x;
    y += v.y;
  }
  return {
    x: Math.round(x / vertices.length),
    y: Math.round(y / vertices.length),
  };
}

// Проекция точки P на отрезок AB (поиск ближайшей точки на стене)
export function projectPointOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { point: Point2D; distance: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { point: { ...a }, distance: distance(p, a), t: 0 };
  }

  // Параметр проекции t от 0 до 1
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj: Point2D = {
    x: Math.round(a.x + t * dx),
    y: Math.round(a.y + t * dy),
  };

  return { point: proj, distance: distance(p, proj), t };
}

// Пересечение двух бесконечных прямых AB и CD
export function lineIntersection(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D
): Point2D | null {
  const denom = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denom) < 1e-6) return null; // прямые параллельны

  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denom;
  return {
    x: Math.round(a.x + t * (b.x - a.x)),
    y: Math.round(a.y + t * (b.y - a.y)),
  };
}

// Определение ориентации полигона: по часовой стрелке (CW) или против (CCW)
export function isPolygonClockwise(vertices: Point2D[]): boolean {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    sum += (v2.x - v1.x) * (v2.y + v1.y);
  }
  return sum > 0;
}

/**
 * Построение внешнего контура стены наружу от внутреннего контура
 * Сдвигает каждую грань на wallThicknessMm по наружной нормали и находит пересечения углов
 */
export function computeOutwardWallPolygon(
  vertices: Point2D[],
  thicknessMm: number
): Point2D[] {
  const n = vertices.length;
  if (n < 3) return vertices;

  const isCW = isPolygonClockwise(vertices);
  const offsetEdges: { p1: Point2D; p2: Point2D }[] = [];

  for (let i = 0; i < n; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % n];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;

    // Вектор наружной нормали в зависимости от направления обхода
    const nx = isCW ? -dy / len : dy / len;
    const ny = isCW ? dx / len : -dx / len;

    offsetEdges.push({
      p1: { x: p1.x + nx * thicknessMm, y: p1.y + ny * thicknessMm },
      p2: { x: p2.x + nx * thicknessMm, y: p2.y + ny * thicknessMm },
    });
  }

  const outerVertices: Point2D[] = [];
  const edgeCount = offsetEdges.length;

  for (let i = 0; i < edgeCount; i++) {
    const prevEdge = offsetEdges[(i - 1 + edgeCount) % edgeCount];
    const currEdge = offsetEdges[i];

    const inter = lineIntersection(prevEdge.p1, prevEdge.p2, currEdge.p1, currEdge.p2);
    if (inter) {
      outerVertices.push(inter);
    } else {
      outerVertices.push(currEdge.p1);
    }
  }

  return outerVertices;
}

export function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
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

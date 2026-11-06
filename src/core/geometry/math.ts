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

// Полярные координаты -> декартовы точка
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

// Привязка к координатной сетке (например, кратно 50 или 100 мм)
export function snapToGrid(point: Point2D, gridSizeMm: number = 50): Point2D {
  return {
    x: Math.round(point.x / gridSizeMm) * gridSizeMm,
    y: Math.round(point.y / gridSizeMm) * gridSizeMm,
  };
}

// Вычисление площади многоугольника (Формула Гаусса / Shoelace formula) в м²
export function calculatePolygonAreaM2(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area / 2) / 1_000_000; // перевод из мм² в м²
}

// Вычисление геометрического центра многоугольника для метки комнаты
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

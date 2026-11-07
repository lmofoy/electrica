import type { Point2D, SnapResult, GuideLine, ApartmentBoundary, RoomZone } from '../../types';
import {
  distance,
  angleDeg,
  polarToPoint,
  projectPointOnSegment,
  lineIntersection,
} from './math';
import { computeUnifiedWallPolygons } from './csg';

interface AdvancedSnapContext {
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  draftVertices: Point2D[];
  zoom: number;
  defaultWallThicknessMm: number;
}

interface WallSegment {
  p1: Point2D;
  p2: Point2D;
}

interface NodeTarget {
  point: Point2D;
  label: string;
}

/**
 * Иерархическая система магнитных привязок и направляющих CAD:
 * 
 * Уровень 1: Узлы (Endpoints / Intersections) — высший приоритет
 * Уровень 2: Polar Tracking (0°, 45°, 90°, 135°...) + Alignment Guides (лучи X/Y от узлов поля)
 * Уровень 3: Проекция на ребро стены (Edge Snap)
 * Уровень 4: Фоновый шаг 100 мм (gridSnap) — если ничего не найдено
 */
export function findBestSnapAdvanced(
  rawTarget: Point2D,
  context: AdvancedSnapContext
): SnapResult {
  const { apartment, rooms, draftVertices, zoom, defaultWallThicknessMm } = context;

  // Экранные радиусы притяжения в мм
  const nodeRadiusMm = 22 / zoom;    // 22 пикселя для узлов
  const alignRadiusMm = 14 / zoom;   // 14 пикселей для лучей выравнивания X/Y
  const edgeRadiusMm = 15 / zoom;    // 15 пикселей для ребер стен
  const polarAngleTolerance = 4.5;   // 4.5 градуса для лучей полярного отслеживания

  // =============================================================
  // Сбор всех узлов и сегментов стен со сцены
  // =============================================================
  const allNodes: NodeTarget[] = [];
  const allSegments: WallSegment[] = [];

  // 1. Точки текущего чертежа
  draftVertices.forEach((v, idx) => {
    allNodes.push({ point: v, label: idx === 0 ? 'Старт' : 'Узел' });
  });

  // 2. Внутренние углы комнат и квартиры
  if (apartment && apartment.vertices.length >= 3) {
    for (let i = 0; i < apartment.vertices.length; i++) {
      allNodes.push({ point: apartment.vertices[i], label: 'Угол кв.' });
    }
  }

  for (const room of rooms) {
    for (let i = 0; i < room.vertices.length; i++) {
      allNodes.push({ point: room.vertices[i], label: 'Угол' });
    }
  }

  // 3. Единый массив стен (внешние грани, внутренние грани, стыки)
  const unifiedWalls = computeUnifiedWallPolygons(apartment, rooms, defaultWallThicknessMm);
  for (const ring of unifiedWalls) {
    const len = ring.length;
    for (let i = 0; i < len; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % len];
      allNodes.push({ point: p1, label: 'Узел стены' });
      allSegments.push({ p1, p2 });
    }
  }

  // Базовая точка (предыдущая точка клика)
  const basePoint = draftVertices.length > 0
    ? draftVertices[draftVertices.length - 1]
    : null;

  // =============================================================
  // УРОВЕНЬ 1: УЗЛЫ (Endpoints / Intersections) — САМЫЙ ВЫСОКИЙ ПРИОРИТЕТ
  // =============================================================
  let closestNode: { point: Point2D; dist: number; label: string } | null = null;
  for (const node of allNodes) {
    const d = distance(rawTarget, node.point);
    if (d < nodeRadiusMm && (!closestNode || d < closestNode.dist)) {
      closestNode = { point: node.point, dist: d, label: node.label };
    }
  }

  if (closestNode) {
    return {
      point: { ...closestNode.point },
      isSnapped: true,
      snapType: 'vertex',
      guideLines: [],
      label: closestNode.label,
    };
  }

  // =============================================================
  // УРОВЕНЬ 2: POLAR TRACKING (0°, 45°, 90°...) + ALIGNMENT GUIDES (X/Y)
  // =============================================================

  // А) Поиск лучей выравнивания X или Y от всех узлов сцены
  // Исключаем базовую точку из списка поиска, чтобы не строить луч к самому себе
  const fieldNodes = allNodes.filter(
    (n) => !basePoint || distance(n.point, basePoint) > 10
  );

  let bestAlignXNode: { point: Point2D; distY: number; diffX: number } | null = null;
  let bestAlignYNode: { point: Point2D; distX: number; diffY: number } | null = null;

  for (const node of fieldNodes) {
    const diffX = Math.abs(rawTarget.x - node.point.x);
    if (diffX < alignRadiusMm) {
      const distY = Math.abs(rawTarget.y - node.point.y);
      if (!bestAlignXNode || diffX < bestAlignXNode.diffX || (diffX === bestAlignXNode.diffX && distY < bestAlignXNode.distY)) {
        bestAlignXNode = { point: node.point, distY, diffX };
      }
    }

    const diffY = Math.abs(rawTarget.y - node.point.y);
    if (diffY < alignRadiusMm) {
      const distX = Math.abs(rawTarget.x - node.point.x);
      if (!bestAlignYNode || diffY < bestAlignYNode.diffY || (diffY === bestAlignYNode.diffY && distX < bestAlignYNode.distX)) {
        bestAlignYNode = { point: node.point, distX, diffY };
      }
    }
  }

  // Б) Проверка Polar Tracking относительно базовой точки (0°, 45°, 90°, 135°...)
  let polarTargetAngle: number | null = null;
  if (basePoint) {
    const rawDeg = angleDeg(basePoint, rawTarget);
    let normDeg = rawDeg % 360;
    if (normDeg < 0) normDeg += 360;

    const testAngles = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const target of testAngles) {
      let diff = Math.abs(normDeg - target);
      if (diff > 180) diff = 360 - diff;
      if (diff <= polarAngleTolerance) {
        polarTargetAngle = target;
        break;
      }
    }
  }

  // -------------------------------------------------------------
  // Комбинация 2.1: Polar Ray + Alignment Ray (Пересечение угла и опорной линии)
  // -------------------------------------------------------------
  if (basePoint && polarTargetAngle !== null) {
    // Горизонтальный луч (0° или 180°)
    if (polarTargetAngle === 0 || polarTargetAngle === 180) {
      const snapY = basePoint.y;
      if (bestAlignXNode) {
        // Пересечение горизонтали от базовой точки и вертикали от узла BestAlignX!
        const snapX = bestAlignXNode.point.x;
        const snapPt: Point2D = { x: snapX, y: snapY };
        const guideLines: GuideLine[] = [
          { from: basePoint, to: snapPt, type: 'polar', label: `${polarTargetAngle}°` },
          { from: bestAlignXNode.point, to: snapPt, type: 'align_x', sourceNode: bestAlignXNode.point, label: 'Узел' },
        ];
        return {
          point: snapPt,
          isSnapped: true,
          snapType: 'polar',
          guideLines,
          label: `${polarTargetAngle}° + Выравнивание`,
        };
      }
    }

    // Вертикальный луч (90° или 270°)
    if (polarTargetAngle === 90 || polarTargetAngle === 270) {
      const snapX = basePoint.x;
      if (bestAlignYNode) {
        // Пересечение вертикали от базовой точки и горизонтали от узла BestAlignY!
        const snapY = bestAlignYNode.point.y;
        const snapPt: Point2D = { x: snapX, y: snapY };
        const guideLines: GuideLine[] = [
          { from: basePoint, to: snapPt, type: 'polar', label: `${polarTargetAngle}°` },
          { from: bestAlignYNode.point, to: snapPt, type: 'align_y', sourceNode: bestAlignYNode.point, label: 'Узел' },
        ];
        return {
          point: snapPt,
          isSnapped: true,
          snapType: 'polar',
          guideLines,
          label: `${polarTargetAngle}° + Выравнивание`,
        };
      }
    }

    // Диагональные лучи (45°, 135°, 225°, 315°) с выравниванием по X или Y
    if (polarTargetAngle % 90 === 45) {
      if (bestAlignXNode) {
        const rad = (polarTargetAngle * Math.PI) / 180;
        const dx = bestAlignXNode.point.x - basePoint.x;
        const distDiag = dx / Math.cos(rad);
        if (distDiag > 0) {
          const snapPt = polarToPoint(basePoint, distDiag, polarTargetAngle);
          if (Math.abs(snapPt.y - rawTarget.y) < alignRadiusMm * 1.5) {
            return {
              point: snapPt,
              isSnapped: true,
              snapType: 'polar',
              guideLines: [
                { from: basePoint, to: snapPt, type: 'polar', label: `${polarTargetAngle}°` },
                { from: bestAlignXNode.point, to: snapPt, type: 'align_x', sourceNode: bestAlignXNode.point },
              ],
              label: `${polarTargetAngle}° + Выравнивание`,
            };
          }
        }
      }
    }

    // Проверка пересечения Polar Ray с сегментом стены
    const farPolarPt = polarToPoint(basePoint, 50000, polarTargetAngle);
    let bestWallInter: { point: Point2D; dist: number } | null = null;

    for (const seg of allSegments) {
      const inter = lineIntersection(basePoint, farPolarPt, seg.p1, seg.p2);
      if (inter) {
        const proj = projectPointOnSegment(inter, seg.p1, seg.p2);
        if (proj.distance < 5) {
          const d = distance(rawTarget, inter);
          if (d < edgeRadiusMm * 1.8 && (!bestWallInter || d < bestWallInter.dist)) {
            bestWallInter = { point: inter, dist: d };
          }
        }
      }
    }

    if (bestWallInter) {
      return {
        point: bestWallInter.point,
        isSnapped: true,
        snapType: 'polar',
        guideLines: [
          { from: basePoint, to: bestWallInter.point, type: 'polar', label: `${polarTargetAngle}°` },
        ],
        label: `${polarTargetAngle}° + Стена`,
      };
    }
  }

  // -------------------------------------------------------------
  // Комбинация 2.2: Пересечение двух лучей выравнивания (X от одного узла + Y от другого)
  // -------------------------------------------------------------
  if (bestAlignXNode && bestAlignYNode) {
    const snapPt: Point2D = {
      x: bestAlignXNode.point.x,
      y: bestAlignYNode.point.y,
    };
    const guideLines: GuideLine[] = [
      { from: bestAlignXNode.point, to: snapPt, type: 'align_x', sourceNode: bestAlignXNode.point },
      { from: bestAlignYNode.point, to: snapPt, type: 'align_y', sourceNode: bestAlignYNode.point },
    ];
    return {
      point: snapPt,
      isSnapped: true,
      snapType: 'alignment',
      guideLines,
      label: 'Выравнивание X + Y',
    };
  }

  // -------------------------------------------------------------
  // Комбинация 2.3: Одиночный луч выравнивания по X от узла поля
  // -------------------------------------------------------------
  if (bestAlignXNode) {
    const snapX = bestAlignXNode.point.x;
    let snapY = rawTarget.y;

    if (basePoint && (polarTargetAngle === 0 || polarTargetAngle === 180)) {
      snapY = basePoint.y;
    } else {
      // Фоновое округление по Y к 100 мм
      snapY = Math.round(snapY / 100) * 100;
    }

    const snapPt: Point2D = { x: snapX, y: snapY };
    return {
      point: snapPt,
      isSnapped: true,
      snapType: 'alignment',
      guideLines: [
        { from: bestAlignXNode.point, to: snapPt, type: 'align_x', sourceNode: bestAlignXNode.point },
      ],
      label: 'Выравнивание X',
    };
  }

  // -------------------------------------------------------------
  // Комбинация 2.4: Одиночный луч выравнивания по Y от узла поля
  // -------------------------------------------------------------
  if (bestAlignYNode) {
    let snapX = rawTarget.x;
    const snapY = bestAlignYNode.point.y;

    if (basePoint && (polarTargetAngle === 90 || polarTargetAngle === 270)) {
      snapX = basePoint.x;
    } else {
      snapX = Math.round(snapX / 100) * 100;
    }

    const snapPt: Point2D = { x: snapX, y: snapY };
    return {
      point: snapPt,
      isSnapped: true,
      snapType: 'alignment',
      guideLines: [
        { from: bestAlignYNode.point, to: snapPt, type: 'align_y', sourceNode: bestAlignYNode.point },
      ],
      label: 'Выравнивание Y',
    };
  }

  // -------------------------------------------------------------
  // Комбинация 2.5: Одиночный Polar Tracking от базовой точки (угол 0, 45, 90...)
  // -------------------------------------------------------------
  if (basePoint && polarTargetAngle !== null) {
    const rawDist = distance(basePoint, rawTarget);
    const steppedDist = Math.max(100, Math.round(rawDist / 100) * 100);
    const snapPt = polarToPoint(basePoint, steppedDist, polarTargetAngle);

    return {
      point: snapPt,
      isSnapped: true,
      snapType: 'polar',
      guideLines: [
        { from: basePoint, to: snapPt, type: 'polar', label: `${polarTargetAngle}°` },
      ],
      label: `${polarTargetAngle}°`,
    };
  }

  // =============================================================
  // УРОВЕНЬ 3: ПРОЕКЦИЯ НА РЕБРО (Edge / Line Snap)
  // =============================================================
  let bestEdgeSnap: { point: Point2D; dist: number } | null = null;
  for (const seg of allSegments) {
    const proj = projectPointOnSegment(rawTarget, seg.p1, seg.p2);
    // Проекция должна быть строго на отрезке и близко к курсору
    if (proj.distance < edgeRadiusMm && (!bestEdgeSnap || proj.distance < bestEdgeSnap.dist)) {
      bestEdgeSnap = { point: proj.point, dist: proj.distance };
    }
  }

  if (bestEdgeSnap) {
    return {
      point: bestEdgeSnap.point,
      isSnapped: true,
      snapType: 'wall_edge',
      guideLines: [],
      label: 'Стена',
    };
  }

  // =============================================================
  // УРОВЕНЬ 4: БАЗОВЫЙ / ФОНОВЫЙ ШАГ 100 ММ (gridSnap)
  // Срабатывает только если ни одна из привязок выше не найдена!
  // =============================================================
  let fallbackPoint: Point2D;
  if (basePoint) {
    const rawDist = distance(basePoint, rawTarget);
    const steppedDist = Math.max(100, Math.round(rawDist / 100) * 100);
    const rawAngle = angleDeg(basePoint, rawTarget);
    fallbackPoint = polarToPoint(basePoint, steppedDist, rawAngle);
  } else {
    fallbackPoint = {
      x: Math.round(rawTarget.x / 100) * 100,
      y: Math.round(rawTarget.y / 100) * 100,
    };
  }

  return {
    point: fallbackPoint,
    isSnapped: false,
    snapType: 'none',
    guideLines: [],
  };
}

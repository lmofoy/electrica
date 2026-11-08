import type {
  Point2D,
  SnapResult,
  GuideLine,
  ApartmentBoundary,
  RoomZone,
  Opening,
  FreePartition,
} from '../../types';
import {
  distance,
  angleDeg,
  polarToPoint,
  projectPointOnSegment,
  lineIntersection,
} from './math';
import { buildMonolithicWallMesh } from './wallsGraph';

interface AdvancedSnapContext {
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  openings: Opening[];
  freePartitions: FreePartition[];
  draftVertices: Point2D[];
  zoom: number;
  defaultWallThicknessMm: number;
  precomputedWallMesh?: Point2D[][][];
  prioritySegments?: WallSegment[];
}

interface WallSegment {
  p1: Point2D;
  p2: Point2D;
}

interface NodeCandidate {
  point: Point2D;
  label: string;
  priority: boolean;
}

interface SegmentCandidate {
  p1: Point2D;
  p2: Point2D;
  priority: boolean;
}

/**
 * Радиус притяжения в мм. Номинально держим константу в экранных пикселях
 * (px / zoom), но ограничиваем сверху в мм. Без ограничения при малом зуме
 * зона захвата перекрывает толщину стены целиком и привязка начинает
 * «перепрыгивать» между внешней и внутренней гранью.
 */
function radiusMm(pixelRadius: number, maxMm: number, zoom: number): number {
  return Math.min(pixelRadius / zoom, maxMm);
}

// Мягкий бонус внешнему контуру стен (в мм): при почти равной дистанции
// привязка предпочитает внешнюю грань, но не «крадёт» её у заметно более
// близкой внутренней точки.
const OUTER_NODE_BONUS_MM = 8;
const OUTER_EDGE_BONUS_MM = 6;

function nodeKey(point: Point2D): string {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

function segmentKey(p1: Point2D, p2: Point2D): string {
  const a = `${Math.round(p1.x)},${Math.round(p1.y)}`;
  const b = `${Math.round(p2.x)},${Math.round(p2.y)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Пересечение опорной линии выравнивания с отрезком стены.
 * axis = 'y' — горизонтальная линия y = value, axis = 'x' — вертикальная.
 * Если пересечение лежит за пределами отрезка, возвращает null.
 */
function alignmentLineSegmentIntersection(
  seg: WallSegment,
  axis: 'x' | 'y',
  value: number
): Point2D | null {
  if (axis === 'y') {
    const dy = seg.p2.y - seg.p1.y;
    if (Math.abs(dy) < 1e-6) return null;
    const t = (value - seg.p1.y) / dy;
    if (t < 0 || t > 1) return null;
    return {
      x: Math.round(seg.p1.x + t * (seg.p2.x - seg.p1.x)),
      y: value,
    };
  }

  const dx = seg.p2.x - seg.p1.x;
  if (Math.abs(dx) < 1e-6) return null;
  const t = (value - seg.p1.x) / dx;
  if (t < 0 || t > 1) return null;
  return {
    x: value,
    y: Math.round(seg.p1.y + t * (seg.p2.y - seg.p1.y)),
  };
}

/**
 * Иерархическая система магнитных привязок и направляющих CAD:
 *
 * Уровень 1: Узлы (вершины стен, углы комнат, углы контура, точки стыков) —
 *            высший приоритет.
 * Уровень 2: Polar Tracking (0°, 45°, 90°, 135°...) относительно базовой точки.
 * Уровень 3: Проекция на ребро стены (Edge / Line Snap).
 * Уровень 4: Фоновый шаг 100 мм (gridSnap) — только если ничего выше не найдено.
 *
 * Лучи выравнивания X/Y (Alignment Guides) работают в двух режимах:
 *  - пересечение луча с гранью стены — раньше обычной проекции на ребро
 *    (точка остаётся на стене и одновременно лежит на опорной оси);
 *  - одиночный луч без стены рядом — ПОСЛЕ ребра: иначе лучи от углов
 *    стены перехватывали бы привязку к самой стене и курсор мерцал бы
 *    между «Выравнивание» и «Стена».
 *
 * Внешний контур стен (обвод footprint) входит в общие наборы узлов/рёбер
 * с небольшим бонусом приоритета, а не отдельной ранней веткой — это убирает
 * «перетягивание» привязки с внутренних углов на внешнюю грань и обратно.
 */
export function findBestSnapAdvanced(
  rawTarget: Point2D,
  context: AdvancedSnapContext
): SnapResult {
  const {
    apartment,
    rooms,
    openings,
    freePartitions,
    draftVertices,
    zoom,
    defaultWallThicknessMm,
    precomputedWallMesh,
    prioritySegments,
  } = context;

  // Экранные радиусы притяжения в мм (с ограничением сверху — см. radiusMm)
  const nodeRadiusMm = radiusMm(22, 80, zoom);
  const alignRadiusMm = radiusMm(14, 40, zoom);
  const edgeRadiusMm = radiusMm(15, 60, zoom);
  const polarAngleTolerance = 4.5;

  // =============================================================
  // Сбор узлов и сегментов с дедупликацией: внешний контур и монолитный
  // массив стен содержат одни и те же точки и рёбра. Без дедупа привязка
  // мерцает между двумя почти совпадающими копиями одного элемента.
  // =============================================================
  const nodeMap = new Map<string, NodeCandidate>();
  const segmentMap = new Map<string, SegmentCandidate>();

  const addNode = (point: Point2D, label: string, priority = false) => {
    const key = nodeKey(point);
    const existing = nodeMap.get(key);
    if (!existing) {
      nodeMap.set(key, { point, label, priority });
    } else if (priority && !existing.priority) {
      nodeMap.set(key, { point, label, priority });
    }
  };

  const addSegment = (p1: Point2D, p2: Point2D, priority = false) => {
    if (distance(p1, p2) < 1) return;
    const key = segmentKey(p1, p2);
    const existing = segmentMap.get(key);
    if (!existing) {
      segmentMap.set(key, { p1, p2, priority });
    } else if (priority && !existing.priority) {
      segmentMap.set(key, { p1, p2, priority });
    }
  };

  // 1. Вершины текущего чертежа (последняя исключена — не даём
  //    зациклиться на самой себе и создать нулевую длину)
  draftVertices.forEach((v, idx) => {
    if (idx === draftVertices.length - 1) return;
    addNode(v, idx === 0 ? 'Старт' : 'Узел', false);
  });

  // 2. Углы квартиры и комнат
  if (apartment && apartment.vertices.length >= 3) {
    for (const v of apartment.vertices) addNode(v, 'Угол кв.', false);
  }
  for (const room of rooms) {
    for (const v of room.vertices) addNode(v, 'Угол', false);
  }

  // 3. Внешний контур стен (обвод footprint) — приоритетные грани
  if (prioritySegments && prioritySegments.length > 0) {
    for (const seg of prioritySegments) {
      addNode(seg.p1, 'Грань стены', true);
      addNode(seg.p2, 'Грань стены', true);
      addSegment(seg.p1, seg.p2, true);
    }
  }

  // 4. Монолитный массив стен (внешние грани, внутренние грани, перегородки)
  const monolithicWalls =
    precomputedWallMesh ??
    buildMonolithicWallMesh(
      apartment,
      rooms,
      openings,
      freePartitions,
      defaultWallThicknessMm,
      apartment?.exteriorWallThicknessMm || 250
    );
  for (const poly of monolithicWalls) {
    for (const ring of poly) {
      const len = ring.length;
      for (let i = 0; i < len; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % len];
        addNode(p1, 'Узел стены', false);
        addSegment(p1, p2, false);
      }
    }
  }

  // Базовая точка (предыдущая точка клика)
  const basePoint = draftVertices.length > 0
    ? draftVertices[draftVertices.length - 1]
    : null;

  // =============================================================
  // УРОВЕНЬ 1: УЗЛЫ — САМЫЙ ВЫСОКИЙ ПРИОРИТЕТ.
  // Внешний контур получает мягкий бонус, но не «крадёт» привязку у
  // заметно более близкого внутреннего узла.
  // =============================================================
  let bestNode: NodeCandidate | null = null;
  let bestNodeScore = Infinity;
  for (const node of nodeMap.values()) {
    const d = distance(rawTarget, node.point);
    if (d > nodeRadiusMm) continue;
    const score = d - (node.priority ? OUTER_NODE_BONUS_MM : 0);
    if (score < bestNodeScore) {
      bestNodeScore = score;
      bestNode = node;
    }
  }

  if (bestNode) {
    return {
      point: { ...bestNode.point },
      isSnapped: true,
      snapType: 'vertex',
      guideLines: [],
      label: bestNode.priority ? 'Грань стены' : bestNode.label,
    };
  }

  // =============================================================
  // УРОВЕНЬ 2: POLAR TRACKING (0°, 45°, 90°...) + ALIGNMENT GUIDES (X/Y)
  // =============================================================

  // А) Поиск лучей выравнивания X или Y от всех узлов сцены
  // Исключаем базовую точку из списка поиска, чтобы не строить луч к самому себе
  const fieldNodes = Array.from(nodeMap.values()).filter(
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

    for (const seg of segmentMap.values()) {
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

  // -------------------------------------------------------------
  // Комбинация 2.6: Опорный луч (X или Y) ∩ грань стены
  // Курсор стоит рядом со стеной, но по X или Y выровнен с углом комнаты.
  // Правильная точка — пересечение луча с гранью, а не перпендикулярная
  // проекция курсора: проекция «съезжает» с оси выравнивания.
  // -------------------------------------------------------------
  const alignmentLines: { axis: 'x' | 'y'; value: number; node: Point2D }[] = [];
  if (bestAlignXNode) {
    alignmentLines.push({
      axis: 'x',
      value: bestAlignXNode.point.x,
      node: bestAlignXNode.point,
    });
  }
  if (bestAlignYNode) {
    alignmentLines.push({
      axis: 'y',
      value: bestAlignYNode.point.y,
      node: bestAlignYNode.point,
    });
  }

  if (alignmentLines.length > 0) {
    let bestCross: {
      point: Point2D;
      priority: boolean;
      line: { axis: 'x' | 'y'; value: number; node: Point2D };
      score: number;
    } | null = null;

    for (const seg of segmentMap.values()) {
      const proj = projectPointOnSegment(rawTarget, seg.p1, seg.p2);
      if (proj.distance > edgeRadiusMm) continue;

      for (const line of alignmentLines) {
        const cross = alignmentLineSegmentIntersection(seg, line.axis, line.value);
        if (!cross) continue;

        const d = distance(rawTarget, cross);
        // Точку «держит» опорная линия, поэтому допускаем чуть больший
        // отход от курсора, чем для обычной проекции на ребро.
        if (d > edgeRadiusMm * 1.8) continue;

        const score = d - (seg.priority ? OUTER_EDGE_BONUS_MM : 0);
        if (!bestCross || score < bestCross.score) {
          bestCross = { point: cross, priority: seg.priority, line, score };
        }
      }
    }

    if (bestCross) {
      return {
        point: bestCross.point,
        isSnapped: true,
        snapType: 'wall_edge',
        guideLines: [
          {
            from: bestCross.line.node,
            to: bestCross.point,
            type: bestCross.line.axis === 'x' ? 'align_x' : 'align_y',
            sourceNode: bestCross.line.node,
            label: 'Выравнивание',
          },
        ],
        label: `${bestCross.priority ? 'Грань стены' : 'Стена'} + Выравнивание`,
      };
    }
  }

  // =============================================================
  // УРОВЕНЬ 3: ПРОЕКЦИЯ НА РЕБРО (Edge / Line Snap)
  // Внешний контур получает мягкий бонус, внутренняя грань остаётся
  // доступной, когда она заметно ближе к курсору.
  // =============================================================
  let bestEdge: { point: Point2D; priority: boolean } | null = null;
  let bestEdgeScore = Infinity;
  for (const seg of segmentMap.values()) {
    const proj = projectPointOnSegment(rawTarget, seg.p1, seg.p2);
    if (proj.distance > edgeRadiusMm) continue;
    const score = proj.distance - (seg.priority ? OUTER_EDGE_BONUS_MM : 0);
    if (score < bestEdgeScore) {
      bestEdgeScore = score;
      bestEdge = { point: proj.point, priority: seg.priority };
    }
  }

  if (bestEdge) {
    return {
      point: { ...bestEdge.point },
      isSnapped: true,
      snapType: 'wall_edge',
      guideLines: [],
      label: bestEdge.priority ? 'Грань стены' : 'Стена',
    };
  }

  // =============================================================
  // УРОВЕНЬ 2 (хвост): ВЫРАВНИВАНИЕ X/Y (лучи от узлов поля)
  // Идут ПОСЛЕ проекции на ребро: иначе лучи от углов стены «перехватывали»
  // привязку к самой стене и заставляли курсор мерцать между «Выравнивание»
  // и «Стена» при движении вдоль внешнего контура.
  // =============================================================

  // Комбинация 2.2: Пересечение двух лучей выравнивания (X от узла + Y от узла)
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

  // Комбинация 2.3: Одиночный луч выравнивания по X от узла поля
  if (bestAlignXNode) {
    const snapX = bestAlignXNode.point.x;
    let snapY = rawTarget.y;

    if (basePoint && (polarTargetAngle === 0 || polarTargetAngle === 180)) {
      snapY = basePoint.y;
    } else {
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

  // Комбинация 2.4: Одиночный луч выравнивания по Y от узла поля
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

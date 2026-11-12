import type {
  ManualRoute,
  ManualRouteAnchor,
  ManualRouteAnchorKind,
  Point2D,
} from '../../types';
import { distance, projectPointOnSegment } from '../geometry/math';

// Допуск на совпадение вершин и коллинеарность, мм.
export const MANUAL_ROUTE_EPS_MM = 0.5;

// Допуск, при котором закреплённая точка считается привязанной к текущему
// положению щитка/прибора, мм.
export const MANUAL_ROUTE_ANCHOR_TOLERANCE_MM = 1;

export interface ManualRouteError {
  ok: false;
  error: string;
}

export type ManualRouteResult = { ok: true; route: ManualRoute } | ManualRouteError;

export type ManualRouteInsertResult =
  | { ok: true; route: ManualRoute; nodeIndex: number }
  | ManualRouteError;

export interface MaterializeManualRouteOptions {
  panelPoint?: Point2D;
  devicePoints?: { deviceId: string; point: Point2D }[];
  junctionPoints?: Point2D[];
}

type SegmentOrientation = 'h' | 'v' | 'slanted';

interface IncidentEdge {
  neighbor: number;
  orientation: SegmentOrientation;
}

const ANCHOR_PRIORITY: Record<ManualRouteAnchorKind, number> = {
  panel: 0,
  device: 1,
  junction: 2,
};

function finitePoint(point: Point2D | null | undefined): point is Point2D {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function samePoint(a: Point2D, b: Point2D): boolean {
  return distance(a, b) <= MANUAL_ROUTE_EPS_MM;
}

function orientation(a: Point2D, b: Point2D): SegmentOrientation {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dy <= MANUAL_ROUTE_EPS_MM && dx > MANUAL_ROUTE_EPS_MM) return 'h';
  if (dx <= MANUAL_ROUTE_EPS_MM && dy > MANUAL_ROUTE_EPS_MM) return 'v';
  return 'slanted';
}

function cloneRoute(route: ManualRoute): ManualRoute {
  const result: ManualRoute = {
    nodes: route.nodes.map((point) => ({ x: point.x, y: point.y })),
    paths: route.paths.map((path) => [...path]),
    anchors: route.anchors.map((anchor) => ({ ...anchor })),
  };
  if (route.bendNodes && route.bendNodes.length > 0) {
    result.bendNodes = [...route.bendNodes];
  }
  return result;
}

function bendNodeSet(route: ManualRoute): Set<number> {
  const result = new Set<number>();
  for (const index of route.bendNodes ?? []) {
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < route.nodes.length
    ) {
      result.add(index);
    }
  }
  return result;
}

export function isManualRouteBendNode(
  route: ManualRoute,
  nodeIndex: number
): boolean {
  return (route.bendNodes ?? []).includes(nodeIndex);
}

function normalizeAnchors(
  anchors: ManualRouteAnchor[],
  nodeCount: number
): ManualRouteAnchor[] {
  const byNode = new Map<number, ManualRouteAnchor[]>();
  for (const anchor of anchors) {
    if (
      !Number.isInteger(anchor.nodeIndex) ||
      anchor.nodeIndex < 0 ||
      anchor.nodeIndex >= nodeCount
    ) {
      continue;
    }
    if (!(anchor.kind in ANCHOR_PRIORITY)) continue;
    const list = byNode.get(anchor.nodeIndex) ?? [];
    if (
      anchor.kind === 'device' &&
      (typeof anchor.deviceId !== 'string' || anchor.deviceId.length === 0)
    ) {
      continue;
    }
    list.push(
      anchor.kind === 'device'
        ? { nodeIndex: anchor.nodeIndex, kind: 'device', deviceId: anchor.deviceId }
        : { nodeIndex: anchor.nodeIndex, kind: anchor.kind }
    );
    byNode.set(anchor.nodeIndex, list);
  }

  const result: ManualRouteAnchor[] = [];
  for (const [nodeIndex, list] of byNode) {
    if (list.some((anchor) => anchor.kind === 'panel')) {
      result.push({ nodeIndex, kind: 'panel' });
      continue;
    }
    const devices = new Map<string, ManualRouteAnchor>();
    for (const anchor of list) {
      if (anchor.kind === 'device' && anchor.deviceId) {
        devices.set(anchor.deviceId, anchor);
      }
    }
    if (devices.size > 0) {
      result.push(...devices.values());
      continue;
    }
    if (list.some((anchor) => anchor.kind === 'junction')) {
      result.push({ nodeIndex, kind: 'junction' });
    }
  }

  result.sort(
    (a, b) =>
      a.nodeIndex - b.nodeIndex ||
      ANCHOR_PRIORITY[a.kind] - ANCHOR_PRIORITY[b.kind] ||
      (a.deviceId ?? '').localeCompare(b.deviceId ?? '')
  );
  return result;
}

function degreeMap(route: ManualRoute): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    const set = result.get(a) ?? new Set<number>();
    set.add(b);
    result.set(a, set);
  };
  for (const path of route.paths) {
    for (let i = 1; i < path.length; i++) {
      link(path[i - 1], path[i]);
      link(path[i], path[i - 1]);
    }
  }
  return result;
}

function incidentEdges(route: ManualRoute, nodeIndex: number): IncidentEdge[] {
  const seen = new Set<number>();
  const result: IncidentEdge[] = [];
  for (const path of route.paths) {
    for (let i = 0; i < path.length; i++) {
      if (path[i] !== nodeIndex) continue;
      for (const neighborIndex of [i - 1, i + 1]) {
        if (neighborIndex < 0 || neighborIndex >= path.length) continue;
        const neighbor = path[neighborIndex];
        if (neighbor === nodeIndex || seen.has(neighbor)) continue;
        seen.add(neighbor);
        result.push({
          neighbor,
          orientation: orientation(route.nodes[nodeIndex], route.nodes[neighbor]),
        });
      }
    }
  }
  return result;
}

function anchorNodeSet(route: ManualRoute): Set<number> {
  return new Set(route.anchors.map((anchor) => anchor.nodeIndex));
}

function isCollinearBetween(a: Point2D, b: Point2D, c: Point2D): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const cross = abx * bcy - aby * bcx;
  const scale = Math.max(1, Math.hypot(abx, aby), Math.hypot(bcx, bcy));
  if (Math.abs(cross) > MANUAL_ROUTE_EPS_MM * scale) return false;
  // Точка должна лежать между соседями: удаление не меняет геометрию.
  return abx * bcx + aby * bcy >= 0;
}

interface CompactOptions {
  keepNode?: number;
  removeCollinear?: boolean;
}

function compactRoute(
  route: ManualRoute,
  options: CompactOptions = {}
): ManualRoute | null {
  const anchors = anchorNodeSet(route);
  const bends = bendNodeSet(route);
  const degrees = degreeMap(route);
  const keepNode = options.keepNode;
  const paths: number[][] = [];
  // При совпадении вершин сохраняем более значимую: перемещаемую, затем
  // закреплённую, затем обычную точку, и только в последнюю очередь изгиб.
  const rankOf = (index: number): number =>
    (index === keepNode ? 3 : 0) +
    (anchors.has(index) ? 2 : 0) +
    (bends.has(index) ? 0 : 1);

  for (const source of route.paths) {
    if (!Array.isArray(source) || source.length < 2) continue;
    const path: number[] = [];
    for (const rawIndex of source) {
      if (
        !Number.isInteger(rawIndex) ||
        rawIndex < 0 ||
        rawIndex >= route.nodes.length
      ) {
        continue;
      }
      const point = route.nodes[rawIndex];
      if (!finitePoint(point)) continue;

      if (path.length > 0) {
        const previousIndex = path[path.length - 1];
        const previousPoint = route.nodes[previousIndex];
        if (previousIndex === rawIndex) continue;
        if (samePoint(previousPoint, point)) {
          // Совпавшие соседние вершины: оставляем более приоритетную.
          if (rankOf(rawIndex) > rankOf(previousIndex)) {
            path[path.length - 1] = rawIndex;
          }
          continue;
        }
      }
      path.push(rawIndex);
    }

    if (options.removeCollinear) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 1; i < path.length - 1; i++) {
          const middle = path[i];
          if (middle === keepNode || anchors.has(middle)) continue;
          if ((degrees.get(middle)?.size ?? 0) > 2) continue;
          // Явные и автоматические точки пользователя не исчезают сами:
          // схлопываем только служебные изгибы.
          if (!bends.has(middle)) continue;
          if (
            isCollinearBetween(
              route.nodes[path[i - 1]],
              route.nodes[middle],
              route.nodes[path[i + 1]]
            )
          ) {
            path.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
    }

    if (path.length >= 2) paths.push(path);
  }

  if (paths.length === 0) return null;

  const used = new Set<number>();
  for (const path of paths) for (const index of path) used.add(index);
  const remap = new Map<number, number>();
  const nodes: Point2D[] = [];
  for (let i = 0; i < route.nodes.length; i++) {
    if (!used.has(i)) continue;
    remap.set(i, nodes.length);
    nodes.push({ ...route.nodes[i] });
  }

  const remappedPaths = paths.map((path) =>
    path.map((index) => remap.get(index) as number)
  );
  const remappedAnchors = route.anchors
    .map((anchor) => ({
      ...anchor,
      nodeIndex: remap.get(anchor.nodeIndex) ?? -1,
    }))
    .filter((anchor) => anchor.nodeIndex >= 0);
  const normalizedAnchors = normalizeAnchors(remappedAnchors, nodes.length);
  const anchorIndices = new Set(
    normalizedAnchors.map((anchor) => anchor.nodeIndex)
  );
  const remappedBends = [...bends]
    .map((index) => remap.get(index))
    .filter(
      (index): index is number =>
        index !== undefined && !anchorIndices.has(index)
    )
    .sort((a, b) => a - b);

  return {
    nodes,
    paths: remappedPaths,
    anchors: normalizedAnchors,
    ...(remappedBends.length > 0 ? { bendNodes: remappedBends } : {}),
  };
}

function hasZeroLengthSegment(route: ManualRoute): boolean {
  for (const path of route.paths) {
    for (let i = 1; i < path.length; i++) {
      if (samePoint(route.nodes[path[i - 1]], route.nodes[path[i]])) return true;
    }
  }
  return false;
}

function validateRoute(route: ManualRoute): ManualRouteError | null {
  if (!route || !Array.isArray(route.nodes) || !Array.isArray(route.paths)) {
    return { ok: false, error: 'Ручная трасса повреждена: нет вершин или участков.' };
  }
  if (route.nodes.length < 2) {
    return { ok: false, error: 'Ручная трасса повреждена: слишком мало вершин.' };
  }
  for (const point of route.nodes) {
    if (!finitePoint(point)) {
      return { ok: false, error: 'Ручная трасса повреждена: нечисловые координаты.' };
    }
  }
  if (route.paths.length === 0) {
    return { ok: false, error: 'Ручная трасса повреждена: нет участков.' };
  }
  for (const path of route.paths) {
    if (!Array.isArray(path) || path.length < 2) {
      return { ok: false, error: 'Ручная трасса повреждена: пустой участок.' };
    }
    for (const index of path) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= route.nodes.length
      ) {
        return { ok: false, error: 'Ручная трасса повреждена: неверная ссылка на вершину.' };
      }
    }
  }
  if (hasZeroLengthSegment(route)) {
    return { ok: false, error: 'Ручная трасса повреждена: нулевой сегмент.' };
  }
  for (const anchor of route.anchors) {
    if (
      !Number.isInteger(anchor.nodeIndex) ||
      anchor.nodeIndex < 0 ||
      anchor.nodeIndex >= route.nodes.length
    ) {
      return { ok: false, error: 'Ручная трасса повреждена: неверная закреплённая точка.' };
    }
    if (!(anchor.kind in ANCHOR_PRIORITY)) {
      return { ok: false, error: 'Ручная трасса повреждена: неизвестный тип закреплённой точки.' };
    }
  }
  if (route.bendNodes !== undefined) {
    if (!Array.isArray(route.bendNodes)) {
      return { ok: false, error: 'Ручная трасса повреждена: неверный список изгибов.' };
    }
    for (const index of route.bendNodes) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= route.nodes.length
      ) {
        return { ok: false, error: 'Ручная трасса повреждена: изгиб ссылается на несуществующую вершину.' };
      }
    }
  }
  return null;
}

export function validateManualRoute(route: ManualRoute): ManualRouteError | null {
  return validateRoute(route);
}

export function manualRouteLength(route: ManualRoute): number {
  let total = 0;
  for (const path of route.paths) {
    for (let i = 1; i < path.length; i++) {
      total += distance(route.nodes[path[i - 1]], route.nodes[path[i]]);
    }
  }
  return total;
}

export function isManualRouteOrthogonal(route: ManualRoute): boolean {
  return route.paths.every((path) =>
    path.every((index, i) =>
      i === 0 ? true : orientation(route.nodes[path[i - 1]], route.nodes[index]) !== 'slanted'
    )
  );
}

export function manualRouteAnchorNode(
  route: ManualRoute,
  kind: ManualRouteAnchorKind,
  deviceId?: string
): number | null {
  const anchor = route.anchors.find(
    (candidate) =>
      candidate.kind === kind &&
      (kind !== 'device' || candidate.deviceId === deviceId)
  );
  return anchor ? anchor.nodeIndex : null;
}

export function isManualRouteAnchorNode(
  route: ManualRoute,
  nodeIndex: number
): boolean {
  return route.anchors.some((anchor) => anchor.nodeIndex === nodeIndex);
}

export function sanitizeManualRoute(raw: unknown): ManualRoute | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as {
    nodes?: unknown;
    paths?: unknown;
    anchors?: unknown;
    bendNodes?: unknown;
  };
  if (!Array.isArray(source.nodes) || !Array.isArray(source.paths)) {
    return undefined;
  }

  const cookedNodes = source.nodes.map((point) =>
    finitePoint(point as Point2D) ? { x: point.x, y: point.y } : null
  );

  const rawPaths: number[][] = [];
  for (const rawPath of source.paths) {
    if (!Array.isArray(rawPath)) continue;
    const path: number[] = [];
    for (const value of rawPath) {
      if (!Number.isInteger(value)) continue;
      const index = value as number;
      if (index < 0 || index >= cookedNodes.length) continue;
      const point = cookedNodes[index];
      if (!point) continue;
      if (path.length > 0) {
        const previousIndex = path[path.length - 1];
        if (previousIndex === index) continue;
        const previousPoint = cookedNodes[previousIndex];
        if (previousPoint && samePoint(previousPoint, point)) continue;
      }
      path.push(index);
    }
    if (path.length >= 2) rawPaths.push(path);
  }
  if (rawPaths.length === 0) return undefined;

  const used = new Set<number>();
  for (const path of rawPaths) for (const index of path) used.add(index);
  const remap = new Map<number, number>();
  const nodes: Point2D[] = [];
  for (let i = 0; i < cookedNodes.length; i++) {
    const point = cookedNodes[i];
    if (!point || !used.has(i)) continue;
    remap.set(i, nodes.length);
    nodes.push({ ...point });
  }
  if (nodes.length < 2) return undefined;

  const rawAnchors = Array.isArray(source.anchors) ? source.anchors : [];
  const anchors: ManualRouteAnchor[] = [];
  for (const rawAnchor of rawAnchors) {
    if (!rawAnchor || typeof rawAnchor !== 'object') continue;
    const anchor = rawAnchor as Partial<ManualRouteAnchor>;
    if (
      typeof anchor.kind !== 'string' ||
      !(anchor.kind in ANCHOR_PRIORITY) ||
      !Number.isInteger(anchor.nodeIndex) ||
      (anchor.nodeIndex as number) < 0
    ) {
      continue;
    }
    const nodeIndex = remap.get(anchor.nodeIndex as number);
    if (nodeIndex === undefined) continue;
    if (anchor.kind === 'device') {
      if (typeof anchor.deviceId !== 'string' || anchor.deviceId.length === 0) {
        continue;
      }
      anchors.push({ nodeIndex, kind: 'device', deviceId: anchor.deviceId });
    } else {
      anchors.push({ nodeIndex, kind: anchor.kind });
    }
  }

  const anchorList = normalizeAnchors(anchors, nodes.length);
  const anchorIndices = new Set(anchorList.map((anchor) => anchor.nodeIndex));
  const bendIndices = new Set<number>();
  if (Array.isArray(source.bendNodes)) {
    for (const value of source.bendNodes) {
      if (!Number.isInteger(value)) continue;
      const nodeIndex = remap.get(value as number);
      if (nodeIndex === undefined || anchorIndices.has(nodeIndex)) continue;
      bendIndices.add(nodeIndex);
    }
  }

  const candidate: ManualRoute = {
    nodes,
    paths: rawPaths.map((path) => path.map((index) => remap.get(index) as number)),
    anchors: anchorList,
    ...(bendIndices.size > 0
      ? { bendNodes: [...bendIndices].sort((a, b) => a - b) }
      : {}),
  };
  if (validateRoute(candidate)) return undefined;
  return compactRoute(candidate) ?? undefined;
}

export function materializeManualRoute(
  paths: Point2D[][],
  options: MaterializeManualRouteOptions = {}
): ManualRoute | null {
  const nodes: Point2D[] = [];
  const indexByKey = new Map<string, number>();
  const keyOf = (point: Point2D) =>
    `${Math.round(point.x / MANUAL_ROUTE_EPS_MM)}:${Math.round(
      point.y / MANUAL_ROUTE_EPS_MM
    )}`;
  const addNode = (point: Point2D): number => {
    const key = keyOf(point);
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push({ x: point.x, y: point.y });
    indexByKey.set(key, index);
    return index;
  };

  const resultPaths: number[][] = [];
  for (const inputPath of paths) {
    if (!Array.isArray(inputPath)) continue;
    const path: number[] = [];
    for (const point of inputPath) {
      if (!finitePoint(point)) continue;
      const index = addNode(point);
      if (path.length > 0 && path[path.length - 1] === index) continue;
      path.push(index);
    }
    if (path.length >= 2) resultPaths.push(path);
  }
  if (resultPaths.length === 0) return null;

  const anchorByNode = new Map<number, ManualRouteAnchor[]>();
  const pushAnchor = (anchor: ManualRouteAnchor) => {
    const list = anchorByNode.get(anchor.nodeIndex) ?? [];
    list.push(anchor);
    anchorByNode.set(anchor.nodeIndex, list);
  };
  const nodeAt = (point: Point2D): number | null => {
    const index = indexByKey.get(keyOf(point));
    return index === undefined ? null : index;
  };

  if (options.panelPoint) {
    const index = nodeAt(options.panelPoint);
    if (index !== null) pushAnchor({ nodeIndex: index, kind: 'panel' });
  }
  for (const device of options.devicePoints ?? []) {
    if (!device.deviceId) continue;
    const index = nodeAt(device.point);
    if (index !== null) {
      pushAnchor({ nodeIndex: index, kind: 'device', deviceId: device.deviceId });
    }
  }
  for (const point of options.junctionPoints ?? []) {
    const index = nodeAt(point);
    if (index !== null) pushAnchor({ nodeIndex: index, kind: 'junction' });
  }

  const degrees = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    const set = degrees.get(a) ?? new Set<number>();
    set.add(b);
    degrees.set(a, set);
  };
  for (const path of resultPaths) {
    for (let i = 1; i < path.length; i++) {
      link(path[i - 1], path[i]);
      link(path[i], path[i - 1]);
    }
  }
  for (const [nodeIndex, neighbors] of degrees) {
    if (neighbors.size > 2) {
      pushAnchor({ nodeIndex, kind: 'junction' });
    }
  }

  const anchors = normalizeAnchors(
    [...anchorByNode.values()].flat(),
    nodes.length
  );
  const route: ManualRoute = { nodes, paths: resultPaths, anchors };
  if (validateRoute(route)) return null;
  return route;
}

function resultWithRoute(route: ManualRoute | null): ManualRouteResult {
  if (!route) {
    return { ok: false, error: 'Не удалось сохранить трассу: она схлопнулась.' };
  }
  const invalid = validateRoute(route);
  if (invalid) return invalid;
  return { ok: true, route };
}

export type ManualRouteMoveResult =
  | { ok: true; route: ManualRoute; nodeIndex: number }
  | ManualRouteError;

// Закреплены только физические точки подключения. Стык (junction) — обычная
// геометрическая вершина, его можно двигать.
function isPhysicalAnchorNode(route: ManualRoute, nodeIndex: number): boolean {
  return route.anchors.some(
    (anchor) =>
      anchor.nodeIndex === nodeIndex &&
      (anchor.kind === 'panel' || anchor.kind === 'device')
  );
}

/**
 * Перемещает одну вершину. Соседние вершины, щиток, приборы и стыки остаются
 * на месте. У каждого примыкающего ортогонального сегмента сохраняется его
 * прежнее направление у перемещаемой вершины, поэтому линия возвращается к
 * соседу ступенькой под 90° (при необходимости — через одну новую точку).
 * Наклонные сегменты не изламываются: вершина скользит вдоль наклонной.
 */
export function moveManualRouteNode(
  route: ManualRoute,
  nodeIndex: number,
  target: Point2D
): ManualRouteMoveResult {
  const clean = sanitizeManualRoute(route);
  if (!clean) {
    return { ok: false, error: 'Ручная трасса повреждена и не может быть изменена.' };
  }
  if (!finitePoint(target)) {
    return { ok: false, error: 'Некорректная координата перемещения.' };
  }
  if (
    !Number.isInteger(nodeIndex) ||
    nodeIndex < 0 ||
    nodeIndex >= clean.nodes.length
  ) {
    return { ok: false, error: 'Вершина не найдена.' };
  }
  if (isPhysicalAnchorNode(clean, nodeIndex)) {
    return {
      ok: false,
      error: 'Точка подключения щитка или прибора закреплена. Переместите сам элемент.',
    };
  }

  const node = clean.nodes[nodeIndex];
  const incidents = incidentEdges(clean, nodeIndex);
  if (incidents.length === 0) {
    return { ok: false, error: 'Вершина не принадлежит ни одному участку.' };
  }

  // Наклонные сегменты: вершина скользит вдоль общей наклонной прямой.
  // Стык двух разных наклонных направлений изломать нельзя — отказ.
  let to: Point2D = { x: target.x, y: target.y };
  const slanted = incidents.filter((edge) => edge.orientation === 'slanted');
  if (slanted.length > 0) {
    const anchorEdge = slanted[0];
    const anchorVector = {
      x: clean.nodes[anchorEdge.neighbor].x - node.x,
      y: clean.nodes[anchorEdge.neighbor].y - node.y,
    };
    const anchorLength = Math.hypot(anchorVector.x, anchorVector.y);
    const direction = {
      x: anchorVector.x / anchorLength,
      y: anchorVector.y / anchorLength,
    };
    for (const edge of slanted.slice(1)) {
      const neighbor = clean.nodes[edge.neighbor];
      const vx = neighbor.x - node.x;
      const vy = neighbor.y - node.y;
      const length = Math.hypot(vx, vy);
      if (length <= MANUAL_ROUTE_EPS_MM) continue;
      const sin =
        Math.abs(direction.x * (vy / length) - direction.y * (vx / length));
      // Допуск: отклонение не больше 0.5 мм на длине короткого сегмента.
      const tolerance = MANUAL_ROUTE_EPS_MM / Math.min(anchorLength, length);
      if (sin > tolerance) {
        return {
          ok: false,
          error:
            'Вершина на стыке двух наклонных участков закреплена: сдвиг изломал бы линию.',
        };
      }
    }
    const t =
      (target.x - node.x) * direction.x + (target.y - node.y) * direction.y;
    to = { x: node.x + direction.x * t, y: node.y + direction.y * t };
  }

  if (samePoint(node, to)) {
    return { ok: true, route: clean, nodeIndex };
  }

  const bends = bendNodeSet(clean);
  for (let i = 0; i < clean.nodes.length; i++) {
    if (i === nodeIndex || bends.has(i)) continue;
    if (samePoint(to, clean.nodes[i])) {
      return {
        ok: false,
        error: 'Точка совпала бы с другой вершиной трассы. Выберите другое положение.',
      };
    }
  }

  for (const path of clean.paths) {
    let occurrences = 0;
    for (const index of path) if (index === nodeIndex) occurrences += 1;
    if (occurrences > 1) {
      return {
        ok: false,
        error: 'Участок проходит через точку дважды — перемещение невозможно.',
      };
    }
  }

  // Изгиб, созданный прошлым жестом, — служебная вершина. Его «партнёр» —
  // единственная соседняя точка, не являющаяся перемещаемой вершиной.
  const partnerOfBend = (bendIndex: number): number | null => {
    let partner: number | null = null;
    for (const path of clean.paths) {
      for (let i = 0; i < path.length; i++) {
        if (path[i] !== bendIndex) continue;
        for (const side of [i - 1, i + 1]) {
          if (side < 0 || side >= path.length) continue;
          const neighbor = path[side];
          if (neighbor === nodeIndex || neighbor === bendIndex) continue;
          if (partner !== null && partner !== neighbor) return null;
          partner = neighbor;
        }
      }
    }
    return partner;
  };

  // Возвращает соседа на стороне вершины и, если сосед — служебный изгиб,
  // сразу переходит к его партнёру. Направление у перемещаемой вершины при
  // этом сохраняется по старому изгибу.
  const sideNeighbor = (
    path: number[],
    position: number,
    direction: -1 | 1
  ): {
    index: number | null;
    neighborPos: number;
    kind: SegmentOrientation | null;
  } => {
    const rawPos = position + direction;
    if (rawPos < 0 || rawPos >= path.length) {
      return { index: null, neighborPos: rawPos, kind: null };
    }
    const raw = path[rawPos];
    if (bends.has(raw)) {
      const partner = partnerOfBend(raw);
      if (partner !== null && partner !== nodeIndex) {
        return {
          index: partner,
          neighborPos: rawPos + direction,
          kind: orientation(clean.nodes[nodeIndex], clean.nodes[raw]),
        };
      }
    }
    return { index: raw, neighborPos: rawPos, kind: null };
  };

  const orientationByNeighbor = new Map(
    incidents.map((edge) => [edge.neighbor, edge.orientation] as const)
  );
  const next = cloneRoute(clean);
  next.nodes[nodeIndex] = { x: to.x, y: to.y };
  const nextBends = new Set(bends);
  nextBends.delete(nodeIndex);

  const elbowCache = new Map<string, number | null>();
  const elbowFor = (
    neighborIndex: number,
    kindOverride: SegmentOrientation | null
  ): number | null => {
    const kind =
      kindOverride ??
      orientationByNeighbor.get(neighborIndex) ??
      orientation(clean.nodes[nodeIndex], clean.nodes[neighborIndex]);
    const cacheKey = `${neighborIndex}:${kind}`;
    if (elbowCache.has(cacheKey)) return elbowCache.get(cacheKey) ?? null;
    if (kind === 'slanted') {
      elbowCache.set(cacheKey, null);
      return null;
    }
    const neighbor = next.nodes[neighborIndex];
    const elbowPoint =
      kind === 'h'
        ? { x: neighbor.x, y: to.y }
        : { x: to.x, y: neighbor.y };
    if (samePoint(elbowPoint, to) || samePoint(elbowPoint, neighbor)) {
      elbowCache.set(cacheKey, null);
      return null;
    }
    const index = next.nodes.length;
    next.nodes.push({ x: elbowPoint.x, y: elbowPoint.y });
    nextBends.add(index);
    elbowCache.set(cacheKey, index);
    return index;
  };

  const nextPaths: number[][] = [];
  for (const path of clean.paths) {
    const position = path.indexOf(nodeIndex);
    if (position < 0) {
      nextPaths.push([...path]);
      continue;
    }
    const previous = sideNeighbor(path, position, -1);
    const following = sideNeighbor(path, position, 1);
    const result: number[] =
      previous.index !== null
        ? path.slice(0, previous.neighborPos)
        : path.slice(0, position);
    if (previous.index !== null) {
      result.push(previous.index);
      const elbow = elbowFor(previous.index, previous.kind);
      if (elbow !== null) result.push(elbow);
    }
    result.push(nodeIndex);
    if (following.index !== null) {
      const elbow = elbowFor(following.index, following.kind);
      if (elbow !== null) result.push(elbow);
      result.push(following.index);
    }
    result.push(
      ...(following.index !== null
        ? path.slice(following.neighborPos + 1)
        : path.slice(position + 1))
    );
    nextPaths.push(result);
  }

  const moved = compactRoute(
    {
      nodes: next.nodes,
      paths: nextPaths,
      anchors: next.anchors,
      bendNodes: [...nextBends],
    },
    { keepNode: nodeIndex, removeCollinear: true }
  );
  if (!moved) {
    return { ok: false, error: 'Не удалось сохранить трассу: она схлопнулась.' };
  }
  const invalid = validateRoute(moved);
  if (invalid) return invalid;
  const movedIndex = moved.nodes.findIndex((point) => samePoint(point, to));
  if (movedIndex < 0) {
    return { ok: false, error: 'Не удалось сохранить перемещённую вершину.' };
  }
  return { ok: true, route: moved, nodeIndex: movedIndex };
}

export function insertManualRouteNode(
  route: ManualRoute,
  pathIndex: number,
  segmentIndex: number,
  point: Point2D,
  maxDistanceMm = Number.POSITIVE_INFINITY
): ManualRouteInsertResult {
  const clean = sanitizeManualRoute(route);
  if (!clean) {
    return { ok: false, error: 'Ручная трасса повреждена и не может быть изменена.' };
  }
  if (!finitePoint(point)) {
    return { ok: false, error: 'Некорректная координата точки.' };
  }
  if (
    !Number.isInteger(pathIndex) ||
    pathIndex < 0 ||
    pathIndex >= clean.paths.length
  ) {
    return { ok: false, error: 'Участок не найден.' };
  }
  const path = clean.paths[pathIndex];
  if (
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0 ||
    segmentIndex >= path.length - 1
  ) {
    return { ok: false, error: 'Сегмент не найден.' };
  }

  const startIndex = path[segmentIndex];
  const endIndex = path[segmentIndex + 1];
  const start = clean.nodes[startIndex];
  const end = clean.nodes[endIndex];
  const projection = projectPointOnSegment(point, start, end);
  // projectPointOnSegment округляет координаты до целых миллиметров. На
  // наклонном сегменте это уводит точку с линии на ~0.7 мм, и её потом нельзя
  // удалить как прямую (допуск коллинеарности 0.5 мм). Поэтому вершину ставим
  // по точному параметру проекции, без округления.
  const projected: Point2D = {
    x: start.x + projection.t * (end.x - start.x),
    y: start.y + projection.t * (end.y - start.y),
  };
  const projectionDistance = distance(point, projected);
  if (projectionDistance > maxDistanceMm) {
    return { ok: false, error: 'Точку можно добавить только на линии трассы.' };
  }
  if (
    distance(projected, start) <= MANUAL_ROUTE_EPS_MM ||
    distance(projected, end) <= MANUAL_ROUTE_EPS_MM
  ) {
    return { ok: false, error: 'Точка слишком близко к существующей вершине.' };
  }

  for (const candidate of clean.paths) {
    for (let i = 1; i < candidate.length; i++) {
      if (
        samePoint(clean.nodes[candidate[i - 1]], projected) ||
        samePoint(clean.nodes[candidate[i]], projected)
      ) {
        return { ok: false, error: 'В этом месте уже есть вершина.' };
      }
    }
  }

  const next = cloneRoute(clean);
  const newNodeIndex = next.nodes.length;
  next.nodes.push(projected);
  let inserted = false;
  next.paths = next.paths.map((candidate) => {
    const result: number[] = [];
    for (let i = 0; i < candidate.length; i++) {
      result.push(candidate[i]);
      if (i >= candidate.length - 1) continue;
      const a = candidate[i];
      const b = candidate[i + 1];
      if ((a === startIndex && b === endIndex) || (a === endIndex && b === startIndex)) {
        result.push(newNodeIndex);
        inserted = true;
      }
    }
    return result;
  });
  if (!inserted) {
    return { ok: false, error: 'Не удалось вставить точку в выбранный сегмент.' };
  }

  const invalid = validateRoute(next);
  if (invalid) return invalid;
  return { ok: true, route: next, nodeIndex: newNodeIndex };
}

export function removeManualRouteNode(
  route: ManualRoute,
  nodeIndex: number
): ManualRouteResult {
  const clean = sanitizeManualRoute(route);
  if (!clean) {
    return { ok: false, error: 'Ручная трасса повреждена и не может быть изменена.' };
  }
  if (
    !Number.isInteger(nodeIndex) ||
    nodeIndex < 0 ||
    nodeIndex >= clean.nodes.length
  ) {
    return { ok: false, error: 'Вершина не найдена.' };
  }
  if (isManualRouteAnchorNode(clean, nodeIndex)) {
    return {
      ok: false,
      error: 'Закреплённую точку (щиток, прибор или стык) удалить нельзя. Переместите её или удалите линию.',
    };
  }
  const incidents = incidentEdges(clean, nodeIndex);
  if (incidents.length === 0) {
    return { ok: false, error: 'Вершина не принадлежит ни одному участку.' };
  }
  if (incidents.length > 2) {
    return {
      ok: false,
      error: 'Точку с ответвлениями удалить нельзя: сначала уберите ответвление.',
    };
  }

  const bends = bendNodeSet(clean);
  const next = cloneRoute(clean);
  const nextBends = new Set(bends);
  let removed = false;
  const nextPaths: number[][] = [];
  // Вершина может быть концом сразу двух ломаных (трасса разделена на
  // участки). Тогда удаление не должно терять одну из ветвей: обе ветви
  // соединяются в одну, а остальные участки остаются нетронутыми.
  const tails: {
    nodes: number[];
    atStart: boolean;
    nearest: number | null;
    adjacent: number | null;
  }[] = [];

  const dedupe = (list: number[]): number[] => {
    const result: number[] = [];
    for (const index of list) {
      if (result.length > 0) {
        const previous = result[result.length - 1];
        if (previous === index) continue;
        if (samePoint(next.nodes[previous], next.nodes[index])) continue;
      }
      result.push(index);
    }
    return result;
  };

  // Соединение двух видимых точек: линии строятся только под 90°, поэтому
  // при несовпадении осей вставляется служебная ступенька. Направление
  // выбирается по старой оси у первой точки, чтобы участок у соседа не
  // разворачивался. Ступенька не становится маркером.
  const connect = (
    aIndex: number,
    aAdjacent: number | null,
    bIndex: number,
    bAdjacent: number | null
  ): number[] => {
    const a = clean.nodes[aIndex];
    const b = clean.nodes[bIndex];
    if (
      Math.abs(a.y - b.y) <= MANUAL_ROUTE_EPS_MM ||
      Math.abs(a.x - b.x) <= MANUAL_ROUTE_EPS_MM
    ) {
      return [aIndex, bIndex];
    }
    const axisA =
      aAdjacent !== null
        ? orientation(a, clean.nodes[aAdjacent])
        : 'slanted';
    const axisB =
      bAdjacent !== null
        ? orientation(clean.nodes[bAdjacent], b)
        : 'slanted';
    let elbow: Point2D;
    if (axisA === 'h') elbow = { x: b.x, y: a.y };
    else if (axisA === 'v') elbow = { x: a.x, y: b.y };
    else if (axisB === 'h') elbow = { x: a.x, y: b.y };
    else if (axisB === 'v') elbow = { x: b.x, y: a.y };
    else elbow = { x: b.x, y: a.y };
    const elbowIndex = next.nodes.length;
    next.nodes.push(elbow);
    nextBends.add(elbowIndex);
    return [aIndex, elbowIndex, bIndex];
  };

  for (const path of clean.paths) {
    const position = path.indexOf(nodeIndex);
    if (position < 0) {
      nextPaths.push([...path]);
      continue;
    }
    removed = true;
    // Удаляем точку и примыкавшие к ней служебные изгибы: участок между
    // соседними видимыми точками перестраивается ступенькой под 90°.
    // Все остальные участки пути остаются без изменений.
    if (position > 0 && position < path.length - 1) {
      let aPos = position - 1;
      while (aPos >= 0 && bends.has(path[aPos])) aPos -= 1;
      let bPos = position + 1;
      while (bPos < path.length && bends.has(path[bPos])) bPos += 1;
      if (aPos < 0 || bPos >= path.length) continue;
      const left = path.slice(0, aPos + 1);
      const right = path.slice(bPos);
      const connection = connect(
        left[left.length - 1],
        path[aPos + 1] ?? null,
        right[0],
        path[bPos - 1] ?? null
      );
      const rebuilt = dedupe([
        ...left,
        ...connection.slice(1),
        ...right.slice(1),
      ]);
      if (rebuilt.length >= 2) nextPaths.push(rebuilt);
      continue;
    }
    if (position === 0) {
      let bPos = 1;
      while (bPos < path.length && bends.has(path[bPos])) bPos += 1;
      const nodes = path.slice(bPos);
      tails.push({
        nodes,
        atStart: true,
        nearest: nodes[0] ?? null,
        adjacent: bPos > 0 ? path[bPos - 1] : null,
      });
    } else {
      let aPos = path.length - 2;
      while (aPos >= 0 && bends.has(path[aPos])) aPos -= 1;
      const nodes = path.slice(0, aPos + 1);
      tails.push({
        nodes,
        atStart: false,
        nearest: nodes[nodes.length - 1] ?? null,
        adjacent: aPos + 1 < path.length ? path[aPos + 1] : null,
      });
    }
  }
  if (!removed) {
    return { ok: false, error: 'Вершина не найдена в трассе.' };
  }

  if (tails.length === 1) {
    // Свободный конец: отрезаем только его.
    const tail = dedupe(tails[0].nodes);
    if (tail.length >= 2) nextPaths.push(tail);
  } else if (tails.length === 2) {
    // Соединяем две ветви через удалённую точку. Каждая ветвь
    // ориентируется от дальнего конца к удалённой вершине; между
    // ближайшими видимыми точками ставится ступенька под 90°, если они
    // не лежат на одной оси.
    const usable = tails.filter(
      (tail) => tail.nodes.length > 0 && tail.nearest !== null
    );
    if (usable.length === 1) {
      const tail = dedupe(usable[0].nodes);
      if (tail.length >= 2) nextPaths.push(tail);
    } else if (usable.length === 2) {
      const orient = (tail: {
        nodes: number[];
        atStart: boolean;
      }): number[] => (tail.atStart ? [...tail.nodes].reverse() : [...tail.nodes]);
      const first = orient(usable[0]);
      const second = orient(usable[1]);
      const aIndex = first[first.length - 1];
      const bIndex = second[second.length - 1];
      const connection = connect(
        aIndex,
        usable[0].adjacent,
        bIndex,
        usable[1].adjacent
      );
      const merged = dedupe([
        ...first,
        ...connection.slice(1),
        ...[...second].reverse().slice(1),
      ]);
      if (merged.length >= 2) nextPaths.push(merged);
    }
  }

  next.paths = nextPaths;
  next.bendNodes = [...nextBends];
  const compacted = compactRoute(next);
  if (!compacted) {
    return {
      ok: false,
      error: 'Без этой точки трасса схлопнется. Сбросьте трассу к авто.',
    };
  }
  // Ни один щиток, прибор или стык не должен исчезнуть вместе с точкой.
  if (compacted.anchors.length < clean.anchors.length) {
    return {
      ok: false,
      error: 'Без этой точки трасса схлопнется. Сбросьте трассу к авто.',
    };
  }
  return resultWithRoute(compacted);
}

// ---------------------------------------------------------------------------
// Порядок остановок: список точек и приборов по ветвям
// ---------------------------------------------------------------------------

export type ManualRouteStopKind = ManualRouteAnchorKind | 'point';

export interface ManualRouteStop {
  nodeIndex: number;
  kind: ManualRouteStopKind;
  deviceId?: string;
}

export interface ManualRouteBranch {
  /** Порядок обхода: вершины цепочки, включая отводы к приборам. */
  nodes: number[];
  stops: ManualRouteStop[];
  lengthMm: number;
}

interface RouteBranchWalk {
  nodes: number[];
  edges: Array<[number, number]>;
}

function routeEdgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Обход трассы в реальном порядке кабеля, а не по кускам (paths).
 * Автопрокладка режет линию на много мелких участков: подводка от щитка,
 * участок по стене, отвод к прибору. Пользователю нужен один список на
 * цепочку, поэтому ветвь заканчивается только там, где кабель действительно
 * расходится: щиток, тупик или узел с двумя отводами. Одиночный отвод к
 * прибору вставляется в список сразу за своей точкой на цепочке.
 */
function routeBranchWalks(route: ManualRoute): RouteBranchWalk[] {
  const adjacency = degreeMap(route);
  const allNodes = [...adjacency.keys()].sort((a, b) => a - b);
  const neighborsOf = (node: number): number[] =>
    [...(adjacency.get(node) ?? [])].sort((a, b) => a - b);
  const isLeaf = (node: number): boolean =>
    (adjacency.get(node)?.size ?? 0) === 1;
  const panelNode = route.anchors.find(
    (anchor) => anchor.kind === 'panel'
  )?.nodeIndex;
  // Узел расходящийся, если от него идут два тупика или три направления.
  // Щиток тупиком не считаем: он начало линии, а не отвод к прибору.
  const isFork = (node: number): boolean => {
    let leaves = 0;
    let through = 0;
    for (const neighbor of neighborsOf(node)) {
      if (isLeaf(neighbor) && neighbor !== panelNode) leaves += 1;
      else through += 1;
    }
    return leaves >= 2 || through >= 3;
  };

  const used = new Set<string>();
  const takeEdge = (a: number, b: number): [number, number] => {
    used.add(routeEdgeKey(a, b));
    return [a, b];
  };
  const freeNeighbors = (node: number): number[] =>
    neighborsOf(node).filter(
      (neighbor) => !used.has(routeEdgeKey(node, neighbor))
    );

  const starts: number[] = [];
  const pushStart = (node: number) => {
    if (!starts.includes(node) && (adjacency.get(node)?.size ?? 0) > 0) {
      starts.push(node);
    }
  };
  if (panelNode !== undefined) pushStart(panelNode);
  for (const node of allNodes) if (isFork(node)) pushStart(node);
  for (const node of allNodes) if (isLeaf(node)) pushStart(node);

  const limit = route.nodes.length * 4 + 8;
  const walkFrom = (start: number): RouteBranchWalk => {
    const nodes = [start];
    const edges: Array<[number, number]> = [];
    let current = start;
    for (let step = 0; step < limit; step += 1) {
      const free = freeNeighbors(current);
      if (free.length === 0) break;
      const leaves = free.filter((neighbor) => isLeaf(neighbor));
      const through = free.filter((neighbor) => !isLeaf(neighbor));
      const arrived = nodes.length > 1;
      let next: number;
      if (arrived) {
        // Вернулись в начало ветви — дальше идёт другая ветвь.
        if (current === start) break;
        // Узел ветвления заканчивает ветвь: каждый отвод получит свой список.
        if (isFork(current)) break;
        // Два свободных направления — настоящее ветвление, конец ветви.
        if (leaves.length >= 2 || through.length >= 2) break;
        if (leaves.length === 1) {
          edges.push(takeEdge(current, leaves[0]));
          nodes.push(leaves[0]);
        }
        if (through.length !== 1) break;
        next = through[0];
      } else {
        next = through[0] ?? leaves[0];
      }
      edges.push(takeEdge(current, next));
      nodes.push(next);
      current = next;
    }
    // Читаем ветвь от щитка или от стыка к тупику, а не наоборот.
    if (nodes.length > 1) {
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const startsAtPanel = panelNode !== undefined && first === panelNode;
      const endsAtPanel = panelNode !== undefined && last === panelNode;
      if (
        (endsAtPanel && !startsAtPanel) ||
        (!startsAtPanel && isLeaf(first) && isFork(last))
      ) {
        nodes.reverse();
        edges.reverse();
      }
    }
    return { nodes, edges };
  };

  const walks: RouteBranchWalk[] = [];
  for (const start of starts) {
    if (freeNeighbors(start).length === 0) continue;
    const walk = walkFrom(start);
    if (walk.edges.length > 0) walks.push(walk);
  }
  // Замкнутые контуры и остатки: ни одна грань не теряется из списка.
  for (let guard = 0; guard < limit; guard += 1) {
    const node = allNodes.find(
      (candidate) => freeNeighbors(candidate).length > 0
    );
    if (node === undefined) break;
    const walk = walkFrom(node);
    if (walk.edges.length === 0) break;
    walks.push(walk);
  }
  return walks;
}

/** Видимые остановки цепочки: щиток, приборы, стыки и точки пользователя. */
function routeStopList(
  route: ManualRoute,
  nodeIndexes: number[]
): ManualRouteStop[] {
  const bends = bendNodeSet(route);
  const anchorByNode = new Map<number, ManualRouteAnchor>();
  for (const anchor of route.anchors) {
    const existing = anchorByNode.get(anchor.nodeIndex);
    if (
      !existing ||
      ANCHOR_PRIORITY[anchor.kind] < ANCHOR_PRIORITY[existing.kind]
    ) {
      anchorByNode.set(anchor.nodeIndex, anchor);
    }
  }
  const stops: ManualRouteStop[] = [];
  for (const nodeIndex of nodeIndexes) {
    if (bends.has(nodeIndex)) continue;
    if (stops.length > 0 && stops[stops.length - 1].nodeIndex === nodeIndex) {
      continue;
    }
    const anchor = anchorByNode.get(nodeIndex);
    if (anchor?.kind === 'device' && anchor.deviceId) {
      stops.push({ nodeIndex, kind: 'device', deviceId: anchor.deviceId });
    } else {
      stops.push({ nodeIndex, kind: anchor ? anchor.kind : 'point' });
    }
  }
  return stops;
}

/**
 * Ветви трассы для списка порядка. В список попадают только видимые
 * остановки: щиток, приборы, стыки и точки пользователя. Служебные изгибы
 * под 90° в список не входят — они не точки и не переставляются.
 */
export function manualRouteBranches(route: ManualRoute): ManualRouteBranch[] {
  const clean = sanitizeManualRoute(route);
  if (!clean) return [];
  return routeBranchWalks(clean).map((walk) => {
    let lengthMm = 0;
    for (const [a, b] of walk.edges) {
      lengthMm += distance(clean.nodes[a], clean.nodes[b]);
    }
    return {
      nodes: walk.nodes,
      stops: routeStopList(clean, walk.nodes),
      lengthMm,
    };
  });
}

/**
 * Переставляет остановку внутри одной ветви и перестраивает только её.
 * Координаты щитка, приборов, стыков и точек не меняются: меняется только
 * порядок обхода. Между соседними остановками линия строится под 90°:
 * если оси не совпадают, добавляется скрытая ступенька (служебный изгиб).
 * Остальные ветви, приборы на плане и сам щиток остаются нетронутыми.
 * Щиток всегда стоит первым в своей ветви — это начало линии.
 */
export function reorderManualRouteStops(
  route: ManualRoute,
  branchIndex: number,
  fromIndex: number,
  toIndex: number
): ManualRouteResult {
  const clean = sanitizeManualRoute(route);
  if (!clean) {
    return { ok: false, error: 'Ручная трасса повреждена и не может быть изменена.' };
  }
  const walks = routeBranchWalks(clean);
  if (
    !Number.isInteger(branchIndex) ||
    branchIndex < 0 ||
    branchIndex >= walks.length
  ) {
    return { ok: false, error: 'Ветвь не найдена.' };
  }
  const walk = walks[branchIndex];
  const stops = routeStopList(clean, walk.nodes);
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= stops.length ||
    toIndex >= stops.length
  ) {
    return { ok: false, error: 'Точка не найдена в списке ветви.' };
  }
  if (fromIndex === toIndex) return { ok: true, route: clean };
  if (stops.length < 2) {
    return { ok: false, error: 'В ветви нет что переставлять.' };
  }

  const moved = stops[fromIndex];
  if (moved.kind === 'panel') {
    return {
      ok: false,
      error: 'Щиток — начало линии, его нельзя переставить. Двигайте приборы и точки.',
    };
  }
  if (stops[0].kind === 'panel' && toIndex === 0) {
    return {
      ok: false,
      error: 'Первым в ветви стоит щиток: перед ним точку не поставить.',
    };
  }

  const ordered = [...stops];
  ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);

  const next = cloneRoute(clean);
  const nextBends = new Set<number>(bendNodeSet(clean));
  const rebuilt: number[] = [ordered[0].nodeIndex];
  for (let i = 1; i < ordered.length; i++) {
    const previous = clean.nodes[ordered[i - 1].nodeIndex];
    const current = clean.nodes[ordered[i].nodeIndex];
    if (samePoint(previous, current) || orientation(previous, current) !== 'slanted') {
      rebuilt.push(ordered[i].nodeIndex);
      continue;
    }
    // Ступенька под 90°: сначала по горизонтали, затем по вертикали.
    const elbowIndex = next.nodes.length;
    next.nodes.push({ x: current.x, y: previous.y });
    nextBends.add(elbowIndex);
    rebuilt.push(elbowIndex, ordered[i].nodeIndex);
  }
  if (rebuilt.length < 2) {
    return { ok: false, error: 'После перестановки ветвь схлопнется.' };
  }

  // Меняем только грань, входящую в эту ветвь. Остальные участки кабеля
  // остаются как были: если ветвь перекрывала кусок участка, он делится,
  // но его геометрия не перестраивается.
  const covered = new Set(walk.edges.map(([a, b]) => routeEdgeKey(a, b)));
  const keptPaths: number[][] = [];
  for (const path of clean.paths) {
    let run: number[] = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (covered.has(routeEdgeKey(a, b))) {
        if (run.length >= 2) keptPaths.push(run);
        run = [];
        continue;
      }
      if (run.length === 0) run = [a, b];
      else run.push(b);
    }
    if (run.length >= 2) keptPaths.push(run);
  }
  keptPaths.push(rebuilt);

  next.paths = keptPaths;
  next.bendNodes = [...nextBends];
  const compacted = compactRoute(next, { removeCollinear: true });
  if (!compacted) {
    return { ok: false, error: 'После перестановки ветвь схлопнется.' };
  }

  // Точки подключения не должны потеряться при перестановке.
  for (const anchor of clean.anchors) {
    if (anchor.kind === 'junction') continue;
    const kept = compacted.anchors.some(
      (candidate) =>
        candidate.kind === anchor.kind &&
        candidate.deviceId === anchor.deviceId &&
        samePoint(
          compacted.nodes[candidate.nodeIndex],
          clean.nodes[anchor.nodeIndex]
        )
    );
    if (!kept) {
      return {
        ok: false,
        error: 'Перестановка потеряла бы точку подключения. Отмените действие.',
      };
    }
  }

  // Стыки приводим к новой геометрии: узел ветвления получает стык,
  // а бывший стык, через который кабель теперь идёт насквозь, теряет его.
  const degrees = degreeMap(compacted);
  const anchored = anchorNodeSet(compacted);
  const anchors = compacted.anchors.filter(
    (anchor) =>
      anchor.kind !== 'junction' || (degrees.get(anchor.nodeIndex)?.size ?? 0) > 2
  );
  for (const [nodeIndex, neighbors] of degrees) {
    if (neighbors.size > 2 && !anchored.has(nodeIndex)) {
      anchors.push({ nodeIndex, kind: 'junction' });
    }
  }
  compacted.anchors = normalizeAnchors(anchors, compacted.nodes.length);
  return resultWithRoute(compacted);
}

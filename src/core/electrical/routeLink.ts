import type {
  FreePartition,
  ManualRoute,
  ManualRouteAnchor,
  Point2D,
  RoomZone,
} from '../../types';
import { distance, isPointInPolygon, projectPointOnSegment } from '../geometry/math';
import {
  isManualRouteOrthogonal,
  sanitizeManualRoute,
  validateManualRoute,
} from './manualRoute';

// Допуск совпадения вершин при соединении, мм.
export const ROUTE_LINK_EPS_MM = 0.5;
const JUNCTION_WALL_GAP_MM = 40;
const JUNCTION_PARTITION_GAP_MM = 40;

export type RouteLinkAxis = 'h' | 'v';

export type RouteLinkEndpointKind = 'panel' | 'device' | 'junction' | 'point';

export interface RouteLinkEndpoint {
  kind: RouteLinkEndpointKind;
  point: Point2D;
  deviceId?: string;
}

export type RouteLinkResult =
  | { ok: true; route: ManualRoute; warnings: string[] }
  | { ok: false; error: string };

export type RouteJunctionInsertResult =
  | { ok: true; route: ManualRoute }
  | { ok: false; reason: 'not-on-route' | 'invalid'; error: string };

function samePoint(a: Point2D, b: Point2D): boolean {
  return distance(a, b) <= ROUTE_LINK_EPS_MM;
}

function finitePoint(point: Point2D): boolean {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// Ортогональная связь: одна нога (если точки на одной оси) или ступенька.
// axisFirst задаёт, какая нога идёт первой; обе ноги строго по осям.
export function orthogonalLinkPoints(
  from: Point2D,
  to: Point2D,
  axisFirst: RouteLinkAxis
): Point2D[] {
  if (!finitePoint(from) || !finitePoint(to)) return [];
  if (samePoint(from, to)) return [];
  const horizontal = Math.abs(from.y - to.y) <= ROUTE_LINK_EPS_MM;
  const vertical = Math.abs(from.x - to.x) <= ROUTE_LINK_EPS_MM;
  if (horizontal || vertical) return [{ x: from.x, y: from.y }, { ...to }];
  const elbow =
    axisFirst === 'h'
      ? { x: to.x, y: from.y }
      : { x: from.x, y: to.y };
  return [{ x: from.x, y: from.y }, elbow, { ...to }];
}

/**
 * Соединяет две точки трассы. Существующая геометрия не удаляется:
 * новая связь добавляется к ней, а щиток или прибор при необходимости
 * переносится в новую точку (после переезда на плане).
 */
export function linkManualRoute(
  base: ManualRoute | null,
  from: RouteLinkEndpoint,
  to: RouteLinkEndpoint,
  axisFirst: RouteLinkAxis
): RouteLinkResult {
  if (!finitePoint(from.point) || !finitePoint(to.point)) {
    return { ok: false, error: 'Не удалось определить точку соединения.' };
  }
  if (samePoint(from.point, to.point)) {
    return { ok: false, error: 'Выберите две разные точки.' };
  }
  if (from.kind === 'panel' && to.kind === 'panel') {
    return { ok: false, error: 'Щиток нельзя соединить сам с собой.' };
  }
  if (
    (from.kind === 'device' && !from.deviceId) ||
    (to.kind === 'device' && !to.deviceId)
  ) {
    return { ok: false, error: 'У прибора нет идентификатора для подключения.' };
  }

  const nodes: Point2D[] = (base?.nodes ?? []).map((point) => ({ ...point }));
  const paths: number[][] = (base?.paths ?? []).map((path) => [...path]);
  const anchors: ManualRouteAnchor[] = (base?.anchors ?? []).map((anchor) => ({
    ...anchor,
  }));
  const findNode = (point: Point2D): number | null => {
    for (let i = 0; i < nodes.length; i++) {
      if (samePoint(nodes[i], point)) return i;
    }
    return null;
  };
  const addNode = (point: Point2D): number => {
    nodes.push({ x: point.x, y: point.y });
    return nodes.length - 1;
  };
  const fromNode = findNode(from.point);
  const toNode = findNode(to.point);

  if (fromNode !== null && toNode !== null) {
    const adjacency = new Map<number, Set<number>>();
    for (const path of paths) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a)?.add(b);
        adjacency.get(b)?.add(a);
      }
    }
    const seen = new Set<number>([fromNode]);
    const queue = [fromNode];
    while (queue.length > 0) {
      const node = queue.pop() as number;
      for (const neighbor of adjacency.get(node) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    if (seen.has(toNode)) {
      return {
        ok: false,
        error: 'Эти точки уже соединены — кольцо прокладывать не нужно.',
      };
    }
  }

  const ensureAnchor = (
    endpoint: RouteLinkEndpoint,
    nodeIndex: number
  ): void => {
    if (endpoint.kind === 'point') return;
    if (endpoint.kind === 'device') {
      for (let i = anchors.length - 1; i >= 0; i--) {
        if (
          anchors[i].kind === 'device' &&
          anchors[i].deviceId === endpoint.deviceId
        ) {
          anchors.splice(i, 1);
        }
      }
      anchors.push({
        nodeIndex,
        kind: 'device',
        deviceId: endpoint.deviceId,
      });
      return;
    }
    if (endpoint.kind === 'panel') {
      for (let i = anchors.length - 1; i >= 0; i--) {
        if (anchors[i].kind === 'panel') anchors.splice(i, 1);
      }
      anchors.push({ nodeIndex, kind: 'panel' });
      return;
    }
    if (
      !anchors.some(
        (anchor) => anchor.kind === 'junction' && anchor.nodeIndex === nodeIndex
      )
    ) {
      anchors.push({ nodeIndex, kind: 'junction' });
    }
  };

  const startNode = fromNode ?? addNode(from.point);
  ensureAnchor(from, startNode);
  const endNode = toNode ?? addNode(to.point);
  ensureAnchor(to, endNode);

  const points = orthogonalLinkPoints(from.point, to.point, axisFirst);
  if (points.length < 2) {
    return { ok: false, error: 'Не удалось построить связь под 90°.' };
  }
  const chain: number[] = [startNode];
  for (const point of points.slice(1, -1)) {
    const existing = findNode(point);
    chain.push(existing ?? addNode(point));
  }
  chain.push(endNode);

  const existingEdges = new Set<string>();
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      existingEdges.add(edgeKey(path[i - 1], path[i]));
    }
  }
  for (const [a, b] of chain.reduce<Array<[number, number]>>(
    (edges, node, index) => {
      if (index > 0) edges.push([chain[index - 1], node]);
      return edges;
    },
    []
  )) {
    if (existingEdges.has(edgeKey(a, b))) {
      return {
        ok: false,
        error: 'Эти точки уже соединены напрямую.',
      };
    }
  }

  const cleanChain = chain.filter(
    (node, index) => index === 0 || node !== chain[index - 1]
  );
  if (cleanChain.length < 2) {
    return { ok: false, error: 'Точки соединения совпали — связь не добавлена.' };
  }
  paths.push(cleanChain);

  // Ветвление превращает обычный угол в узел: на плане он выглядит
  // распределительной коробкой и его можно двигать.
  const degrees = new Map<number, Set<number>>();
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (!degrees.has(a)) degrees.set(a, new Set());
      if (!degrees.has(b)) degrees.set(b, new Set());
      degrees.get(a)?.add(b);
      degrees.get(b)?.add(a);
    }
  }
  for (const [nodeIndex, neighbors] of degrees) {
    if (neighbors.size <= 2) continue;
    if (
      !anchors.some(
        (anchor) => anchor.kind === 'junction' && anchor.nodeIndex === nodeIndex
      )
    ) {
      anchors.push({ nodeIndex, kind: 'junction' });
    }
  }

  const candidate: ManualRoute = { nodes, paths, anchors };
  if (validateManualRoute(candidate)) {
    return { ok: false, error: 'Связь не добавлена: трасса повреждена.' };
  }
  const route = sanitizeManualRoute(candidate);
  if (!route) {
    return { ok: false, error: 'Связь не добавлена: трасса схлопнулась.' };
  }
  if (!isManualRouteOrthogonal(route)) {
    return { ok: false, error: 'Связь получилась не под 90° — попробуйте ещё раз.' };
  }

  const warnings: string[] = [];
  const junctionDegree = new Map<number, number>();
  const deviceDegree = new Map<string, number>();
  for (const path of route.paths) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      junctionDegree.set(a, (junctionDegree.get(a) ?? 0) + 1);
      junctionDegree.set(b, (junctionDegree.get(b) ?? 0) + 1);
    }
  }
  for (const anchor of route.anchors) {
    if (anchor.kind === 'junction' && (junctionDegree.get(anchor.nodeIndex) ?? 0) > 6) {
      warnings.push('В узле больше шести направлений — проверьте соединение.');
      break;
    }
    if (anchor.kind === 'device' && anchor.deviceId) {
      deviceDegree.set(anchor.deviceId, (junctionDegree.get(anchor.nodeIndex) ?? 0));
    }
  }
  if ([...deviceDegree.values()].some((degree) => degree > 3)) {
    warnings.push('К прибору подходит больше трёх кабелей — проверьте соединение.');
  }

  return { ok: true, route, warnings };
}

/**
 * Ставит узел на существующий участок: в вершину или внутрь отрезка.
 * Если точка не лежит на трассе, стор вызывает добавление свободного узла.
 */
export function insertJunctionIntoRoute(
  route: ManualRoute,
  point: Point2D
): RouteJunctionInsertResult {
  const clean = sanitizeManualRoute(route);
  if (!clean) {
    return { ok: false, reason: 'invalid', error: 'Трасса повреждена.' };
  }
  const nodes = clean.nodes.map((node) => ({ ...node }));
  const paths = clean.paths.map((path) => [...path]);
  const anchors = clean.anchors.map((anchor) => ({ ...anchor }));

  let nodeIndex = nodes.findIndex((node) => samePoint(node, point));
  if (nodeIndex < 0) {
    let best: {
      pathIndex: number;
      position: number;
      point: Point2D;
      distance: number;
    } | null = null;
    paths.forEach((path, pathIndex) => {
      for (let i = 1; i < path.length; i++) {
        const a = nodes[path[i - 1]];
        const b = nodes[path[i]];
        const projection = projectPointOnSegment(point, a, b);
        if (projection.distance > ROUTE_LINK_EPS_MM) continue;
        if (projection.t <= 0.001 || projection.t >= 0.999) continue;
        if (best && best.distance <= projection.distance) continue;
        best = {
          pathIndex,
          position: i,
          point: projection.point,
          distance: projection.distance,
        };
      }
    });
    if (!best) {
      return {
        ok: false,
        reason: 'not-on-route',
        error: 'Точка не лежит на трассе.',
      };
    }
    const hit = best as {
      pathIndex: number;
      position: number;
      point: Point2D;
    };
    nodes.push({ x: hit.point.x, y: hit.point.y });
    nodeIndex = nodes.length - 1;
    paths[hit.pathIndex].splice(hit.position, 0, nodeIndex);
  }

  if (
    !anchors.some(
      (anchor) => anchor.kind === 'junction' && anchor.nodeIndex === nodeIndex
    )
  ) {
    anchors.push({ nodeIndex, kind: 'junction' });
  }
  const next = sanitizeManualRoute({ nodes, paths, anchors });
  if (!next) {
    return { ok: false, reason: 'invalid', error: 'Узел не добавлен: трасса повреждена.' };
  }
  return { ok: true, route: next };
}

function pointInRoom(point: Point2D, room: RoomZone): boolean {
  if (!isPointInPolygon(point, room.vertices)) return false;
  return !(room.holes ?? []).some((hole) => isPointInPolygon(point, hole));
}

function distanceToRing(point: Point2D, ring: Point2D[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const projection = projectPointOnSegment(
      point,
      ring[i],
      ring[(i + 1) % ring.length]
    );
    if (projection.distance < best) best = projection.distance;
  }
  return best;
}

/** Проверка свободного узла: только внутри комнаты, не в стене и не в перегородке. */
export function routeJunctionPlacementError(
  point: Point2D,
  rooms: RoomZone[],
  partitions: FreePartition[]
): string | null {
  if (!finitePoint(point)) return 'Не удалось определить точку узла.';
  if (rooms.length === 0) return 'Сначала нарисуйте комнату.';
  const room = rooms.find((candidate) => pointInRoom(point, candidate));
  if (!room) return 'Узел можно ставить только внутри комнаты.';
  if (distanceToRing(point, room.vertices) < JUNCTION_WALL_GAP_MM) {
    return 'Слишком близко к стене — отодвиньте узел в комнату.';
  }
  for (const hole of room.holes ?? []) {
    if (distanceToRing(point, hole) < JUNCTION_WALL_GAP_MM) {
      return 'Слишком близко к краю проёма — отодвиньте узел.';
    }
  }
  for (const partition of partitions) {
    const projection = projectPointOnSegment(point, partition.p1, partition.p2);
    if (projection.distance < partition.thicknessMm / 2 + JUNCTION_PARTITION_GAP_MM) {
      return 'Узел попадает в перегородку — выберите другое место.';
    }
  }
  return null;
}

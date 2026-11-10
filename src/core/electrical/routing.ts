import type {
  CircuitLine,
  ElectricalDevice,
  ElectricalPanel,
  FreePartition,
  LineRouting,
  Node2D,
  Point2D,
  ProjectSettings,
  RoomZone,
  Wall,
} from '../../types';
import { distance, isPointInPolygon, projectPointOnSegment } from '../geometry/math';
import { resolveDevice, type ResolvedDevice } from './devices';
import { resolvePanelPose } from './panel';

// Запас на подключение в щитке и разделку жил, мм на линию.
export const PANEL_CABLE_RESERVE_MM = 1500;

// Отступ трассы от внутренней грани стены, мм.
export const ROUTE_WALL_GAP_MM = 80;

export interface LineRoute {
  lineId: string;
  mode: LineRouting;
  cableLengthMm: number;
  planLengthMm: number;
  verticalMm: number;
  deviceCount: number;
  paths: Point2D[][];
  warning: string | null;
}

export interface LineRouteInput {
  panel: ElectricalPanel | null;
  devices: ElectricalDevice[];
  rooms: RoomZone[];
  partitions: FreePartition[];
  nodes: Record<string, Node2D>;
  walls: Wall[];
  settings: ProjectSettings;
}

interface GraphEdge {
  to: string;
  weightMm: number;
}

interface RouteGraph {
  points: Map<string, Point2D>;
  adjacency: Map<string, GraphEdge[]>;
  attachmentNodes: Map<string, string>;
}

interface WallGeometry {
  wall: Wall;
  a: Point2D;
  b: Point2D;
  lengthMm: number;
}

interface AttachmentSource {
  key: string;
  point: Point2D;
}

function polylineLength(points: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function orthogonalPath(from: Point2D, to: Point2D): Point2D[] {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx < 1 || dy < 1) return [from, to];
  return [from, { x: to.x, y: from.y }, to];
}

function samePoint(a: Point2D, b: Point2D): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

// Угловые перемычки оставляют на плане короткий «клюв»: путь доходит до
// грани стены и возвращается. Убираем развороты на 180° и лишние точки
// на одной прямой, чтобы угол читался как обычный поворот трассы.
function simplifyRoutePath(points: Point2D[]): Point2D[] {
  const reversed: Point2D[] = [];
  for (const point of points) {
    if (reversed.length > 0 && samePoint(reversed[reversed.length - 1], point)) {
      continue;
    }
    reversed.push(point);
    while (reversed.length >= 3) {
      const a = reversed[reversed.length - 3];
      const b = reversed[reversed.length - 2];
      const c = reversed[reversed.length - 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;
      const cross = abx * bcy - aby * bcx;
      const dot = abx * bcx + aby * bcy;
      if (Math.abs(cross) < 0.5 && dot < 0) {
        reversed.splice(reversed.length - 2, 1);
        continue;
      }
      break;
    }
  }

  const result: Point2D[] = [];
  for (const point of reversed) {
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = point.x - b.x;
      const bcy = point.y - b.y;
      const cross = abx * bcy - aby * bcx;
      const dot = abx * bcx + aby * bcy;
      if (Math.abs(cross) < 0.5 && dot > 0) {
        result.pop();
        continue;
      }
      break;
    }
    result.push(point);
  }
  return result;
}

function addNode(
  graph: RouteGraph,
  id: string,
  point: Point2D
): void {
  if (!graph.points.has(id)) graph.points.set(id, point);
  if (!graph.adjacency.has(id)) graph.adjacency.set(id, []);
}

function addEdge(
  graph: RouteGraph,
  from: string,
  to: string,
  weightMm: number
): void {
  if (from === to || weightMm < 0.5) return;
  graph.adjacency.get(from)?.push({ to, weightMm });
  graph.adjacency.get(to)?.push({ to: from, weightMm });
}

function wallGeometries(
  nodes: Record<string, Node2D>,
  walls: Wall[]
): WallGeometry[] {
  const result: WallGeometry[] = [];
  for (const wall of walls) {
    const a = nodes[wall.nodeAId];
    const b = nodes[wall.nodeBId];
    if (!a || !b) continue;
    const lengthMm = distance(a, b);
    if (lengthMm < 1) continue;
    result.push({
      wall,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      lengthMm,
    });
  }
  return result;
}

function nearestWall(
  point: Point2D,
  walls: WallGeometry[]
): { wallIndex: number; point: Point2D; stationMm: number; distanceMm: number } | null {
  let best: {
    wallIndex: number;
    point: Point2D;
    stationMm: number;
    distanceMm: number;
  } | null = null;

  walls.forEach((wall, wallIndex) => {
    const projection = projectPointOnSegment(point, wall.a, wall.b);
    if (!best || projection.distance < best.distanceMm) {
      best = {
        wallIndex,
        point: projection.point,
        stationMm: projection.t * wall.lengthMm,
        distanceMm: projection.distance,
      };
    }
  });

  return best;
}

function nearestFloorBoundary(
  point: Point2D,
  rooms: RoomZone[]
): Point2D | null {
  let bestPoint: Point2D | null = null;
  let bestDistance = Infinity;

  for (const room of rooms) {
    const ring = room.vertices;
    if (!ring || ring.length < 3) continue;
    for (let i = 0; i < ring.length; i++) {
      const projection = projectPointOnSegment(
        point,
        ring[i],
        ring[(i + 1) % ring.length]
      );
      if (projection.distance < bestDistance) {
        bestDistance = projection.distance;
        bestPoint = projection.point;
      }
    }
  }

  return bestPoint;
}

// Оси стен лежат в толще стены. Сдвигаем узлы графа от оси к ближайшему
// полу и ещё на ROUTE_WALL_GAP_MM, чтобы трасса шла по комнате, а не по стене.
function offsetGraphIntoRooms(graph: RouteGraph, rooms: RoomZone[]): void {
  if (rooms.length === 0) return;

  for (const [id, point] of graph.points.entries()) {
    if (rooms.some((room) => isPointInPolygon(point, room.vertices))) continue;
    const boundary = nearestFloorBoundary(point, rooms);
    if (!boundary) continue;

    const dx = boundary.x - point.x;
    const dy = boundary.y - point.y;
    const span = Math.hypot(dx, dy);
    if (span < 0.5) continue;

    const shift = span + ROUTE_WALL_GAP_MM;
    graph.points.set(id, {
      x: point.x + (dx / span) * shift,
      y: point.y + (dy / span) * shift,
    });
  }

  for (const [fromId, edges] of graph.adjacency.entries()) {
    const from = graph.points.get(fromId);
    if (!from) continue;
    for (const edge of edges) {
      const to = graph.points.get(edge.to);
      if (to) edge.weightMm = distance(from, to);
    }
  }
}

function buildRouteGraph(
  nodes: Record<string, Node2D>,
  walls: Wall[],
  rooms: RoomZone[],
  attachments: AttachmentSource[],
  bridgeToleranceMm: number
): RouteGraph | null {
  const geometries = wallGeometries(nodes, walls);
  if (geometries.length === 0) return null;

  const graph: RouteGraph = {
    points: new Map(),
    adjacency: new Map(),
    attachmentNodes: new Map(),
  };

  for (const geometry of geometries) {
    addNode(graph, geometry.wall.nodeAId, geometry.a);
    addNode(graph, geometry.wall.nodeBId, geometry.b);
  }

  const splitsByWall = new Map<number, { key: string; stationMm: number }[]>();
  for (const attachment of attachments) {
    const nearest = nearestWall(attachment.point, geometries);
    if (!nearest) continue;
    const list = splitsByWall.get(nearest.wallIndex) ?? [];
    list.push({ key: attachment.key, stationMm: nearest.stationMm });
    splitsByWall.set(nearest.wallIndex, list);
  }

  let syntheticCounter = 0;

  geometries.forEach((geometry, wallIndex) => {
    const { wall, a, b, lengthMm } = geometry;
    const attachmentsOnWall = splitsByWall.get(wallIndex) ?? [];

    const stations = [
      0,
      lengthMm,
      ...attachmentsOnWall.map((item) =>
        Math.max(0, Math.min(lengthMm, item.stationMm))
      ),
    ].sort((left, right) => left - right);

    const uniqueStations: number[] = [];
    for (const station of stations) {
      const previous = uniqueStations[uniqueStations.length - 1];
      if (previous === undefined || station - previous > 1) {
        uniqueStations.push(station);
      }
    }
    if (uniqueStations[uniqueStations.length - 1] !== lengthMm) {
      uniqueStations.push(lengthMm);
    }

    const dir = {
      x: (b.x - a.x) / lengthMm,
      y: (b.y - a.y) / lengthMm,
    };

    const stationNodeIds = uniqueStations.map((station) => {
      if (station <= 1) return wall.nodeAId;
      if (lengthMm - station <= 1) return wall.nodeBId;
      syntheticCounter += 1;
      const id = `route-node-${syntheticCounter}`;
      addNode(graph, id, {
        x: a.x + dir.x * station,
        y: a.y + dir.y * station,
      });
      return id;
    });

    for (let i = 1; i < uniqueStations.length; i++) {
      addEdge(
        graph,
        stationNodeIds[i - 1],
        stationNodeIds[i],
        uniqueStations[i] - uniqueStations[i - 1]
      );
    }

    for (const item of attachmentsOnWall) {
      const station =
        item.stationMm <= 1
          ? 0
          : lengthMm - item.stationMm <= 1
            ? lengthMm
            : Math.max(0, Math.min(lengthMm, item.stationMm));
      let bestIndex = 0;
      let bestDelta = Infinity;
      uniqueStations.forEach((candidate, index) => {
        const delta = Math.abs(candidate - station);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIndex = index;
        }
      });
      graph.attachmentNodes.set(item.key, stationNodeIds[bestIndex]);
    }
  });

  // Сначала уводим оси стен в комнаты, и только потом строим угловые
  // перемычки: иначе перемычка остаётся на грани стены и трасса делает
  // крюк к стене и обратно.
  offsetGraphIntoRooms(graph, rooms);

  // В авто-режиме оси стен смещены наружу от пола, поэтому на углах
  // остаются разрывы. Связываем близкие узлы ортогональными перемычками.
  const endpointIds = new Set<string>();
  for (const geometry of geometries) {
    endpointIds.add(geometry.wall.nodeAId);
    endpointIds.add(geometry.wall.nodeBId);
  }
  const endpointList = [...endpointIds];

  const directPairs = new Set(
    geometries.map((geometry) => {
      const a = geometry.wall.nodeAId;
      const b = geometry.wall.nodeBId;
      return a < b ? `${a}--${b}` : `${b}--${a}`;
    })
  );

  for (let i = 0; i < endpointList.length; i++) {
    for (let j = i + 1; j < endpointList.length; j++) {
      const aId = endpointList[i];
      const bId = endpointList[j];
      const pairKey = aId < bId ? `${aId}--${bId}` : `${bId}--${aId}`;
      if (directPairs.has(pairKey)) continue;

      const a = graph.points.get(aId);
      const b = graph.points.get(bId);
      if (!a || !b) continue;
      const span = distance(a, b);
      if (span < 1 || span > bridgeToleranceMm) continue;

      // Из двух прямоугольных углов берём тот, что лежит внутри пола:
      // второй остаётся на грани стены и даёт петлю на плане.
      const cornerOptions = [
        { x: a.x, y: b.y },
        { x: b.x, y: a.y },
      ];
      const corner =
        cornerOptions.find((option) =>
          rooms.some((room) => isPointInPolygon(option, room.vertices))
        ) ?? cornerOptions[0];
      let cornerNodeId: string | null = null;
      for (const [nodeId, point] of graph.points.entries()) {
        if (distance(point, corner) < 1) {
          cornerNodeId = nodeId;
          break;
        }
      }

      if (!cornerNodeId) {
        syntheticCounter += 1;
        cornerNodeId = `route-corner-${syntheticCounter}`;
        addNode(graph, cornerNodeId, corner);
      }

      addEdge(graph, aId, cornerNodeId, distance(a, corner));
      addEdge(graph, cornerNodeId, bId, distance(corner, b));
    }
  }

  return graph;
}

function dijkstra(
  graph: RouteGraph,
  startId: string
): { distances: Map<string, number>; previous: Map<string, string | null> } {
  const distances = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const unvisited = new Set<string>();

  for (const id of graph.points.keys()) {
    distances.set(id, Infinity);
    previous.set(id, null);
    unvisited.add(id);
  }

  if (distances.has(startId)) distances.set(startId, 0);

  while (unvisited.size > 0) {
    let currentId: string | null = null;
    let currentDistance = Infinity;
    for (const id of unvisited) {
      const candidate = distances.get(id) ?? Infinity;
      if (candidate < currentDistance) {
        currentDistance = candidate;
        currentId = id;
      }
    }
    if (currentId === null || currentDistance === Infinity) break;
    unvisited.delete(currentId);

    for (const edge of graph.adjacency.get(currentId) ?? []) {
      if (!unvisited.has(edge.to)) continue;
      const nextDistance = currentDistance + edge.weightMm;
      if (nextDistance < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, currentId);
      }
    }
  }

  return { distances, previous };
}

function pathPoints(
  graph: RouteGraph,
  previous: Map<string, string | null>,
  startId: string,
  endId: string
): Point2D[] | null {
  const ids: string[] = [];
  let current: string | null = endId;
  while (current !== null) {
    ids.push(current);
    if (current === startId) break;
    current = previous.get(current) ?? null;
  }
  if (ids[ids.length - 1] !== startId) return null;
  ids.reverse();
  return ids
    .map((id) => graph.points.get(id))
    .filter((point): point is Point2D => point !== undefined);
}

function shortestPath(
  graph: RouteGraph,
  startId: string,
  endId: string
): { points: Point2D[]; distanceMm: number } | null {
  if (startId === endId) {
    const point = graph.points.get(startId);
    return point ? { points: [point], distanceMm: 0 } : null;
  }
  const { distances, previous } = dijkstra(graph, startId);
  const total = distances.get(endId) ?? Infinity;
  if (!Number.isFinite(total)) return null;
  const points = pathPoints(graph, previous, startId, endId);
  if (!points) return null;
  return { points, distanceMm: total };
}

function routeMode(line: CircuitLine, settings: ProjectSettings): LineRouting {
  return line.routing === 'floor' || line.routing === 'ceiling'
    ? line.routing
    : settings.defaultRouting;
}

function deviceMountHeightMm(
  resolved: ResolvedDevice,
  settings: ProjectSettings
): number {
  return resolved.device.type === 'light_ceiling'
    ? settings.ceilingHeightMm
    : resolved.device.heightFromFloorMm;
}

function appendPath(paths: Point2D[][], points: Point2D[]): number {
  const simplified = simplifyRoutePath(points);
  if (simplified.length < 2) return 0;
  paths.push(simplified);
  return polylineLength(simplified);
}

export function computeLineRoutes(input: LineRouteInput): Map<string, LineRoute> {
  const routes = new Map<string, LineRoute>();
  const { panel, settings } = input;
  if (!panel) return routes;

  const thickness = settings.defaultWallThicknessMm;
  const panelPose = resolvePanelPose(panel, input.rooms, input.partitions, thickness);
  if (!panelPose) return routes;

  const resolvedDevices = new Map<string, ResolvedDevice>();
  for (const device of input.devices) {
    const resolved = resolveDevice(device, input.rooms, input.partitions, thickness);
    if (resolved) resolvedDevices.set(device.id, resolved);
  }

  const attachments: AttachmentSource[] = [
    { key: 'panel', point: panelPose.position },
  ];
  for (const resolved of resolvedDevices.values()) {
    const pose = resolved.poses[0];
    if (pose) attachments.push({ key: `device:${resolved.device.id}`, point: pose.position });
  }

  const graph = buildRouteGraph(
    input.nodes,
    input.walls,
    input.rooms,
    attachments,
    Math.max(250, thickness * 1.5)
  );

  for (const line of panel.lines) {
    const mode = routeMode(line, settings);
    const runHeightMm =
      mode === 'ceiling' ? settings.ceilingHeightMm : settings.floorLevelMm;
    const paths: Point2D[][] = [];
    let planLengthMm = 0;
    let verticalMm = Math.abs(panel.heightFromFloorMm - runHeightMm);
    let warning: string | null = graph
      ? null
      : 'Нет графа стен: трасса и длина посчитаны по прямым участкам.';

    const lineDevices = line.deviceIds
      .map((deviceId) => resolvedDevices.get(deviceId))
      .filter((resolved): resolved is ResolvedDevice => resolved !== undefined);

    if (lineDevices.length < line.deviceIds.length) {
      warning = warning
        ? `${warning} Часть приборов линии не найдена на плане.`
        : 'Часть приборов линии не найдена на плане.';
    }

    if (lineDevices.length === 0) {
      routes.set(line.id, {
        lineId: line.id,
        mode,
        cableLengthMm: 0,
        planLengthMm: 0,
        verticalMm: 0,
        deviceCount: 0,
        paths: [],
        warning: null,
      });
      continue;
    }

    const panelNodeId = graph?.attachmentNodes.get('panel') ?? null;
    const panelAttachmentPoint = panelNodeId
      ? graph?.points.get(panelNodeId) ?? null
      : null;

    // Точки пользователя не проецируем на стены: это обязательные вершины магистрали.
    const waypoints = (line.waypoints ?? []).filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
    );
    const hasWaypoints = waypoints.length > 0;
    const lastWaypoint = hasWaypoints ? waypoints[waypoints.length - 1] : null;

    let currentNodeId = hasWaypoints ? null : panelNodeId;
    let currentAttachPoint = lastWaypoint ?? panelAttachmentPoint ?? panelPose.position;
    let currentPoint = lastWaypoint ?? panelPose.position;

    if (hasWaypoints) {
      let from = panelPose.position;
      for (const waypoint of waypoints) {
        planLengthMm += appendPath(paths, orthogonalPath(from, waypoint));
        from = waypoint;
      }
    } else if (panelAttachmentPoint) {
      const connector = orthogonalPath(panelPose.position, panelAttachmentPoint);
      planLengthMm += appendPath(paths, connector);
    }

    const queue = [...lineDevices];
    const ordered: ResolvedDevice[] = [];
    while (queue.length > 0) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      queue.forEach((resolved, index) => {
        const pose = resolved.poses[0];
        if (!pose) return;
        const candidateDistance = distance(currentPoint, pose.position);
        if (candidateDistance < bestDistance) {
          bestDistance = candidateDistance;
          bestIndex = index;
        }
      });
      const [nextDevice] = queue.splice(bestIndex, 1);
      if (nextDevice) ordered.push(nextDevice);
    }

    for (const resolved of ordered) {
      const pose = resolved.poses[0];
      if (!pose) continue;

      const deviceKey = `device:${resolved.device.id}`;
      const targetNodeId = graph?.attachmentNodes.get(deviceKey) ?? null;
      const targetAttachPoint = targetNodeId
        ? graph?.points.get(targetNodeId) ?? null
        : null;

      if (currentNodeId && targetNodeId && graph) {
        const path = shortestPath(graph, currentNodeId, targetNodeId);
        if (path) {
          planLengthMm += appendPath(paths, path.points);
        } else {
          const fallback = orthogonalPath(
            currentAttachPoint,
            targetAttachPoint ?? pose.position
          );
          planLengthMm += appendPath(paths, fallback);
          warning = warning ?? 'Нет непрерывного пути по стенам — часть трассы проложена напрямую.';
        }
      } else {
        const fallback = orthogonalPath(
          currentAttachPoint,
          targetAttachPoint ?? pose.position
        );
        planLengthMm += appendPath(paths, fallback);
      }

      if (targetAttachPoint) {
        const spur = orthogonalPath(targetAttachPoint, pose.position);
        if (polylineLength(spur) > 1) {
          planLengthMm += appendPath(paths, spur);
        }
      }

      verticalMm += Math.abs(deviceMountHeightMm(resolved, settings) - runHeightMm);
      currentNodeId = targetNodeId;
      currentAttachPoint = targetAttachPoint ?? pose.position;
      currentPoint = pose.position;
    }

    const baseLength = planLengthMm + verticalMm;
    const cableLengthMm =
      baseLength * (1 + Math.max(0, settings.cableMarginPercent) / 100) +
      PANEL_CABLE_RESERVE_MM;

    routes.set(line.id, {
      lineId: line.id,
      mode,
      cableLengthMm,
      planLengthMm,
      verticalMm,
      deviceCount: lineDevices.length,
      paths,
      warning,
    });
  }

  return routes;
}

export function formatCableLengthMm(lengthMm: number): string {
  if (lengthMm <= 0) return '—';
  return `${(lengthMm / 1000).toFixed(1)} м`;
}

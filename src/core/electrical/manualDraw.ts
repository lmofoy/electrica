import type { ManualRoute, Point2D } from '../../types';
import { distance, projectPointOnSegment } from '../geometry/math';
import {
  isManualRouteOrthogonal,
  materializeManualRoute,
  validateManualRoute,
} from './manualRoute';

// Допуск совпадения вершин черновика, мм.
export const MANUAL_DRAW_EPS_MM = 0.5;

// Практические пределы: подрозетник выдерживает до трёх кабелей,
// распаячная коробка — до шести направлений. Это предупреждения, не запрет.
export const MANUAL_DRAW_DEVICE_DEGREE_LIMIT = 3;
export const MANUAL_DRAW_JUNCTION_DEGREE_LIMIT = 6;

export type ManualDrawAxis = 'h' | 'v';

export interface ManualDrawDevicePoint {
  deviceId: string;
  point: Point2D;
}

// Зафиксированная цепь: ортогональная ломаная от стартового узла до прибора.
export interface ManualDrawChain {
  points: Point2D[];
  endDeviceId: string;
}

export interface ManualDrawActiveChain {
  points: Point2D[];
  endDeviceId: string | null;
}

// Черновик сессии. Живёт только в UI: в проект попадает лишь готовая ManualRoute.
export interface ManualDrawSession {
  panelPoint: Point2D;
  devices: ManualDrawDevicePoint[];
  junctions: Point2D[];
  chains: ManualDrawChain[];
  active: ManualDrawActiveChain | null;
}

export type ManualDrawStartKind = 'panel' | 'device' | 'junction';

export interface ManualDrawStartTarget {
  kind: ManualDrawStartKind;
  point: Point2D;
  deviceId?: string;
}

export type ManualDrawResult =
  | { ok: true; session: ManualDrawSession }
  | { ok: false; error: string };

export type ManualDrawJunctionResult =
  | { ok: true; session: ManualDrawSession; point: Point2D }
  | { ok: false; error: string };

export interface ManualDrawRouteOptions {
  deviceNames?: Record<string, string>;
}

export type ManualDrawRouteResult =
  | { ok: true; route: ManualRoute; warnings: string[] }
  | { ok: false; error: string; missingDeviceIds: string[] };

export interface ManualDrawJunctionSnap {
  point: Point2D;
  chainIndex: number;
  segmentIndex: number;
}

function samePoint(a: Point2D, b: Point2D): boolean {
  return distance(a, b) <= MANUAL_DRAW_EPS_MM;
}

function cloneSession(session: ManualDrawSession): ManualDrawSession {
  return {
    panelPoint: { ...session.panelPoint },
    devices: session.devices.map((device) => ({
      deviceId: device.deviceId,
      point: { ...device.point },
    })),
    junctions: session.junctions.map((point) => ({ ...point })),
    chains: session.chains.map((chain) => ({
      points: chain.points.map((point) => ({ ...point })),
      endDeviceId: chain.endDeviceId,
    })),
    active: session.active
      ? {
          points: session.active.points.map((point) => ({ ...point })),
          endDeviceId: session.active.endDeviceId,
        }
      : null,
  };
}

type Relation = 'same' | 'h' | 'v' | 'slanted';

function relationOf(a: Point2D, b: Point2D): Relation {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx <= MANUAL_DRAW_EPS_MM && dy <= MANUAL_DRAW_EPS_MM) return 'same';
  if (dy <= MANUAL_DRAW_EPS_MM) return 'h';
  if (dx <= MANUAL_DRAW_EPS_MM) return 'v';
  return 'slanted';
}

// Соединение под 90°: на одной оси — прямая, иначе ступенька из двух ног.
// Первую ногу выбирает ось axisFirst, но разворот назад по уже проложенному
// участку запрещён — тогда ноги меняются местами.
function connectOrthogonal(
  from: Point2D,
  previous: Point2D | null,
  target: Point2D,
  axisFirst: ManualDrawAxis
): { ok: true; points: Point2D[] } | { ok: false; error: string } {
  const relation = relationOf(from, target);
  if (relation === 'same') {
    return { ok: false, error: 'Точка совпадает с предыдущей.' };
  }
  const prevRelation = previous ? relationOf(previous, from) : null;

  if (relation === 'h' || relation === 'v') {
    if (previous && prevRelation === relation) {
      const dot =
        (from.x - previous.x) * (target.x - from.x) +
        (from.y - previous.y) * (target.y - from.y);
      if (dot < 0) {
        return {
          ok: false,
          error: 'Нельзя вернуться назад по уже проложенному участку.',
        };
      }
    }
    return { ok: true, points: [{ ...target }] };
  }

  const orders: ManualDrawAxis[] =
    axisFirst === 'h' ? ['h', 'v'] : ['v', 'h'];
  for (const first of orders) {
    const elbow: Point2D =
      first === 'h'
        ? { x: target.x, y: from.y }
        : { x: from.x, y: target.y };
    if (previous && prevRelation === first) {
      const dot =
        (from.x - previous.x) * (elbow.x - from.x) +
        (from.y - previous.y) * (elbow.y - from.y);
      if (dot < 0) continue;
    }
    return { ok: true, points: [elbow, { ...target }] };
  }
  return {
    ok: false,
    error: 'Линия развернулась бы назад. Выберите другое положение точки.',
  };
}

export function createManualDrawSession(
  panelPoint: Point2D,
  devices: ManualDrawDevicePoint[]
): ManualDrawSession {
  return {
    panelPoint: { ...panelPoint },
    devices: devices.map((device) => ({
      deviceId: device.deviceId,
      point: { ...device.point },
    })),
    junctions: [],
    chains: [],
    active: null,
  };
}

export function manualDrawConnectedDevices(
  session: ManualDrawSession
): Set<string> {
  const points = [
    ...session.chains.flatMap((chain) => chain.points),
    ...(session.active?.points ?? []),
  ];
  const result = new Set<string>();
  for (const device of session.devices) {
    if (points.some((point) => samePoint(point, device.point))) {
      result.add(device.deviceId);
    }
  }
  return result;
}

function deviceById(
  session: ManualDrawSession,
  deviceId: string
): ManualDrawDevicePoint | undefined {
  return session.devices.find((device) => device.deviceId === deviceId);
}

function deviceAtPoint(
  session: ManualDrawSession,
  point: Point2D
): ManualDrawDevicePoint | undefined {
  return session.devices.find((device) => samePoint(device.point, point));
}

function pointCollides(
  session: ManualDrawSession,
  point: Point2D,
  ignoreActiveLast: boolean
): boolean {
  for (const chain of session.chains) {
    if (chain.points.some((candidate) => samePoint(candidate, point))) return true;
  }
  if (session.active) {
    const points = session.active.points;
    for (let i = 0; i < points.length; i++) {
      if (ignoreActiveLast && i === points.length - 1) continue;
      if (samePoint(points[i], point)) return true;
    }
  }
  return session.junctions.some((junction) => samePoint(junction, point));
}

export function isManualDrawPanelUsed(session: ManualDrawSession): boolean {
  return session.chains.length > 0 || session.active !== null;
}

export function startManualDrawChain(
  session: ManualDrawSession,
  target: ManualDrawStartTarget
): ManualDrawResult {
  if (session.active) {
    return {
      ok: false,
      error: 'Сначала зафиксируйте или отмените текущую цепь.',
    };
  }

  let start: Point2D;
  if (target.kind === 'panel') {
    if (session.chains.length > 0) {
      return {
        ok: false,
        error: 'Щиток уже подключён: ветвь начинайте от прибора или узла.',
      };
    }
    if (!samePoint(target.point, session.panelPoint)) {
      return { ok: false, error: 'Первую цепь начните от щитка.' };
    }
    start = { ...session.panelPoint };
  } else {
    if (session.chains.length === 0) {
      return { ok: false, error: 'Первую цепь начните от щитка.' };
    }
    if (target.kind === 'device') {
      if (!target.deviceId) {
        return { ok: false, error: 'Прибор не найден.' };
      }
      const device = deviceById(session, target.deviceId);
      if (!device) {
        return { ok: false, error: 'Прибор не входит в эту линию.' };
      }
      if (!manualDrawConnectedDevices(session).has(device.deviceId)) {
        return {
          ok: false,
          error:
            'Этот прибор ещё не подключён: сначала проведите к нему линию.',
        };
      }
      start = { ...device.point };
    } else {
      const junction = session.junctions.find((candidate) =>
        samePoint(candidate, target.point)
      );
      if (!junction) {
        return { ok: false, error: 'Узел не найден: поставьте его на линии.' };
      }
      start = { ...junction };
    }
  }

  const next = cloneSession(session);
  next.active = { points: [start], endDeviceId: null };
  return { ok: true, session: next };
}

export function appendManualDrawPoint(
  session: ManualDrawSession,
  target: Point2D,
  axisFirst: ManualDrawAxis
): ManualDrawResult {
  if (!session.active) {
    return {
      ok: false,
      error: 'Сначала начните цепь от щитка, прибора или узла.',
    };
  }
  if (pointCollides(session, target, true)) {
    return {
      ok: false,
      error:
        'Точка совпадает с существующей вершиной. Выберите другое место.',
    };
  }
  const points = session.active.points;
  const from = points[points.length - 1];
  const previous = points.length >= 2 ? points[points.length - 2] : null;
  const connection = connectOrthogonal(from, previous, target, axisFirst);
  if (!connection.ok) return connection;

  const next = cloneSession(session);
  if (!next.active) return { ok: false, error: 'Цепь уже завершена.' };
  next.active.points.push(...connection.points);
  next.active.endDeviceId = null;
  return { ok: true, session: next };
}

export function appendManualDrawDevice(
  session: ManualDrawSession,
  deviceId: string,
  axisFirst: ManualDrawAxis
): ManualDrawResult {
  if (!session.active) {
    return {
      ok: false,
      error: 'Сначала начните цепь от щитка, прибора или узла.',
    };
  }
  const device = deviceById(session, deviceId);
  if (!device) {
    return { ok: false, error: 'Прибор не входит в эту линию.' };
  }
  if (manualDrawConnectedDevices(session).has(deviceId)) {
    return {
      ok: false,
      error:
        'Кольцо не поддерживаем: этот прибор уже подключён другой ветвью.',
    };
  }
  const points = session.active.points;
  const from = points[points.length - 1];
  if (samePoint(from, device.point)) {
    return { ok: false, error: 'Прибор уже выбран последней точкой.' };
  }
  const previous = points.length >= 2 ? points[points.length - 2] : null;
  const connection = connectOrthogonal(from, previous, device.point, axisFirst);
  if (!connection.ok) return connection;

  const next = cloneSession(session);
  if (!next.active) return { ok: false, error: 'Цепь уже завершена.' };
  next.active.points.push(...connection.points);
  next.active.endDeviceId = device.deviceId;
  return { ok: true, session: next };
}

export function popManualDrawPoint(session: ManualDrawSession): ManualDrawResult {
  if (!session.active) {
    return { ok: false, error: 'Нет активной цепи.' };
  }
  if (session.active.points.length === 0) {
    return { ok: false, error: 'В цепи нет точек.' };
  }
  const next = cloneSession(session);
  if (!next.active) return { ok: false, error: 'Нет активной цепи.' };
  next.active.points.pop();
  if (next.active.points.length === 0) {
    next.active = null;
    return { ok: true, session: next };
  }
  const last = next.active.points[next.active.points.length - 1];
  const device = deviceAtPoint(next, last);
  next.active.endDeviceId =
    device && next.active.points.length >= 2 ? device.deviceId : null;
  return { ok: true, session: next };
}

export function cancelManualDrawChain(
  session: ManualDrawSession
): ManualDrawResult {
  if (!session.active) {
    return { ok: false, error: 'Нет активной цепи.' };
  }
  const next = cloneSession(session);
  next.active = null;
  return { ok: true, session: next };
}

export function fixManualDrawChain(session: ManualDrawSession): ManualDrawResult {
  if (!session.active) {
    return { ok: false, error: 'Нет активной цепи.' };
  }
  if (session.active.points.length < 2) {
    return {
      ok: false,
      error: 'Цепь слишком короткая: добавьте хотя бы один участок.',
    };
  }
  const last = session.active.points[session.active.points.length - 1];
  const device = deviceAtPoint(session, last);
  if (!device) {
    return {
      ok: false,
      error:
        'Цепь должна заканчиваться на приборе этой линии. Выберите прибор последней точкой.',
    };
  }
  if (session.active.endDeviceId !== device.deviceId) {
    return {
      ok: false,
      error: 'После прибора нельзя дорисовывать цепь: закончите её на приборе.',
    };
  }
  const next = cloneSession(session);
  if (!next.active) return { ok: false, error: 'Нет активной цепи.' };
  next.chains.push({
    points: next.active.points,
    endDeviceId: device.deviceId,
  });
  next.active = null;
  return { ok: true, session: next };
}

// Ближайшее место на проложенной цепи, куда можно поставить узел.
export function manualDrawJunctionSnap(
  session: ManualDrawSession,
  point: Point2D,
  toleranceMm: number
): ManualDrawJunctionSnap | null {
  let best: (ManualDrawJunctionSnap & { distanceMm: number }) | null = null;
  for (let chainIndex = 0; chainIndex < session.chains.length; chainIndex++) {
    const chain = session.chains[chainIndex];
    for (let i = 1; i < chain.points.length; i++) {
      const start = chain.points[i - 1];
      const end = chain.points[i];
      const projection = projectPointOnSegment(point, start, end);
      if (projection.distance > toleranceMm) continue;
      if (best && best.distanceMm <= projection.distance) continue;

      // Проекция у вершины — узел ставится прямо в неё, без расщепления.
      const nearStart = distance(projection.point, start) <= MANUAL_DRAW_EPS_MM;
      const nearEnd = distance(projection.point, end) <= MANUAL_DRAW_EPS_MM;
      const snapped: Point2D = nearStart
        ? { ...start }
        : nearEnd
          ? { ...end }
          : {
              x: start.x + projection.t * (end.x - start.x),
              y: start.y + projection.t * (end.y - start.y),
            };
      best = {
        point: snapped,
        chainIndex,
        segmentIndex: i - 1,
        distanceMm: projection.distance,
      };
    }
  }
  if (!best) return null;
  return {
    point: best.point,
    chainIndex: best.chainIndex,
    segmentIndex: best.segmentIndex,
  };
}

export function addManualDrawJunction(
  session: ManualDrawSession,
  point: Point2D,
  toleranceMm: number
): ManualDrawJunctionResult {
  if (session.active) {
    return {
      ok: false,
      error: 'Сначала зафиксируйте текущую цепь, затем ставьте узел.',
    };
  }
  const snap = manualDrawJunctionSnap(session, point, toleranceMm);
  if (!snap) {
    return {
      ok: false,
      error: 'Узел можно поставить только на проложенной линии.',
    };
  }
  if (samePoint(snap.point, session.panelPoint)) {
    return {
      ok: false,
      error: 'В этой точке стоит щиток — используйте его как начало ветви.',
    };
  }
  if (session.devices.some((device) => samePoint(device.point, snap.point))) {
    return {
      ok: false,
      error: 'В этой точке стоит прибор — используйте его как начало ветви.',
    };
  }
  if (session.junctions.some((junction) => samePoint(junction, snap.point))) {
    return { ok: true, session: cloneSession(session), point: snap.point };
  }

  const next = cloneSession(session);
  const chain = next.chains[snap.chainIndex];
  const segmentStart = chain.points[snap.segmentIndex];
  const segmentEnd = chain.points[snap.segmentIndex + 1];
  const atVertex =
    samePoint(snap.point, segmentStart) || samePoint(snap.point, segmentEnd);
  if (!atVertex) {
    chain.points.splice(snap.segmentIndex + 1, 0, { ...snap.point });
  }
  next.junctions.push({ ...snap.point });
  return { ok: true, session: next, point: snap.point };
}

function pointOnChain(chain: ManualDrawChain, point: Point2D): boolean {
  for (let i = 1; i < chain.points.length; i++) {
    const projection = projectPointOnSegment(
      point,
      chain.points[i - 1],
      chain.points[i]
    );
    if (projection.distance <= MANUAL_DRAW_EPS_MM) return true;
  }
  return chain.points.some((candidate) => samePoint(candidate, point));
}

export function removeLastManualDrawChain(
  session: ManualDrawSession
): ManualDrawResult {
  if (session.active) {
    return {
      ok: false,
      error: 'Сначала завершите текущую цепь, затем убирайте предыдущую.',
    };
  }
  if (session.chains.length === 0) {
    return { ok: false, error: 'Зафиксированных цепей нет.' };
  }
  const next = cloneSession(session);
  const removed = next.chains.pop();
  if (removed) {
    next.junctions = next.junctions.filter(
      (junction) => !pointOnChain(removed, junction)
    );
  }
  return { ok: true, session: next };
}

// Превью для слоя: от последней точки активной цепи до курсора.
export function manualDrawPreview(
  session: ManualDrawSession,
  target: Point2D | null,
  axisFirst: ManualDrawAxis
): Point2D[] | null {
  if (!session.active || !target) return null;
  const points = session.active.points;
  if (points.length === 0) return null;
  const from = points[points.length - 1];
  const previous = points.length >= 2 ? points[points.length - 2] : null;
  const connection = connectOrthogonal(from, previous, target, axisFirst);
  if (!connection.ok) return null;
  return [{ ...from }, ...connection.points];
}

function routeDegrees(route: ManualRoute): Map<number, Set<number>> {
  const degrees = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    const set = degrees.get(a) ?? new Set<number>();
    set.add(b);
    degrees.set(a, set);
  };
  for (const path of route.paths) {
    for (let i = 1; i < path.length; i++) {
      link(path[i - 1], path[i]);
      link(path[i], path[i - 1]);
    }
  }
  return degrees;
}

function pluralCables(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'кабель';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'кабеля';
  return 'кабелей';
}

function collectDegreeWarnings(
  route: ManualRoute,
  options: ManualDrawRouteOptions
): string[] {
  const warnings: string[] = [];
  const degrees = routeDegrees(route);
  for (const anchor of route.anchors) {
    if (anchor.kind !== 'device') continue;
    const degree = degrees.get(anchor.nodeIndex)?.size ?? 0;
    if (degree <= MANUAL_DRAW_DEVICE_DEGREE_LIMIT) continue;
    const name =
      (anchor.deviceId && options.deviceNames?.[anchor.deviceId]) ||
      anchor.deviceId ||
      'прибор';
    warnings.push(
      `У прибора «${name}» ${degree} ${pluralCables(degree)} — проверьте, поместится ли в подрозетник.`
    );
  }
  for (const anchor of route.anchors) {
    if (anchor.kind !== 'junction') continue;
    const degree = degrees.get(anchor.nodeIndex)?.size ?? 0;
    if (degree <= MANUAL_DRAW_JUNCTION_DEGREE_LIMIT) continue;
    warnings.push(
      `В узле ${degree} направлений — проверьте, хватит ли распаячной коробки.`
    );
  }
  return warnings;
}

export function manualDrawRoute(
  session: ManualDrawSession,
  options: ManualDrawRouteOptions = {}
): ManualDrawRouteResult {
  if (session.active) {
    return {
      ok: false,
      error: 'Зафиксируйте текущую цепь перед сохранением трассы.',
      missingDeviceIds: [],
    };
  }
  if (session.chains.length === 0) {
    return {
      ok: false,
      error: 'Сначала проведите хотя бы одну цепь от щитка.',
      missingDeviceIds: [],
    };
  }
  const firstChain = session.chains[0];
  if (!samePoint(firstChain.points[0], session.panelPoint)) {
    return {
      ok: false,
      error: 'Первая цепь должна начинаться от щитка.',
      missingDeviceIds: [],
    };
  }

  const connected = manualDrawConnectedDevices(session);
  const missing = session.devices.filter(
    (device) => !connected.has(device.deviceId)
  );
  if (missing.length > 0) {
    const names = missing
      .map(
        (device) =>
          options.deviceNames?.[device.deviceId] || device.deviceId
      )
      .join(', ');
    return {
      ok: false,
      error: `Не подключены приборы линии: ${names}. Проведите к ним цепь.`,
      missingDeviceIds: missing.map((device) => device.deviceId),
    };
  }

  const route = materializeManualRoute(
    session.chains.map((chain) => chain.points),
    {
      panelPoint: session.panelPoint,
      devicePoints: session.devices.map((device) => ({
        deviceId: device.deviceId,
        point: device.point,
      })),
      junctionPoints: session.junctions,
    }
  );
  if (!route) {
    return {
      ok: false,
      error:
        'Не удалось собрать трассу: проверьте, что цепи начинаются в узлах и заканчиваются на приборах.',
      missingDeviceIds: [],
    };
  }
  const invalid = validateManualRoute(route);
  if (invalid) {
    return { ok: false, error: invalid.error, missingDeviceIds: [] };
  }
  if (!route.anchors.some((anchor) => anchor.kind === 'panel')) {
    return {
      ok: false,
      error: 'Трасса не привязана к щитку. Начните первую цепь от щитка.',
      missingDeviceIds: [],
    };
  }
  if (!isManualRouteOrthogonal(route)) {
    return {
      ok: false,
      error: 'В трассе появился наклонный участок. Перерисуйте этот фрагмент.',
      missingDeviceIds: [],
    };
  }
  for (const deviceId of connected) {
    const anchored = route.anchors.some(
      (anchor) => anchor.kind === 'device' && anchor.deviceId === deviceId
    );
    if (!anchored) {
      return {
        ok: false,
        error: `Прибор «${
          options.deviceNames?.[deviceId] || deviceId
        }» не привязан к трассе. Перерисуйте подход к нему.`,
        missingDeviceIds: [],
      };
    }
  }

  return {
    ok: true,
    route,
    warnings: collectDegreeWarnings(route, options),
  };
}

import type {
  DeviceAnchor,
  DeviceType,
  ElectricalDevice,
  FreePartition,
  Point2D,
  RoomZone,
} from '../../types';
import {
  distance,
  isPointInPolygon,
  projectPointOnSegment,
} from '../geometry/math';

export interface DeviceCatalogEntry {
  label: string;
  shortLabel: string;
  group: 'socket' | 'switch' | 'light';
  mounting: 'wall' | 'ceiling';
  defaultHeightMm: number;
  defaultPowerWatts: number;
}

export const DEVICE_CATALOG: Record<DeviceType, DeviceCatalogEntry> = {
  socket_single: {
    label: 'Розетка одинарная',
    shortLabel: 'Розетка 1',
    group: 'socket',
    mounting: 'wall',
    defaultHeightMm: 300,
    defaultPowerWatts: 2200,
  },
  socket_double: {
    label: 'Розетка двойная',
    shortLabel: 'Розетка 2',
    group: 'socket',
    mounting: 'wall',
    defaultHeightMm: 300,
    defaultPowerWatts: 2200,
  },
  socket_wet: {
    label: 'Розетка влагозащищённая',
    shortLabel: 'Влажная',
    group: 'socket',
    mounting: 'wall',
    defaultHeightMm: 1100,
    defaultPowerWatts: 2200,
  },
  switch_1k: {
    label: 'Выключатель одноклавишный',
    shortLabel: 'Выкл. 1',
    group: 'switch',
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
  },
  switch_2k: {
    label: 'Выключатель двухклавишный',
    shortLabel: 'Выкл. 2',
    group: 'switch',
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
  },
  light_ceiling: {
    label: 'Светильник потолочный',
    shortLabel: 'Свет',
    group: 'light',
    mounting: 'ceiling',
    defaultHeightMm: 0,
    defaultPowerWatts: 100,
  },
};

export const DEVICE_TYPES: DeviceType[] = [
  'socket_single',
  'socket_double',
  'socket_wet',
  'switch_1k',
  'switch_2k',
  'light_ceiling',
];

export interface DevicePose {
  position: Point2D;
  rotationDeg: number; // локальная ось -Y смотрит внутрь комнаты
  roomId: string;
  mirrored: boolean;
}

export interface ResolvedDevice {
  device: ElectricalDevice;
  poses: DevicePose[];
  roomIds: string[];
  isShared: boolean;
}

export type DevicePlacementResult =
  | {
      ok: true;
      anchor: DeviceAnchor;
      position: Point2D;
      rotationDeg: number;
      roomId: string;
      isShared: boolean;
    }
  | { ok: false; error: string };

function pointInRoom(point: Point2D, room: RoomZone): boolean {
  if (!isPointInPolygon(point, room.vertices)) return false;
  return !(room.holes ?? []).some((hole) => isPointInPolygon(point, hole));
}

function inwardNormalForEdge(room: RoomZone, a: Point2D, b: Point2D): Point2D {
  const len = distance(a, b) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const probe = 100;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const candidate = { x: mid.x + nx * probe, y: mid.y + ny * probe };
  return pointInRoom(candidate, room) ? { x: nx, y: ny } : { x: -nx, y: -ny };
}

function rotationForInward(inward: Point2D): number {
  return (Math.atan2(inward.y, inward.x) * 180) / Math.PI + 90;
}

interface AdjacentEdge {
  room: RoomZone;
  edgeIndex: number;
  point: Point2D;
  inward: Point2D;
  coincident: boolean;
}

function findAdjacentRoomEdge(
  primaryRoomId: string,
  devicePoint: Point2D,
  outward: Point2D,
  rooms: RoomZone[],
  thickness: number
): AdjacentEdge | null {
  let best: AdjacentEdge | null = null;
  let bestScore = Infinity;

  for (const room of rooms) {
    if (room.id === primaryRoomId) continue;
    const count = room.vertices.length;
    if (count < 3) continue;

    for (let i = 0; i < count; i++) {
      const c = room.vertices[i];
      const d = room.vertices[(i + 1) % count];
      const proj = projectPointOnSegment(devicePoint, c, d);
      // Точка должна попадать внутрь ребра, а не в его конец
      if (proj.t <= 0.002 || proj.t >= 0.998) continue;

      const coincident = proj.distance < 15;
      if (!coincident && Math.abs(proj.distance - thickness) > 15) continue;

      const toPoint = {
        x: proj.point.x - devicePoint.x,
        y: proj.point.y - devicePoint.y,
      };
      if (!coincident && toPoint.x * outward.x + toPoint.y * outward.y <= 0) continue;

      const score = Math.abs(proj.distance - (coincident ? 0 : thickness));
      if (score < bestScore) {
        bestScore = score;
        best = {
          room,
          edgeIndex: i,
          point: proj.point,
          inward: inwardNormalForEdge(room, c, d),
          coincident,
        };
      }
    }
  }

  return best;
}

export function resolveDevice(
  device: ElectricalDevice,
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): ResolvedDevice | null {
  const anchor = device.anchor;

  if (anchor.kind === 'room_point') {
    const room = rooms.find((candidate) => candidate.id === anchor.roomId);
    if (!room) return null;
    return {
      device,
      poses: [
        {
          position: { x: anchor.x, y: anchor.y },
          rotationDeg: 0,
          roomId: room.id,
          mirrored: false,
        },
      ],
      roomIds: [room.id],
      isShared: false,
    };
  }

  if (anchor.kind === 'partition') {
    const partition = partitions.find((candidate) => candidate.id === anchor.partitionId);
    if (!partition) return null;
    const len = distance(partition.p1, partition.p2);
    if (len < 1) return null;

    const dir = {
      x: (partition.p2.x - partition.p1.x) / len,
      y: (partition.p2.y - partition.p1.y) / len,
    };
    const offset = Math.max(0, Math.min(len, anchor.offsetMm));
    const normal = { x: -dir.y * anchor.side, y: dir.x * anchor.side };

    return {
      device,
      poses: [
        {
          position: {
            x: partition.p1.x + dir.x * offset,
            y: partition.p1.y + dir.y * offset,
          },
          rotationDeg: rotationForInward(normal),
          roomId: partition.roomId,
          mirrored: false,
        },
      ],
      roomIds: [partition.roomId],
      isShared: false,
    };
  }

  const room = rooms.find((candidate) => candidate.id === anchor.roomId);
  if (!room || room.vertices.length < 3) return null;

  const count = room.vertices.length;
  const edgeIndex = ((anchor.edgeIndex % count) + count) % count;
  const a = room.vertices[edgeIndex];
  const b = room.vertices[(edgeIndex + 1) % count];
  const len = distance(a, b);
  if (len < 1) return null;

  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const offset = Math.max(0, Math.min(len, anchor.offsetMm));
  const position = { x: a.x + dir.x * offset, y: a.y + dir.y * offset };
  const inward = inwardNormalForEdge(room, a, b);

  const poses: DevicePose[] = [
    {
      position,
      rotationDeg: rotationForInward(inward),
      roomId: room.id,
      mirrored: false,
    },
  ];
  const roomIds = [room.id];

  if (device.shared) {
    const outward = { x: -inward.x, y: -inward.y };
    const adjacent = findAdjacentRoomEdge(room.id, position, outward, rooms, thickness);
    if (adjacent) {
      const position2 = adjacent.coincident
        ? {
            x: adjacent.point.x + adjacent.inward.x * (thickness / 2),
            y: adjacent.point.y + adjacent.inward.y * (thickness / 2),
          }
        : adjacent.point;
      poses.push({
        position: position2,
        rotationDeg: rotationForInward(adjacent.inward),
        roomId: adjacent.room.id,
        mirrored: true,
      });
      roomIds.push(adjacent.room.id);
    }
  }

  return { device, poses, roomIds, isShared: poses.length > 1 };
}

interface WallCandidate {
  kind: 'room_edge' | 'partition';
  distanceMm: number;
  roomId: string;
  edgeIndex?: number;
  partitionId?: string;
  lengthMm: number;
  point: Point2D;
  inward: Point2D;
  offsetMm: number;
}

function collectCandidates(
  cursor: Point2D,
  room: RoomZone | null,
  rooms: RoomZone[],
  partitions: FreePartition[],
  searchRadiusMm: number
): WallCandidate[] {
  const candidates: WallCandidate[] = [];
  const sourceRooms = room ? [room] : rooms;

  for (const candidateRoom of sourceRooms) {
    const count = candidateRoom.vertices.length;
    for (let i = 0; i < count; i++) {
      const a = candidateRoom.vertices[i];
      const b = candidateRoom.vertices[(i + 1) % count];
      const len = distance(a, b);
      if (len < 1) continue;
      const proj = projectPointOnSegment(cursor, a, b);
      if (proj.distance > searchRadiusMm) continue;
      const offsetMm = proj.t * len;
      candidates.push({
        kind: 'room_edge',
        distanceMm: proj.distance,
        roomId: candidateRoom.id,
        edgeIndex: i,
        lengthMm: len,
        point: proj.point,
        inward: inwardNormalForEdge(candidateRoom, a, b),
        offsetMm,
      });
    }
  }

  const sourcePartitions = room
    ? partitions.filter((partition) => partition.roomId === room.id)
    : partitions;

  for (const partition of sourcePartitions) {
    const proj = projectPointOnSegment(cursor, partition.p1, partition.p2);
    if (proj.distance > searchRadiusMm) continue;
    const len = distance(partition.p1, partition.p2);
    if (len < 1) continue;
    const dir = {
      x: (partition.p2.x - partition.p1.x) / len,
      y: (partition.p2.y - partition.p1.y) / len,
    };
    const normal = { x: -dir.y, y: dir.x };
    const side =
      (cursor.x - partition.p1.x) * normal.x + (cursor.y - partition.p1.y) * normal.y >= 0
        ? 1
        : -1;
    candidates.push({
      kind: 'partition',
      distanceMm: proj.distance,
      roomId: partition.roomId,
      partitionId: partition.id,
      lengthMm: len,
      point: proj.point,
      inward: { x: normal.x * side, y: normal.y * side },
      offsetMm: proj.t * len,
    });
  }

  return candidates;
}

export function findDevicePlacement(
  type: DeviceType,
  cursor: Point2D,
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number,
  sharedRequested: boolean
): DevicePlacementResult {
  const catalog = DEVICE_CATALOG[type];

  if (catalog.mounting === 'ceiling') {
    const room = rooms.find((candidate) => pointInRoom(cursor, candidate));
    if (!room) {
      return { ok: false, error: 'Светильник размещается внутри комнаты.' };
    }
    const position = {
      x: Math.round(cursor.x / 10) * 10,
      y: Math.round(cursor.y / 10) * 10,
    };
    return {
      ok: true,
      anchor: { kind: 'room_point', roomId: room.id, x: position.x, y: position.y },
      position,
      rotationDeg: 0,
      roomId: room.id,
      isShared: false,
    };
  }

  const hostRoom = rooms.find((candidate) => pointInRoom(cursor, candidate)) ?? null;
  const searchRadius = hostRoom ? 400 : 350;
  const candidates = collectCandidates(cursor, hostRoom, rooms, partitions, searchRadius);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: 'Поднесите курсор к внутренней грани стены комнаты или к перегородке.',
    };
  }

  candidates.sort((a, b) => a.distanceMm - b.distanceMm);
  const best = candidates[0];

  const margin = Math.min(100, best.lengthMm / 2);
  const offsetMm =
    best.lengthMm > 2 * margin
      ? Math.min(
          best.lengthMm - margin,
          Math.max(margin, Math.round(best.offsetMm / 50) * 50)
        )
      : best.lengthMm / 2;

  if (best.kind === 'partition' && best.partitionId) {
    if (sharedRequested) {
      return {
        ok: false,
        error: 'Сквозное устройство ставится только на стену между двумя комнатами, не на перегородку.',
      };
    }
    const partition = partitions.find((candidate) => candidate.id === best.partitionId);
    if (!partition) {
      return { ok: false, error: 'Перегородка не найдена.' };
    }
    const len = distance(partition.p1, partition.p2);
    const dir = {
      x: (partition.p2.x - partition.p1.x) / len,
      y: (partition.p2.y - partition.p1.y) / len,
    };
    const normal = { x: -dir.y, y: dir.x };
    const side =
      (cursor.x - partition.p1.x) * normal.x + (cursor.y - partition.p1.y) * normal.y >= 0
        ? 1
        : -1;
    return {
      ok: true,
      anchor: {
        kind: 'partition',
        partitionId: best.partitionId,
        offsetMm,
        side: side as 1 | -1,
      },
      position: {
        x: partition.p1.x + dir.x * offsetMm,
        y: partition.p1.y + dir.y * offsetMm,
      },
      rotationDeg: rotationForInward({ x: normal.x * side, y: normal.y * side }),
      roomId: best.roomId,
      isShared: false,
    };
  }

  if (best.edgeIndex === undefined) {
    return { ok: false, error: 'Не удалось определить грань стены.' };
  }

  const anchor: DeviceAnchor = {
    kind: 'room_edge',
    roomId: best.roomId,
    edgeIndex: best.edgeIndex,
    offsetMm,
  };

  const host = rooms.find((candidate) => candidate.id === best.roomId);
  if (!host) return { ok: false, error: 'Комната не найдена.' };

  let isShared = false;
  if (sharedRequested) {
    const adjacent = findAdjacentRoomEdge(
      host.id,
      best.point,
      { x: -best.inward.x, y: -best.inward.y },
      rooms,
      thickness
    );
    if (!adjacent) {
      return {
        ok: false,
        error: 'Рядом нет смежной комнаты. Снимите флажок «Сквозная».',
      };
    }
    isShared = true;
  }

  const a = host.vertices[best.edgeIndex];
  const b = host.vertices[(best.edgeIndex + 1) % host.vertices.length];
  const len = distance(a, b);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };

  return {
    ok: true,
    anchor,
    position: { x: a.x + dir.x * offsetMm, y: a.y + dir.y * offsetMm },
    rotationDeg: rotationForInward(best.inward),
    roomId: best.roomId,
    isShared,
  };
}

export function sanitizeDevices(
  devices: ElectricalDevice[],
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): ElectricalDevice[] {
  return devices.filter((device) => resolveDevice(device, rooms, partitions, thickness) !== null);
}

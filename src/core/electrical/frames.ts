import type {
  ElectricalDevice,
  FrameAnchor,
  FramePosts,
  FreePartition,
  MountingFrame,
  Point2D,
  RoomZone,
} from '../../types';
import { distance } from '../geometry/math';
import {
  findDevicePlacement,
  isMechanismType,
  resolveDevice,
  type DevicePose,
} from './devices';

// Рамки — монтажная часть: в них стоят механизмы (розетки/выключатели),
// у каждого свой паспорт, линия и кабель. Рамка не имеет ни линии, ни нагрузки.
export const FRAME_POST_PITCH_MM = 71; // шаг мест внутри рамки
export const FRAME_SINGLE_WIDTH_MM = 82; // ширина рамки на одну позицию
export const FRAME_PLATE_DEPTH_MM = 82; // высота рамки на плане
export const FRAME_WALL_MARGIN_MM = 30; // зазор от края стены до края рамки

export const FRAME_POSTS_OPTIONS: FramePosts[] = [1, 2, 3, 4];

export function framePlateWidthMm(posts: FramePosts): number {
  return (posts - 1) * FRAME_POST_PITCH_MM + FRAME_SINGLE_WIDTH_MM;
}

/** Смещение центра места от центра рамки вдоль стены (мм). */
export function frameSeatOffsetMm(posts: FramePosts, seatIndex: number): number {
  return (seatIndex - (posts - 1) / 2) * FRAME_POST_PITCH_MM;
}

function frameProbe(frame: MountingFrame): ElectricalDevice {
  return {
    id: `${frame.id}-probe`,
    type: 'socket_single',
    name: '',
    anchor: frame.anchor,
    heightFromFloorMm: frame.heightFromFloorMm,
    powerWatts: 0,
    shared: false,
  };
}

export function resolveFramePose(
  frame: MountingFrame,
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): DevicePose | null {
  const resolved = resolveDevice(frameProbe(frame), rooms, partitions, thickness);
  return resolved ? resolved.poses[0] ?? null : null;
}

/** Привязка механизма на месте seatIndex: центр рамки плюс шаг мест. */
export function frameSeatAnchor(frame: MountingFrame, seatIndex: number): FrameAnchor {
  return {
    ...frame.anchor,
    offsetMm: frame.anchor.offsetMm + frameSeatOffsetMm(frame.posts, seatIndex),
  };
}

/** Мировая точка центра места — для отрисовки подписей и символов. */
export function frameSeatCenter(
  pose: DevicePose,
  posts: FramePosts,
  seatIndex: number
): Point2D {
  const offset = frameSeatOffsetMm(posts, seatIndex);
  const rad = (pose.rotationDeg * Math.PI) / 180;
  return {
    x: pose.position.x + Math.cos(rad) * offset,
    y: pose.position.y + Math.sin(rad) * offset,
  };
}

function wallLength(
  anchor: FrameAnchor,
  rooms: RoomZone[],
  partitions: FreePartition[]
): number | null {
  if (anchor.kind === 'partition') {
    const partition = partitions.find((candidate) => candidate.id === anchor.partitionId);
    return partition ? distance(partition.p1, partition.p2) : null;
  }
  const room = rooms.find((candidate) => candidate.id === anchor.roomId);
  if (!room || room.vertices.length < 3) return null;
  const count = room.vertices.length;
  const edgeIndex = ((anchor.edgeIndex % count) + count) % count;
  return distance(room.vertices[edgeIndex], room.vertices[(edgeIndex + 1) % count]);
}

/** Сдвигаем центр рамки так, чтобы вся плата помещалась на стене. */
export function clampFrameOffset(
  anchor: FrameAnchor,
  posts: FramePosts,
  rooms: RoomZone[],
  partitions: FreePartition[]
): number {
  const length = wallLength(anchor, rooms, partitions);
  if (length === null) return anchor.offsetMm;
  const margin = framePlateWidthMm(posts) / 2 + FRAME_WALL_MARGIN_MM;
  if (length <= margin * 2) return length / 2;
  return Math.min(length - margin, Math.max(margin, anchor.offsetMm));
}

export type FramePlacementResult =
  | {
      ok: true;
      anchor: FrameAnchor;
      position: Point2D;
      rotationDeg: number;
      roomId: string;
    }
  | { ok: false; error: string };

export function findFramePlacement(
  cursor: Point2D,
  posts: FramePosts,
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): FramePlacementResult {
  const base = findDevicePlacement('socket_single', cursor, rooms, partitions, thickness, false);
  if (!base.ok) return base;
  if (base.anchor.kind === 'room_point') {
    return { ok: false, error: 'Подрозетник ставится на грань стены или на перегородку.' };
  }
  const anchor: FrameAnchor = {
    ...base.anchor,
    offsetMm: clampFrameOffset(base.anchor, posts, rooms, partitions),
  };
  const frame: MountingFrame = {
    id: 'frame-preview',
    anchor,
    heightFromFloorMm: 300,
    posts,
    mounting: 'flush',
  };
  const pose = resolveFramePose(frame, rooms, partitions, thickness);
  if (!pose) {
    return { ok: false, error: 'Не удалось привязать подрозетник к стене. Проверьте план.' };
  }
  return {
    ok: true,
    anchor,
    position: pose.position,
    rotationDeg: pose.rotationDeg,
    roomId: pose.roomId,
  };
}

// ---------------------------------------------------------------
// Нормализация при загрузке: старые одиночные механизмы оборачиваются
// в рамку на одну позицию, чтобы рамки всегда можно было посчитать.
// ---------------------------------------------------------------
export function sanitizeFrames(
  frames: MountingFrame[],
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): MountingFrame[] {
  const ids = new Set<string>();
  const result: MountingFrame[] = [];
  for (const frame of frames) {
    if (!frame || typeof frame.id !== 'string' || !frame.id.trim() || ids.has(frame.id)) continue;
    if (!Number.isFinite(frame.heightFromFloorMm) || frame.heightFromFloorMm < 0) continue;
    if (!FRAME_POSTS_OPTIONS.includes(frame.posts)) continue;
    if (frame.mounting !== 'flush' && frame.mounting !== 'surface') continue;
    const anchor = frame.anchor;
    if (!anchor || (anchor.kind !== 'room_edge' && anchor.kind !== 'partition')) continue;
    if (!Number.isFinite(anchor.offsetMm)) continue;
    if (anchor.kind === 'room_edge') {
      if (!Number.isSafeInteger(anchor.edgeIndex)) continue;
      if (!rooms.some((room) => room.id === anchor.roomId)) continue;
    } else if (!partitions.some((partition) => partition.id === anchor.partitionId)) {
      continue;
    } else if (anchor.side !== 1 && anchor.side !== -1) {
      continue;
    }
    if (!resolveFramePose(frame, rooms, partitions, thickness)) continue;
    ids.add(frame.id);
    result.push(frame);
  }
  return result;
}

function uniqueFrameId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export interface SanitizedElectrical {
  devices: ElectricalDevice[];
  frames: MountingFrame[];
}

export function sanitizeElectrical(
  inputDevices: ElectricalDevice[],
  inputFrames: MountingFrame[],
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): SanitizedElectrical {
  const frames = sanitizeFrames(inputFrames, rooms, partitions, thickness);
  const resultFrames = [...frames];
  const usedFrameIds = new Set(frames.map((frame) => frame.id));
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const occupied = new Set<string>();
  const devices: ElectricalDevice[] = [];

  for (const raw of inputDevices) {
    const resolved = resolveDevice(raw, rooms, partitions, thickness);
    if (!resolved) continue;
    let device: ElectricalDevice = { ...raw, shared: resolved.isShared };

    if (!isMechanismType(device.type) || device.anchor.kind === 'room_point') {
      const cleaned = { ...device };
      delete cleaned.frameId;
      delete cleaned.seatIndex;
      devices.push(cleaned);
      continue;
    }

    const frame = device.frameId ? frameById.get(device.frameId) : undefined;
    const seatIndex = device.seatIndex;
    const seatKey =
      frame && Number.isSafeInteger(seatIndex) ? `${frame.id}:${seatIndex}` : null;
    const seatOk =
      frame !== undefined &&
      Number.isSafeInteger(seatIndex) &&
      (seatIndex as number) >= 0 &&
      (seatIndex as number) < frame.posts &&
      seatKey !== null &&
      !occupied.has(seatKey);

    if (frame && seatOk && seatKey) {
      occupied.add(seatKey);
      const anchor = frameSeatAnchor(frame, seatIndex as number);
      const candidate: ElectricalDevice = {
        ...device,
        frameId: frame.id,
        seatIndex: seatIndex as number,
        anchor,
        heightFromFloorMm: frame.heightFromFloorMm,
      };
      const check = resolveDevice(candidate, rooms, partitions, thickness);
      if (!check) continue;
      devices.push({ ...candidate, shared: check.isShared });
      continue;
    }

    // Старые данные или повреждённая ссылка: своя рамка на одну позицию.
    const cleaned = { ...device };
    delete cleaned.frameId;
    delete cleaned.seatIndex;
    const frameId = uniqueFrameId(`frame-${cleaned.id}`, usedFrameIds);
    usedFrameIds.add(frameId);
    const wrapped: MountingFrame = {
      id: frameId,
      anchor: cleaned.anchor as FrameAnchor,
      heightFromFloorMm: cleaned.heightFromFloorMm,
      posts: 1,
      mounting: 'flush',
    };
    resultFrames.push(wrapped);
    occupied.add(`${frameId}:0`);
    devices.push({ ...cleaned, frameId, seatIndex: 0 });
  }

  return { devices, frames: resultFrames };
}

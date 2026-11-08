import type {
  ElectricalDevice,
  FreePartition,
  Opening,
  RoomZone,
  Wall,
} from '../../types';
import { resolveDevice, type ResolvedDevice } from '../electrical/devices';
import { isPointInPolygon } from '../geometry/math';

export function getOpeningRoomIds(
  opening: Opening,
  walls: Wall[],
  rooms: RoomZone[]
): string[] {
  const wall = walls.find((candidate) => candidate.id === opening.wallId);
  if (wall) return wall.roomIds;

  // Снимок мог прийти без графа стен — определяем комнаты геометрически
  const len = Math.hypot(opening.p2.x - opening.p1.x, opening.p2.y - opening.p1.y) || 1;
  const nx = -(opening.p2.y - opening.p1.y) / len;
  const ny = (opening.p2.x - opening.p1.x) / len;
  const mid = {
    x: (opening.p1.x + opening.p2.x) / 2,
    y: (opening.p1.y + opening.p2.y) / 2,
  };
  const probe = 350;

  return rooms
    .filter((room) => {
      const positive = isPointInPolygon(
        { x: mid.x + nx * probe, y: mid.y + ny * probe },
        room.vertices
      );
      const negative = isPointInPolygon(
        { x: mid.x - nx * probe, y: mid.y - ny * probe },
        room.vertices
      );
      return positive || negative;
    })
    .map((room) => room.id);
}

export interface RoomElements {
  doors: Opening[];
  windows: Opening[];
  partitions: FreePartition[];
  devices: ResolvedDevice[];
}

export function collectRoomElements(
  roomId: string,
  rooms: RoomZone[],
  walls: Wall[],
  partitions: FreePartition[],
  openings: Opening[],
  devices: ElectricalDevice[],
  thickness: number
): RoomElements {
  const doors: Opening[] = [];
  const windows: Opening[] = [];

  for (const opening of openings) {
    if (!getOpeningRoomIds(opening, walls, rooms).includes(roomId)) continue;
    if (opening.type === 'door') doors.push(opening);
    else windows.push(opening);
  }

  const resolved = devices
    .map((device) => resolveDevice(device, rooms, partitions, thickness))
    .filter((candidate): candidate is ResolvedDevice => candidate !== null)
    .filter((candidate) => candidate.roomIds.includes(roomId));

  return {
    doors,
    windows,
    partitions: partitions.filter((partition) => partition.roomId === roomId),
    devices: resolved,
  };
}

export function countRoomElements(elements: RoomElements): number {
  return (
    elements.doors.length +
    elements.windows.length +
    elements.partitions.length +
    elements.devices.length
  );
}

export function formatRoomDeletionPrompt(roomName: string, elements: RoomElements): string {
  const parts: string[] = [];
  if (elements.doors.length > 0) parts.push(`двери — ${elements.doors.length}`);
  if (elements.windows.length > 0) parts.push(`окна — ${elements.windows.length}`);
  if (elements.partitions.length > 0) parts.push(`перегородки — ${elements.partitions.length}`);
  if (elements.devices.length > 0) parts.push(`электроприборы — ${elements.devices.length}`);

  const lines = [`Удалить комнату «${roomName}»?`];
  if (parts.length > 0) {
    lines.push(`Вместе с ней будут удалены: ${parts.join(', ')}.`);
  }
  const shared = elements.devices.filter((device) => device.isShared).length;
  if (shared > 0) {
    lines.push(`Сквозных устройств в комнате: ${shared} — они исчезнут и из смежных комнат.`);
  }
  return lines.join('\n');
}

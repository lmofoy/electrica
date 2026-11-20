import type { RoomZone } from '../../types';

export interface DeviceRoomRow {
  roomId: string;
  name: string;
  count: number;
}

export interface DeviceSummary {
  total: number;
  rooms: DeviceRoomRow[];
  emptyRoomNames: string[];
}

// Сводка шага «План»: сколько приборов и в каких комнатах ещё пусто.
// Сквозной прибор учитывается в обеих комнатах, но в total — один раз.
export function buildDeviceSummary(
  rooms: Pick<RoomZone, 'id' | 'name'>[],
  devices: { roomIds: string[] }[]
): DeviceSummary {
  const counts = new Map<string, number>();
  for (const room of rooms) counts.set(room.id, 0);

  for (const device of devices) {
    for (const roomId of new Set(device.roomIds)) {
      if (counts.has(roomId)) counts.set(roomId, (counts.get(roomId) ?? 0) + 1);
    }
  }

  const rows = rooms.map((room) => ({
    roomId: room.id,
    name: room.name,
    count: counts.get(room.id) ?? 0,
  }));

  return {
    total: devices.length,
    rooms: rows,
    emptyRoomNames: rows.filter((row) => row.count === 0).map((row) => row.name),
  };
}

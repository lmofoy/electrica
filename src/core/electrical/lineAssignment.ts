import type { CircuitLine, ElectricalDevice, ElectricalPanel } from '../../types';

// Принадлежность прибора линии выводится из panel.lines[].deviceIds,
// а не дублируется в самом приборе.
export function buildDeviceLineMap(
  panel: ElectricalPanel | null
): Map<string, CircuitLine> {
  const map = new Map<string, CircuitLine>();
  if (!panel) return map;
  for (const line of panel.lines) {
    for (const deviceId of line.deviceIds) {
      if (!map.has(deviceId)) map.set(deviceId, line);
    }
  }
  return map;
}

export function collectUnassignedDevices(
  devices: ElectricalDevice[],
  panel: ElectricalPanel | null
): ElectricalDevice[] {
  if (!panel) return [];
  const assigned = new Set<string>();
  for (const line of panel.lines) {
    for (const deviceId of line.deviceIds) assigned.add(deviceId);
  }
  return devices.filter((device) => !assigned.has(device.id));
}

// После удаления приборов или комнат чистим ссылки, чтобы в линиях
// не оставались «висячие» id.
export function prunePanelRefs(
  panel: ElectricalPanel | null,
  existingDeviceIds: Iterable<string>,
  existingRoomIds: Iterable<string>
): ElectricalPanel | null {
  if (!panel) return null;
  const deviceIds = new Set(existingDeviceIds);
  const roomIds = new Set(existingRoomIds);

  let changed = false;
  const lines = panel.lines.map((line) => {
    const nextDeviceIds = line.deviceIds.filter((id) => deviceIds.has(id));
    const nextRoomIds = line.roomIds.filter((id) => roomIds.has(id));
    if (
      nextDeviceIds.length === line.deviceIds.length &&
      nextRoomIds.length === line.roomIds.length
    ) {
      return line;
    }
    changed = true;
    return { ...line, deviceIds: nextDeviceIds, roomIds: nextRoomIds };
  });

  return changed ? { ...panel, lines } : panel;
}

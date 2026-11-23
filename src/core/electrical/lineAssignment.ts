import type { CircuitLine, ElectricalDevice, ElectricalPanel } from '../../types';
import { LINE_PRESETS } from './norms';
import { recalculateLine } from './panel';

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
// не оставались «висячие» id. Вместе с составом пересчитываются нагрузка,
// автомат и номинал АВДТ — иначе линия хранит мощность удалённых приборов.
export function prunePanelRefs(
  panel: ElectricalPanel | null,
  devices: ElectricalDevice[],
  existingRoomIds: Iterable<string>
): ElectricalPanel | null {
  if (!panel) return null;
  const byId = new Map(devices.map((device) => [device.id, device]));
  const roomIds = new Set(existingRoomIds);

  let changed = false;
  const lines = panel.lines.map((line) => {
    const nextDeviceIds = line.deviceIds.filter((id) => byId.has(id));
    const nextRoomIds = line.roomIds.filter((id) => roomIds.has(id));
    if (
      nextDeviceIds.length === line.deviceIds.length &&
      nextRoomIds.length === line.roomIds.length
    ) {
      return line;
    }
    changed = true;
    const preset = LINE_PRESETS[line.purpose] ?? LINE_PRESETS.other;
    const loadW =
      nextDeviceIds.length === 0
        ? preset.loadW
        : Math.max(
            preset.loadW,
            nextDeviceIds.reduce(
              (sum, id) => sum + (byId.get(id)?.powerWatts ?? 0),
              0
            )
          );
    const next = recalculateLine({
      ...line,
      deviceIds: nextDeviceIds,
      roomIds: nextRoomIds,
      loadW,
    });
    return next.combinedProtection && next.rcd
      ? { ...next, rcd: { ...next.rcd, ratingA: next.breaker.ratingA } }
      : next;
  });

  return changed ? { ...panel, lines } : panel;
}

import type { CircuitLine, ElectricalDevice, ElectricalPanel } from '../../types';
import { LINE_PRESETS } from './norms';
import { recalculateLine } from './panel';
import { deviceLineSlotCount, deviceSlotsPowerW, deviceWholeSlots } from './devices';

// Принадлежность прибора линии выводится из panel.lines[].deviceIds,
// а распределение по слотам (клавишам/каналам) — из slotMembers.
// Обратная ссылка у прибора не дублируется.
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

export interface DeviceLineMembership {
  line: CircuitLine;
  slots: number[];
}

function validSlots(slots: unknown, count: number): number[] {
  if (!Array.isArray(slots) || count <= 0) return [];
  const unique = new Set<number>();
  for (const slot of slots) {
    if (Number.isSafeInteger(slot) && slot >= 0 && slot < count) unique.add(slot);
  }
  return [...unique];
}

/** Слоты прибора в линии: явные из slotMembers или все слоты прибора. */
export function lineDeviceSlots(
  line: CircuitLine,
  device: Pick<ElectricalDevice, 'id' | 'type'>
): number[] | null {
  if (!line.deviceIds.includes(device.id)) return null;
  const explicit = line.slotMembers?.[device.id];
  if (explicit === undefined) return deviceWholeSlots(device);
  return validSlots(explicit, deviceLineSlotCount(device));
}

export function linesOfDevice(
  panel: ElectricalPanel | null,
  device: Pick<ElectricalDevice, 'id' | 'type'>
): DeviceLineMembership[] {
  if (!panel) return [];
  const result: DeviceLineMembership[] = [];
  for (const line of panel.lines) {
    const slots = lineDeviceSlots(line, device);
    if (slots !== null) result.push({ line, slots });
  }
  return result;
}

export function slotOwner(
  panel: ElectricalPanel | null,
  device: Pick<ElectricalDevice, 'id' | 'type'>,
  slot: number
): CircuitLine | null {
  if (!panel) return null;
  for (const line of panel.lines) {
    if (lineDeviceSlots(line, device)?.includes(slot)) return line;
  }
  return null;
}

/** Слоты прибора, ещё не закреплённые ни за одной линией. */
export function freeDeviceSlots(
  panel: ElectricalPanel | null,
  device: Pick<ElectricalDevice, 'id' | 'type'>
): number[] {
  const claimed = new Set<number>();
  for (const membership of linesOfDevice(panel, device)) {
    for (const slot of membership.slots) claimed.add(slot);
  }
  return deviceWholeSlots(device).filter((slot) => !claimed.has(slot));
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

/** Приборы, уже входящие в линии, но со свободными клавишами: они видны
 *  как замечание «клавиша N не назначена», а не как «прибор вне линий». */
export function collectDevicesWithFreeSlots(
  devices: ElectricalDevice[],
  panel: ElectricalPanel | null
): { device: ElectricalDevice; slots: number[] }[] {
  if (!panel) return [];
  const result: { device: ElectricalDevice; slots: number[] }[] = [];
  for (const device of devices) {
    if (deviceLineSlotCount(device) < 2) continue;
    if (linesOfDevice(panel, device).length === 0) continue;
    const slots = freeDeviceSlots(panel, device);
    if (slots.length > 0) result.push({ device, slots });
  }
  return result;
}

function sameSlots(
  a: Record<string, number[]> | undefined,
  b: Record<string, number[]> | undefined
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const other = right[key];
    const mine = left[key];
    return (
      Array.isArray(other) &&
      mine.length === other.length &&
      mine.every((slot, index) => slot === other[index])
    );
  });
}

// После удаления приборов или комнат чистим ссылки, чтобы в линиях
// не оставались «висячие» id. Вместе с составом пересчитываются нагрузка,
// автомат и номинал АВДТ — иначе линия хранит мощность удалённых приборов.
// Слоты нормализуются здесь же: прибор в двух линиях допустим только
// разными слотами, слот достаётся первой линии в порядке списка.
export function prunePanelRefs(
  panel: ElectricalPanel | null,
  devices: ElectricalDevice[],
  existingRoomIds: Iterable<string>
): ElectricalPanel | null {
  if (!panel) return null;
  const byId = new Map(devices.map((device) => [device.id, device]));
  const roomIds = new Set(existingRoomIds);
  const claimed = new Map<string, Set<number>>();

  let changed = false;
  const lines = panel.lines.map((line) => {
    const seen = new Set<string>();
    const nextDeviceIds: string[] = [];
    const nextSlotMembers: Record<string, number[]> = {};

    for (const deviceId of line.deviceIds) {
      if (seen.has(deviceId)) continue;
      seen.add(deviceId);
      const device = byId.get(deviceId);
      if (!device) continue;

      const taken = claimed.get(deviceId) ?? new Set<number>();
      const count = deviceLineSlotCount(device);
      if (count <= 0) {
        // Закладная: собственных слотов нет, но линия может её содержать.
        // Повтор в другой линии отбрасывается — кабель к точке один.
        if (taken.size > 0) continue;
        taken.add(0);
        claimed.set(deviceId, taken);
        nextDeviceIds.push(deviceId);
        continue;
      }

      const explicit = line.slotMembers?.[deviceId];

      if (explicit === undefined) {
        // Весь прибор: если его слоты уже заняты другой линией — отбрасываем.
        if (taken.size > 0) continue;
        for (let slot = 0; slot < count; slot += 1) taken.add(slot);
        claimed.set(deviceId, taken);
        nextDeviceIds.push(deviceId);
        continue;
      }

      const slots = validSlots(explicit, count).filter((slot) => !taken.has(slot));
      if (slots.length === 0) continue;
      for (const slot of slots) taken.add(slot);
      claimed.set(deviceId, taken);
      nextDeviceIds.push(deviceId);
      // Полный набор слотов храним неявно: просто все слоты прибора.
      if (slots.length < count) nextSlotMembers[deviceId] = slots;
    }

    const nextRoomIds = line.roomIds.filter((id) => roomIds.has(id));
    const hasSlotMembers = Object.keys(nextSlotMembers).length > 0;
    const devicesUnchanged =
      nextDeviceIds.length === line.deviceIds.length &&
      nextDeviceIds.every((id, index) => id === line.deviceIds[index]);
    const roomsUnchanged = nextRoomIds.length === line.roomIds.length;
    const slotsUnchanged = sameSlots(
      hasSlotMembers ? nextSlotMembers : undefined,
      line.slotMembers
    );
    if (devicesUnchanged && roomsUnchanged && slotsUnchanged) return line;

    changed = true;
    const preset = LINE_PRESETS[line.purpose] ?? LINE_PRESETS.other;
    const loadW =
      nextDeviceIds.length === 0
        ? preset.loadW
        : Math.max(
            preset.loadW,
            nextDeviceIds.reduce((sum, deviceId) => {
              const device = byId.get(deviceId);
              if (!device) return sum;
              const partial = nextSlotMembers[deviceId];
              return (
                sum +
                (partial ? deviceSlotsPowerW(device, partial) : device.powerWatts)
              );
            }, 0)
          );
    const next = recalculateLine({
      ...line,
      deviceIds: nextDeviceIds,
      roomIds: nextRoomIds,
      loadW,
    });
    if (hasSlotMembers) next.slotMembers = nextSlotMembers;
    else delete next.slotMembers;
    return next.combinedProtection && next.rcd
      ? { ...next, rcd: { ...next.rcd, ratingA: next.breaker.ratingA } }
      : next;
  });

  return changed ? { ...panel, lines } : panel;
}

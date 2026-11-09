import type {
  CircuitLine,
  DeviceAnchor,
  DeviceRoomEdgeAnchor,
  DevicePartitionAnchor,
  ElectricalDevice,
  ElectricalPanel,
  FreePartition,
  LinePurpose,
  LineRouting,
  PanelStrategy,
  PanelSupply,
  RoomType,
  RoomZone,
} from '../../types';
import { resolveDevice, type DevicePose } from './devices';
import {
  LINE_PRESETS,
  applyPresetToLine,
  breakerForCurrent,
  cableForBreaker,
  calculateInput,
  makeBreaker,
  makeCable,
  makeRcd,
  loadCurrentA,
} from './norms';

export const PANEL_SYMBOL_WIDTH_MM = 360;
export const PANEL_SYMBOL_DEPTH_MM = 140;

export type PanelWallAnchor = DeviceRoomEdgeAnchor | DevicePartitionAnchor;

export function defaultPanelSupply(allocatedPowerW = 10000): PanelSupply {
  const input = calculateInput(allocatedPowerW);
  return {
    allocatedPowerW,
    voltageV: 230,
    inputCable: makeCable(input.cableSectionMm2),
    inputBreaker: makeBreaker(input.breakerRatingA, 'C'),
    meter: { enabled: true },
    mainRcd: makeRcd(100, 'A', input.breakerRatingA),
    voltageRelay: true,
    surgeProtection: true,
  };
}

export function createEmptyPanel(anchor: PanelWallAnchor): ElectricalPanel {
  return {
    id: `panel-${Date.now()}`,
    name: 'Электрощит',
    anchor,
    heightFromFloorMm: 1600,
    mounting: 'flush',
    supply: defaultPanelSupply(),
    strategy: 'optimal',
    lines: [],
  };
}

// -------------------------------------------------------------
// Символ щитка на плане: переиспользуем движок устройств,
// подставив фиктивное устройство с тем же якорем.
// -------------------------------------------------------------
export function resolvePanelPose(
  panel: ElectricalPanel,
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): DevicePose | null {
  const proxy: ElectricalDevice = {
    id: panel.id,
    type: 'socket_single',
    name: panel.name,
    anchor: panel.anchor as DeviceAnchor,
    heightFromFloorMm: panel.heightFromFloorMm,
    powerWatts: 0,
    shared: false,
  };
  return resolveDevice(proxy, rooms, partitions, thickness)?.poses[0] ?? null;
}

export function sanitizePanel(
  panel: ElectricalPanel | null | undefined,
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): ElectricalPanel | null {
  if (!panel) return null;
  if (resolvePanelPose(panel, rooms, partitions, thickness) === null) return null;
  return {
    ...panel,
    lines: sanitizeLines(panel.lines),
    supply: sanitizeSupply(panel.supply),
  };
}

function sanitizeSupply(supply: PanelSupply): PanelSupply {
  const allocated = Number.isFinite(supply.allocatedPowerW)
    ? Math.max(1000, supply.allocatedPowerW)
    : 10000;
  return { ...supply, allocatedPowerW: allocated, voltageV: 230 };
}

function sanitizeLines(lines: CircuitLine[]): CircuitLine[] {
  return lines
    .filter((line) => Number.isFinite(line.loadW) && line.loadW >= 0)
    .map((line) => ({
      ...line,
      loadW: Math.max(0, line.loadW),
      roomIds: line.roomIds ?? [],
      deviceIds: line.deviceIds ?? [],
      colorIndex:
        Number.isInteger(line.colorIndex) && (line.colorIndex as number) >= 0
          ? line.colorIndex
          : undefined,
      routing:
        line.routing === 'ceiling' || line.routing === 'floor' ? line.routing : undefined,
    }));
}

// -------------------------------------------------------------
// Черновик линий из фактически расставленных приборов, по комнатам.
// -------------------------------------------------------------

export function roomPurposeFor(room: RoomZone, hasWetSocket: boolean): LinePurpose {
  if (hasWetSocket) return 'wet';
  if (room.type === 'bathroom' || room.type === 'toilet') return 'wet';
  if (room.type === 'kitchen') return 'kitchen';
  return 'sockets';
}

export function linePurposeFor(device: ElectricalDevice, room: RoomZone): LinePurpose {
  const isLighting =
    device.type === 'light_ceiling' || device.type.startsWith('switch_');
  return isLighting
    ? 'lighting'
    : roomPurposeFor(room, device.type === 'socket_wet');
}


export function autoLinesFromDevices(
  devices: ElectricalDevice[],
  rooms: RoomZone[],
  partitions: FreePartition[],
  routing?: LineRouting
): CircuitLine[] {
  const groups = new Map<string, { room: RoomZone; purpose: LinePurpose; devices: ElectricalDevice[] }>();

  for (const device of devices) {
    const anchor = device.anchor;
    const roomId =
      anchor.kind === 'partition'
        ? partitions.find((partition) => partition.id === anchor.partitionId)?.roomId ?? null
        : anchor.roomId;
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (!room) continue;

    const purpose = linePurposeFor(device, room);
    const key = `${room.id}:${purpose}`;
    const existing = groups.get(key);
    if (existing) {
      existing.devices.push(device);
    } else {
      groups.set(key, { room, purpose, devices: [device] });
    }
  }

  const lines: CircuitLine[] = [];
  for (const group of groups.values()) {
    const preset = LINE_PRESETS[group.purpose];
    const loadW = Math.max(
      preset.loadW,
      group.devices.reduce((sum, device) => sum + (device.powerWatts || 0), 0)
    );
    const line: CircuitLine = {
      id: `line-${group.room.id}-${group.purpose}-${lines.length}`,
      name: `${group.room.name} — ${preset.label}`,
      purpose: group.purpose,
      roomIds: [group.room.id],
      deviceIds: group.devices.map((device) => device.id),
      loadW,
      cable: makeCable(preset.cableSectionMm2),
      breaker: makeBreaker(preset.breakerRatingA, preset.curve),
      rcd: preset.needsRcd
        ? makeRcd(preset.rcd!.sensitivityMa, preset.rcd!.type, preset.breakerRatingA)
        : null,
      routing,
    };
    lines.push(applyPresetToLine(line));
  }

  // Освещение и розетки — первыми, затем влажные зоны и техника.
  const order: LinePurpose[] = [
    'lighting',
    'sockets',
    'wet',
    'kitchen',
    'washing',
    'hob',
    'oven',
    'ac',
    'heating',
    'other',
  ];
  return lines.sort((a, b) => order.indexOf(a.purpose) - order.indexOf(b.purpose));
}

// -------------------------------------------------------------
// Стратегии компоновки: дешёвая, оптимальная, максимальная защита.
// -------------------------------------------------------------
export function applyStrategy(panel: ElectricalPanel, strategy: PanelStrategy): ElectricalPanel {
  if (strategy === 'custom') {
    return { ...panel, strategy };
  }

  const inputRating = calculateInput(panel.supply.allocatedPowerW).breakerRatingA;
  const lines = panel.lines.map((line) => applyPresetToLine(line));

  if (strategy === 'budget') {
    // Одно общее УЗО 30 мА на все линии вместо отдельных на каждую.
    return {
      ...panel,
      strategy,
      supply: {
        ...panel.supply,
        mainRcd: makeRcd(30, 'AC', inputRating),
        voltageRelay: false,
        surgeProtection: false,
      },
      lines: lines.map((line) => ({ ...line, rcd: null })),
    };
  }

  if (strategy === 'optimal') {
    // Ввод — селективное противопожарное 100 мА, мокрые зоны — свои 30 мА.
    return {
      ...panel,
      strategy,
      supply: {
        ...panel.supply,
        mainRcd: makeRcd(100, 'A', inputRating),
        voltageRelay: true,
        surgeProtection: true,
      },
      lines: lines.map((line) =>
        line.purpose === 'lighting'
          ? { ...line, rcd: null }
          : { ...line, rcd: makeRcd(30, 'A', line.breaker.ratingA) }
      ),
    };
  }

  // maximum: дифзащита на каждой линии, включая освещение.
  return {
    ...panel,
    strategy,
    supply: {
      ...panel.supply,
      mainRcd: makeRcd(100, 'A', inputRating),
      voltageRelay: true,
      surgeProtection: true,
    },
    lines: lines.map((line) => ({
      ...line,
      rcd: makeRcd(30, 'A', line.breaker.ratingA),
    })),
  };
}

export function createLine(
  purpose: LinePurpose,
  roomIds: string[],
  roomName: string,
  existingCount: number,
  routing?: LineRouting
): CircuitLine {
  const preset = LINE_PRESETS[purpose];
  const line: CircuitLine = {
    id: `line-${Date.now()}-${existingCount}`,
    name: `${roomName} — ${preset.label}`,
    purpose,
    roomIds,
    deviceIds: [],
    loadW: preset.loadW,
    cable: makeCable(preset.cableSectionMm2),
    breaker: makeBreaker(preset.breakerRatingA, preset.curve),
    rcd: preset.needsRcd
      ? makeRcd(preset.rcd!.sensitivityMa, preset.rcd!.type, preset.breakerRatingA)
      : null,
    routing,
  };
  return applyPresetToLine(line);
}

// Пересчёт только аппаратов защиты по нагрузке. Ручной выбор УЗО сохраняется.
export function recalculateLine(line: CircuitLine): CircuitLine {
  const preset = LINE_PRESETS[line.purpose];
  const currentA = loadCurrentA(line.loadW);
  const breakerRatingA = Math.max(
    preset.breakerRatingA,
    breakerForCurrent(currentA, 63)
  );
  const cableSectionMm2 = Math.max(
    preset.cableSectionMm2,
    cableForBreaker(breakerRatingA)
  );
  return {
    ...line,
    cable: makeCable(cableSectionMm2),
    breaker: makeBreaker(breakerRatingA, preset.curve),
  };
}

export function recalculateSupply(supply: PanelSupply): PanelSupply {
  const input = calculateInput(supply.allocatedPowerW);
  return {
    ...supply,
    inputCable: makeCable(input.cableSectionMm2),
    inputBreaker: makeBreaker(input.breakerRatingA, 'C'),
    mainRcd: supply.mainRcd
      ? { ...supply.mainRcd, ratingA: input.breakerRatingA }
      : null,
  };
}

export function lineCurrentA(line: CircuitLine): number {
  return loadCurrentA(line.loadW);
}

export function isWetPurpose(purpose: LinePurpose): boolean {
  return purpose === 'wet';
}

export function isSocketPurpose(purpose: LinePurpose): boolean {
  return (
    purpose === 'sockets' ||
    purpose === 'wet' ||
    purpose === 'kitchen' ||
    purpose === 'hob' ||
    purpose === 'oven' ||
    purpose === 'washing' ||
    purpose === 'ac' ||
    purpose === 'heating' ||
    purpose === 'other'
  );
}

export function roomTypeLabel(type: RoomType): string {
  const labels: Record<RoomType, string> = {
    living: 'Гостиная',
    bedroom: 'Спальня',
    kitchen: 'Кухня',
    bathroom: 'Ванная',
    toilet: 'Санузел',
    corridor: 'Коридор',
    balcony: 'Балкон',
    storage: 'Гардеробная',
    custom: 'Комната',
  };
  return labels[type];
}

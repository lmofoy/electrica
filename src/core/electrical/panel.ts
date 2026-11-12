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
  Point2D,
  RoomType,
  RoomZone,
} from '../../types';
import { resolveDevice, type DevicePose } from './devices';
import { sanitizeManualRoute } from './manualRoute';
import {
  CABLE_BRAND,
  LINE_PRESETS,
  applyPresetToLine,
  breakerForCurrent,
  cableForBreaker,
  calculateInput,
  lineDesignCurrentA,
  makeBreaker,
  makeCable,
  makeRcd,
  normalizeCosPhi,
  normalizeDemandFactor,
} from './norms';

export const PANEL_SYMBOL_WIDTH_MM = 360;
export const PANEL_SYMBOL_DEPTH_MM = 140;

export type PanelWallAnchor = DeviceRoomEdgeAnchor | DevicePartitionAnchor;

export function defaultPanelSupply(allocatedPowerW = 10000): PanelSupply {
  const input = calculateInput(allocatedPowerW);
  return {
    allocatedPowerW,
    voltageV: 230,
    phases: 1,
    system: 'TN-S',
    reliabilityCategory: 'III',
    cosPhi: 0.96,
    demandFactor: 1,
    cableBrand: CABLE_BRAND,
    inputCable: makeCable(input.cableSectionMm2),
    inputBreaker: makeBreaker(input.breakerRatingA, 'C'),
    meter: { enabled: true },
    mainRcd: makeRcd(100, 'A', input.breakerRatingA, true),
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
  const phases: 1 | 3 = supply.phases === 3 ? 3 : 1;
  const mainRcd = supply.mainRcd
    ? {
        ...supply.mainRcd,
        poles: phases === 3 ? (4 as const) : (2 as const),
        selective: Boolean(supply.mainRcd.selective),
      }
    : null;
  return {
    ...supply,
    allocatedPowerW: allocated,
    voltageV: 230,
    phases,
    system: supply.system === 'TN-C-S' ? 'TN-C-S' : 'TN-S',
    reliabilityCategory:
      supply.reliabilityCategory === 'I' || supply.reliabilityCategory === 'II'
        ? supply.reliabilityCategory
        : 'III',
    cosPhi: normalizeCosPhi(supply.cosPhi),
    demandFactor: normalizeDemandFactor(supply.demandFactor),
    cableBrand:
      typeof supply.cableBrand === 'string' && supply.cableBrand.trim().length > 0
        ? supply.cableBrand.trim()
        : CABLE_BRAND,
    mainRcd,
  };
}

function sanitizeLines(lines: CircuitLine[]): CircuitLine[] {
  return lines
    .filter((line) => Number.isFinite(line.loadW) && line.loadW >= 0)
    .map((line) => ({
      ...line,
      loadW: Math.max(0, line.loadW),
      cosPhi: line.cosPhi === undefined ? undefined : normalizeCosPhi(line.cosPhi),
      demandFactor:
        line.demandFactor === undefined ? undefined : normalizeDemandFactor(line.demandFactor),
      phase:
        line.phase === 'L1' || line.phase === 'L2' || line.phase === 'L3'
          ? line.phase
          : undefined,
      roomIds: line.roomIds ?? [],
      deviceIds: line.deviceIds ?? [],
      colorIndex:
        Number.isInteger(line.colorIndex) && (line.colorIndex as number) >= 0
          ? line.colorIndex
          : undefined,
      routing:
        line.routing === 'ceiling' || line.routing === 'floor' ? line.routing : undefined,
      manualRoute: sanitizeManualRoute(line.manualRoute),
      waypoints: sanitizeWaypoints(line.waypoints),
    }));
}

function sanitizeWaypoints(waypoints: CircuitLine['waypoints']): Point2D[] | undefined {
  if (!Array.isArray(waypoints)) return undefined;
  const valid = waypoints.filter(
    (point) =>
      point && Number.isFinite(point.x) && Number.isFinite(point.y)
  );
  return valid.length > 0 ? valid.map((point) => ({ x: point.x, y: point.y })) : undefined;
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
// Освещение в ванной и санузле относится к влажной зоне: по ГОСТ Р 50571.4.41
// все цепи такой зоны требуют дополнительной защиты 30 мА, включая свет.
function needsOwnRcd(line: CircuitLine, rooms?: RoomZone[]): boolean {
  if (line.purpose !== 'lighting') return true;
  if (!rooms) return false;
  return line.roomIds.some((roomId) => {
    const room = rooms.find((candidate) => candidate.id === roomId);
    return room?.type === 'bathroom' || room?.type === 'toilet';
  });
}

function mainRcdFor(panel: ElectricalPanel, sensitivityMa: number, selective: boolean) {
  const inputRating = calculateInput(
    panel.supply.allocatedPowerW,
    panel.supply.cosPhi
  ).breakerRatingA;
  const rcd = makeRcd(sensitivityMa, 'A', inputRating, selective);
  return panel.supply.phases === 3 ? { ...rcd, poles: 4 as const } : rcd;
}

export function applyStrategy(
  panel: ElectricalPanel,
  strategy: PanelStrategy,
  rooms?: RoomZone[]
): ElectricalPanel {
  if (strategy === 'custom') {
    return { ...panel, strategy };
  }

  const lines = panel.lines.map((line) => applyPresetToLine(line));

  if (strategy === 'budget') {
    // Одно общее УЗО 30 мА типа A на все линии вместо отдельных на каждую.
    return {
      ...panel,
      strategy,
      supply: {
        ...panel.supply,
        mainRcd: mainRcdFor(panel, 30, false),
        voltageRelay: false,
        surgeProtection: false,
      },
      lines: lines.map((line) => ({ ...line, rcd: null })),
    };
  }

  if (strategy === 'optimal') {
    // Ввод — селективное противопожарное 100 мА, группы — свои 30 мА.
    // Свет в ванной и санузле защищается так же, как розетки влажной зоны.
    return {
      ...panel,
      strategy,
      supply: {
        ...panel.supply,
        mainRcd: mainRcdFor(panel, 100, true),
        voltageRelay: true,
        surgeProtection: true,
      },
      lines: lines.map((line) =>
        needsOwnRcd(line, rooms)
          ? { ...line, rcd: makeRcd(30, 'A', line.breaker.ratingA) }
          : { ...line, rcd: null }
      ),
    };
  }

  // maximum: дифзащита на каждой линии, включая освещение.
  return {
    ...panel,
    strategy,
    supply: {
      ...panel.supply,
      mainRcd: mainRcdFor(panel, 100, true),
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
  const currentA = lineDesignCurrentA(line);
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
  const input = calculateInput(supply.allocatedPowerW, supply.cosPhi);
  const phases: 1 | 3 = supply.phases === 3 ? 3 : 1;
  return {
    ...supply,
    inputCable: makeCable(input.cableSectionMm2, phases === 3 ? 5 : 3),
    inputBreaker: makeBreaker(input.breakerRatingA, 'C'),
    mainRcd: supply.mainRcd
      ? {
          ...supply.mainRcd,
          ratingA: input.breakerRatingA,
          poles: phases === 3 ? 4 : 2,
        }
      : null,
  };
}

export function lineCurrentA(line: CircuitLine): number {
  return lineDesignCurrentA(line);
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

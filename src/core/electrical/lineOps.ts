import type {
  CircuitLine,
  ElectricalDevice,
  ElectricalPanel,
  FreePartition,
  LinePurpose,
  LineRouting,
  PanelStrategy,
  RoomZone,
} from '../../types';
import {
  LINE_PRESETS,
  makeBreaker,
  makeCable,
  makeRcd,
} from './norms';
import {
  linePurposeFor,
  recalculateLine,
} from './panel';
import { DEVICE_CATALOG } from './devices';

// Операции над составом линий. Прибор принадлежит ровно одной линии,
// единственный источник истины — panel.lines[].deviceIds.
export interface LineOpsContext {
  devices: ElectricalDevice[];
  rooms: RoomZone[];
  partitions: FreePartition[];
}

export interface LineCreateOptions {
  purpose: LinePurpose;
  name?: string;
  routing?: LineRouting;
  template?: CircuitLine | null; // откуда скопировать защиту (деление)
  applyStrategy?: boolean; // новые линии из «Дособрать новые»
}

export interface LineCreateResult {
  panel: ElectricalPanel;
  lineId: string;
}

export interface AppendDevicesResult {
  panel: ElectricalPanel;
  assigned: number;
  created: number;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function deviceRoomId(
  device: ElectricalDevice,
  rooms: RoomZone[],
  partitions: FreePartition[]
): string | null {
  const anchor = device.anchor;
  const roomId =
    anchor.kind === 'partition'
      ? partitions.find((partition) => partition.id === anchor.partitionId)?.roomId ?? null
      : anchor.roomId;
  return rooms.some((room) => room.id === roomId) ? roomId : null;
}

function roomsForDevices(
  deviceIds: string[],
  ctx: LineOpsContext
): string[] {
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const roomIds: string[] = [];
  for (const deviceId of deviceIds) {
    const device = byId.get(deviceId);
    if (!device) continue;
    const roomId = deviceRoomId(device, ctx.rooms, ctx.partitions);
    if (roomId) roomIds.push(roomId);
  }
  return unique(roomIds);
}

function applyStrategyProtection(
  line: CircuitLine,
  strategy: PanelStrategy
): CircuitLine {
  if (strategy === 'budget') return { ...line, rcd: null };
  if (strategy === 'optimal') {
    return line.purpose === 'lighting'
      ? { ...line, rcd: null }
      : { ...line, rcd: makeRcd(30, 'A', line.breaker.ratingA) };
  }
  if (strategy === 'maximum') {
    return { ...line, rcd: makeRcd(30, 'A', line.breaker.ratingA) };
  }
  return line;
}

// Пересобирает состав линии: приборы, комнаты, нагрузку и аппараты защиты.
function withComposition(
  line: CircuitLine,
  deviceIds: string[],
  ctx: LineOpsContext
): CircuitLine {
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const ids = unique(deviceIds.filter((deviceId) => byId.has(deviceId)));
  const preset = LINE_PRESETS[line.purpose];

  if (ids.length === 0) {
    return recalculateLine({
      ...line,
      deviceIds: [],
      loadW: preset.loadW,
    });
  }

  const loadW = Math.max(
    preset.loadW,
    ids.reduce((sum, deviceId) => sum + (byId.get(deviceId)?.powerWatts ?? 0), 0)
  );
  const roomIds = roomsForDevices(ids, ctx);

  return recalculateLine({
    ...line,
    deviceIds: ids,
    roomIds: roomIds.length > 0 ? roomIds : line.roomIds,
    loadW,
  });
}

function nextLineId(panel: ElectricalPanel): string {
  const base = Date.now();
  let index = 0;
  let id = `line-${base}-${index}`;
  while (panel.lines.some((line) => line.id === id)) {
    index += 1;
    id = `line-${base}-${index}`;
  }
  return id;
}

export function nextColorIndex(panel: ElectricalPanel): number {
  const used = new Set<number>();
  panel.lines.forEach((line, index) => used.add(line.colorIndex ?? index));
  let index = 0;
  while (used.has(index)) index += 1;
  return index;
}

function uniqueLineName(panel: ElectricalPanel, base: string): string {
  const names = new Set(panel.lines.map((line) => line.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

function defaultLineName(
  purpose: LinePurpose,
  roomIds: string[],
  ctx: LineOpsContext
): string {
  const preset = LINE_PRESETS[purpose];
  const room = roomIds.length > 0
    ? ctx.rooms.find((candidate) => candidate.id === roomIds[0])
    : undefined;
  return room ? `${room.name} — ${preset.label}` : preset.label;
}

// Нормализация: прибор не может входить в две линии (побеждает первая),
// каждой линии выдаётся стабильный цвет.
export function normalizeLineAssignments(panel: ElectricalPanel): ElectricalPanel {
  const seen = new Set<string>();
  const usedColors = new Set<number>();
  panel.lines.forEach((line, index) => {
    usedColors.add(line.colorIndex ?? index);
  });

  let changed = false;
  let nextColor = 0;

  const lines = panel.lines.map((line) => {
    let next = line;

    if (next.colorIndex === undefined) {
      while (usedColors.has(nextColor)) nextColor += 1;
      usedColors.add(nextColor);
      next = { ...next, colorIndex: nextColor };
      changed = true;
    }

    const deviceIds = line.deviceIds.filter((deviceId) => {
      if (seen.has(deviceId)) return false;
      seen.add(deviceId);
      return true;
    });
    if (deviceIds.length !== line.deviceIds.length) {
      next = { ...next, deviceIds };
      changed = true;
    }

    return next;
  });

  return changed ? { ...panel, lines } : panel;
}

// Назначить приборы линии. Из прежних линий они удаляются автоматически.
export function assignDevices(
  panel: ElectricalPanel,
  lineId: string,
  deviceIds: string[],
  ctx: LineOpsContext
): ElectricalPanel {
  if (!panel.lines.some((line) => line.id === lineId)) return panel;
  const ids = new Set(deviceIds.filter((id) => ctx.devices.some((d) => d.id === id)));
  if (ids.size === 0) return panel;

  const lines = panel.lines.map((line) => {
    if (line.id === lineId) {
      return withComposition(line, [...line.deviceIds, ...ids], ctx);
    }
    if (line.deviceIds.some((id) => ids.has(id))) {
      return withComposition(
        line,
        line.deviceIds.filter((id) => !ids.has(id)),
        ctx
      );
    }
    return line;
  });

  return { ...panel, lines };
}

// Заменить состав линии целиком одним действием (диалог состава).
export function setComposition(
  panel: ElectricalPanel,
  lineId: string,
  deviceIds: string[],
  ctx: LineOpsContext
): ElectricalPanel {
  if (!panel.lines.some((line) => line.id === lineId)) return panel;
  const knownIds = new Set(ctx.devices.map((device) => device.id));
  const ids = new Set(deviceIds.filter((id) => knownIds.has(id)));

  let changed = false;
  const lines = panel.lines.map((line) => {
    if (line.id === lineId) {
      const next = ids.size === line.deviceIds.length
        && line.deviceIds.every((id) => ids.has(id));
      if (next) return line;
      changed = true;
      return withComposition(line, [...ids], ctx);
    }
    if (line.deviceIds.some((id) => ids.has(id))) {
      changed = true;
      return withComposition(
        line,
        line.deviceIds.filter((id) => !ids.has(id)),
        ctx
      );
    }
    return line;
  });

  return changed ? { ...panel, lines } : panel;
}

// Убрать приборы из всех линий — они станут «вне линий».
export function unassignDevices(
  panel: ElectricalPanel,
  deviceIds: string[],
  ctx: LineOpsContext
): ElectricalPanel {
  const ids = new Set(deviceIds);
  if (ids.size === 0) return panel;

  let changed = false;
  const lines = panel.lines.map((line) => {
    if (!line.deviceIds.some((id) => ids.has(id))) return line;
    changed = true;
    return withComposition(
      line,
      line.deviceIds.filter((id) => !ids.has(id)),
      ctx
    );
  });

  return changed ? { ...panel, lines } : panel;
}

// Новая линия из выбранных приборов. Приборы забираются из прежних линий.
export function createLineFromDevices(
  panel: ElectricalPanel,
  deviceIds: string[],
  options: LineCreateOptions,
  ctx: LineOpsContext
): LineCreateResult {
  const knownIds = new Set(ctx.devices.map((device) => device.id));
  const ids = unique(deviceIds.filter((id) => knownIds.has(id)));
  const preset = LINE_PRESETS[options.purpose];
  const roomIds = roomsForDevices(ids, ctx);
  const fallbackName = defaultLineName(options.purpose, roomIds, ctx);

  const base = options.template
    ? {
        ...options.template,
        id: nextLineId(panel),
        name: uniqueLineName(panel, options.name ?? options.template.name),
        deviceIds: [],
        roomIds,
        colorIndex: nextColorIndex(panel),
        loadW: preset.loadW,
        routing: options.routing ?? options.template.routing,
      }
    : {
        id: nextLineId(panel),
        name: uniqueLineName(panel, options.name ?? fallbackName),
        purpose: options.purpose,
        deviceIds: [],
        roomIds,
        colorIndex: nextColorIndex(panel),
        loadW: preset.loadW,
        cable: makeCable(preset.cableSectionMm2),
        breaker: makeBreaker(preset.breakerRatingA, preset.curve),
        rcd: preset.needsRcd
          ? makeRcd(preset.rcd!.sensitivityMa, preset.rcd!.type, preset.breakerRatingA)
          : null,
        routing: options.routing,
      };

  const idSet = new Set(ids);
  const lines = panel.lines.map((line) =>
    line.deviceIds.some((id) => idSet.has(id))
      ? withComposition(line, line.deviceIds.filter((id) => !idSet.has(id)), ctx)
      : line
  );

  let line = withComposition(base, ids, ctx);
  if (options.applyStrategy) {
    line = applyStrategyProtection(line, panel.strategy);
  }

  return {
    panel: { ...panel, lines: [...lines, line] },
    lineId: line.id,
  };
}

// Деление: выбранные приборы уходят в новую линию, защита копируется
// с исходной и пересчитывается по новой нагрузке.
export function splitLine(
  panel: ElectricalPanel,
  lineId: string,
  deviceIds: string[],
  ctx: LineOpsContext,
  newPurpose?: LinePurpose
): LineCreateResult | null {
  const source = panel.lines.find((line) => line.id === lineId);
  if (!source) return null;

  const moving = source.deviceIds.filter((id) => deviceIds.includes(id));
  if (moving.length === 0 || moving.length === source.deviceIds.length) return null;

  const purpose = newPurpose ?? source.purpose;
  return createLineFromDevices(
    panel,
    moving,
    {
      purpose,
      template: purpose === source.purpose ? source : null,
      routing: source.routing,
    },
    ctx
  );
}

export function mergeLines(
  panel: ElectricalPanel,
  lineIds: string[],
  ctx: LineOpsContext
): LineCreateResult | null {
  const ids = unique(lineIds);
  if (ids.length < 2) return null;

  const target = panel.lines.find((line) => line.id === ids[0]);
  if (!target) return null;

  const sources = panel.lines.filter((line) => ids.includes(line.id));
  if (sources.length < 2) return null;

  const deviceIds = unique(sources.flatMap((line) => line.deviceIds));
  const lines = panel.lines
    .filter((line) => !ids.includes(line.id) || line.id === target.id)
    .map((line) =>
      line.id === target.id ? withComposition(line, deviceIds, ctx) : line
    );

  return {
    panel: { ...panel, lines },
    lineId: target.id,
  };
}

// «Дособрать новые»: приборы вне линий группируются по комнате и назначению.
// Если подходящая линия уже есть — приборы добавляются в неё.
export function appendUnassignedDevices(
  panel: ElectricalPanel,
  ctx: LineOpsContext,
  routing?: LineRouting
): AppendDevicesResult {
  const assignedIds = new Set(panel.lines.flatMap((line) => line.deviceIds));
  const unassigned = ctx.devices.filter((device) => !assignedIds.has(device.id));
  if (unassigned.length === 0) {
    return { panel, assigned: 0, created: 0 };
  }

  const groups = new Map<
    string,
    { roomId: string; purpose: LinePurpose; devices: ElectricalDevice[] }
  >();

  for (const device of unassigned) {
    const roomId = deviceRoomId(device, ctx.rooms, ctx.partitions);
    if (!roomId) continue;
    const room = ctx.rooms.find((candidate) => candidate.id === roomId)!;
    const purpose = linePurposeFor(device, room);
    const key = `${roomId}:${purpose}`;
    const group = groups.get(key);
    if (group) {
      group.devices.push(device);
    } else {
      groups.set(key, { roomId, purpose, devices: [device] });
    }
  }

  let lines = panel.lines;
  let assigned = 0;
  let created = 0;

  for (const group of groups.values()) {
    const deviceIds = group.devices.map((device) => device.id);
    const existing = lines.find(
      (line) => line.purpose === group.purpose && line.roomIds.includes(group.roomId)
    );

    if (existing) {
      lines = lines.map((line) =>
        line.id === existing.id
          ? withComposition(line, [...line.deviceIds, ...deviceIds], ctx)
          : line
      );
      assigned += deviceIds.length;
      continue;
    }

    const result = createLineFromDevices(
      { ...panel, lines },
      deviceIds,
      { purpose: group.purpose, routing, applyStrategy: true },
      ctx
    );
    lines = result.panel.lines;
    assigned += deviceIds.length;
    created += 1;
  }

  return { panel: { ...panel, lines }, assigned, created };
}

export interface LineCompositionWarning {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

function isLightingDevice(device: ElectricalDevice): boolean {
  return DEVICE_CATALOG[device.type]?.suggestedPurpose === 'lighting';
}

// Предупреждения по фактическому составу линий: смешение света и розеток,
// влагозащищённые розетки без дифзащиты 30 мА типа A.
export function collectLineCompositionWarnings(
  panel: ElectricalPanel,
  devices: ElectricalDevice[]
): LineCompositionWarning[] {
  const byId = new Map(devices.map((device) => [device.id, device]));
  const mainRcd = panel.supply.mainRcd;
  const mainRcdOk =
    mainRcd !== null && mainRcd.sensitivityMa <= 30 && mainRcd.type === 'A';
  const warnings: LineCompositionWarning[] = [];

  for (const line of panel.lines) {
    const lineDevices = line.deviceIds
      .map((id) => byId.get(id))
      .filter((device): device is ElectricalDevice => device !== undefined);
    if (lineDevices.length === 0) continue;

    const hasLighting = lineDevices.some(isLightingDevice);
    const hasSocket = lineDevices.some((device) => !isLightingDevice(device));
    if (hasLighting && hasSocket) {
      warnings.push({
        id: `mixed-purpose-${line.id}`,
        severity: 'warning',
        message: `«${line.name}»: в одной линии смешаны освещение и розетки. Рекомендуется разделить их делением линии.`,
      });
    }

    const wetCount = lineDevices.filter(
      (device) => DEVICE_CATALOG[device.type]?.suggestedPurpose === 'wet'
    ).length;
    if (wetCount > 0) {
      const ownRcdOk =
        line.rcd !== null && line.rcd.sensitivityMa <= 30 && line.rcd.type === 'A';
      if (!ownRcdOk && !mainRcdOk) {
        warnings.push({
          id: `wet-device-rcd-${line.id}`,
          severity: 'error',
          message: `«${line.name}»: влагозащищённых розеток ${wetCount}, но нет УЗО 30 мА типа A (СП 256.1325800.2016; ПУЭ-7 п. 7.1.79).`,
        });
      }
    }
  }

  return warnings;
}

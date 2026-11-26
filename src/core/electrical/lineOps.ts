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
import {
  DEVICE_CATALOG,
  deviceLineSlotCount,
  deviceSlotLabel,
  deviceSlotsPowerW,
  deviceWholeSlots,
} from './devices';
import { linesOfDevice } from './lineAssignment';

// Операции над составом линий. Прибор входит в линию целиком или
// отдельными слотами (`slotMembers`); единственный источник истины —
// panel.lines[].deviceIds + slotMembers.
export interface LineOpsContext {
  devices: ElectricalDevice[];
  rooms: RoomZone[];
  partitions: FreePartition[];
}

// Слоты прибора, которые переходят в линию. `slots` не задано — весь прибор.
export interface DeviceSlotRef {
  deviceId: string;
  slots?: number[];
}

export interface LineCreateOptions {
  purpose: LinePurpose;
  name?: string;
  routing?: LineRouting;
  template?: CircuitLine | null; // откуда скопировать защиту (деление)
  applyStrategy?: boolean; // новые линии из «Дособрать новые»
  trace?: CircuitLine['trace']; // по умолчанию 'none' — трассу прокладывают вручную
}

export interface LineCreateResult {
  panel: ElectricalPanel;
  lineId: string;
}

export interface AppendDevicesResult {
  panel: ElectricalPanel;
  assigned: number;
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
  strategy: PanelStrategy,
  rooms: RoomZone[]
): CircuitLine {
  if (strategy === 'budget') {
    return { ...line, rcd: null, combinedProtection: undefined };
  }
  if (strategy === 'optimal') {
    return line.purpose === 'lighting' && !lightingNeedsRcd(line, rooms)
      ? { ...line, rcd: null, combinedProtection: undefined }
      : { ...line, rcd: makeRcd(30, 'A', line.breaker.ratingA) };
  }
  if (strategy === 'maximum') {
    return { ...line, rcd: makeRcd(30, 'A', line.breaker.ratingA) };
  }
  return line;
}

// Свет в ванной и санузле — влажная зона: по ГОСТ Р 50571.4.41 ему нужна
// такая же защита 30 мА, как розеткам.
function lightingNeedsRcd(line: CircuitLine, rooms: RoomZone[]): boolean {
  return line.roomIds.some((roomId) => {
    const room = rooms.find((candidate) => candidate.id === roomId);
    return room?.type === 'bathroom' || room?.type === 'toilet';
  });
}

function cleanSlots(device: ElectricalDevice, slots: number[]): number[] {
  const count = deviceLineSlotCount(device);
  if (count <= 0) return [];
  const result = new Set<number>();
  for (const slot of slots) {
    if (Number.isSafeInteger(slot) && slot >= 0 && slot < count) result.add(slot);
  }
  return [...result].sort((a, b) => a - b);
}

// null — вклад пуст и прибор в линию не попадает; undefined в slots — весь прибор.
function normalizeRef(
  device: ElectricalDevice,
  ref: DeviceSlotRef
): DeviceSlotRef | null {
  const count = deviceLineSlotCount(device);
  if (count <= 0 || ref.slots === undefined) return { deviceId: ref.deviceId };
  const slots = cleanSlots(device, ref.slots);
  if (slots.length === 0) return null;
  if (slots.length === count) return { deviceId: ref.deviceId };
  return { deviceId: ref.deviceId, slots };
}

// Слияние ссылок одного прибора: весь прибор поглощает слоты, а полный
// набор слотов снова становится целым прибором.
function normalizeRefs(
  refs: DeviceSlotRef[],
  byId: Map<string, ElectricalDevice>
): DeviceSlotRef[] {
  const merged = new Map<string, DeviceSlotRef>();
  for (const ref of refs) {
    const device = byId.get(ref.deviceId);
    if (!device) continue;
    const normalized = normalizeRef(device, ref);
    if (!normalized) continue;
    const existing = merged.get(ref.deviceId);
    if (!existing) {
      merged.set(ref.deviceId, normalized);
      continue;
    }
    if (existing.slots === undefined || normalized.slots === undefined) {
      merged.set(ref.deviceId, { deviceId: ref.deviceId });
      continue;
    }
    const slots = [...new Set([...existing.slots, ...normalized.slots])].sort(
      (a, b) => a - b
    );
    merged.set(ref.deviceId, { deviceId: ref.deviceId, slots });
  }

  const result: DeviceSlotRef[] = [];
  for (const ref of merged.values()) {
    const device = byId.get(ref.deviceId)!;
    const normalized = normalizeRef(device, ref);
    if (normalized) result.push(normalized);
  }
  return result;
}

function sameRefs(a: DeviceSlotRef[], b: DeviceSlotRef[]): boolean {
  if (a.length !== b.length) return false;
  const right = new Map(b.map((ref) => [ref.deviceId, ref]));
  return a.every((ref) => {
    const other = right.get(ref.deviceId);
    if (!other) return false;
    if (ref.slots === undefined || other.slots === undefined) {
      return ref.slots === other.slots;
    }
    return (
      ref.slots.length === other.slots.length &&
      ref.slots.every((slot, index) => slot === other.slots![index])
    );
  });
}

function membershipOfLine(
  line: CircuitLine,
  byId: Map<string, ElectricalDevice>
): DeviceSlotRef[] {
  const refs: DeviceSlotRef[] = [];
  const seen = new Set<string>();
  for (const deviceId of line.deviceIds) {
    if (seen.has(deviceId)) continue;
    seen.add(deviceId);
    const device = byId.get(deviceId);
    if (!device) continue;
    const explicit = line.slotMembers?.[deviceId];
    if (explicit === undefined) {
      refs.push({ deviceId });
      continue;
    }
    const slots = cleanSlots(device, explicit);
    refs.push(slots.length > 0 ? { deviceId, slots } : { deviceId });
  }
  return normalizeRefs(refs, byId);
}

// Убрать из текущего состава линии выбранные слоты. Если у линии был весь
// прибор, а забирают одну клавишу, оставшиеся слоты становятся явными.
function withoutRefs(
  current: DeviceSlotRef[],
  moving: DeviceSlotRef[],
  byId: Map<string, ElectricalDevice>
): { refs: DeviceSlotRef[]; changed: boolean } {
  const byDevice = new Map(moving.map((ref) => [ref.deviceId, ref]));
  let changed = false;
  const refs: DeviceSlotRef[] = [];

  for (const ref of current) {
    const take = byDevice.get(ref.deviceId);
    if (!take) {
      refs.push(ref);
      continue;
    }
    const device = byId.get(ref.deviceId)!;
    // Закладная слотов не имеет: она либо в линии целиком, либо вне её.
    if (deviceLineSlotCount(device) <= 0) {
      changed = true;
      continue;
    }
    const currentSlots = ref.slots ?? deviceWholeSlots(device);
    const takeSlots = take.slots ?? deviceWholeSlots(device);
    const remaining = currentSlots.filter((slot) => !takeSlots.includes(slot));
    if (remaining.length === currentSlots.length) {
      refs.push(ref);
      continue;
    }
    changed = true;
    if (remaining.length > 0) refs.push({ deviceId: ref.deviceId, slots: remaining });
  }

  return changed
    ? { refs: normalizeRefs(refs, byId), changed: true }
    : { refs: current, changed: false };
}

function intersectRefs(
  current: DeviceSlotRef[],
  wanted: DeviceSlotRef[],
  byId: Map<string, ElectricalDevice>
): DeviceSlotRef[] {
  const byDevice = new Map(wanted.map((ref) => [ref.deviceId, ref]));
  const refs: DeviceSlotRef[] = [];
  for (const ref of current) {
    const take = byDevice.get(ref.deviceId);
    if (!take) continue;
    const device = byId.get(ref.deviceId)!;
    if (deviceLineSlotCount(device) <= 0) {
      refs.push({ deviceId: ref.deviceId });
      continue;
    }
    const currentSlots = ref.slots ?? deviceWholeSlots(device);
    const takeSlots = take.slots ?? deviceWholeSlots(device);
    const slots = currentSlots.filter((slot) => takeSlots.includes(slot));
    if (slots.length > 0) refs.push({ deviceId: ref.deviceId, slots });
  }
  return normalizeRefs(refs, byId);
}

function syncCombinedRating(line: CircuitLine): CircuitLine {
  return line.combinedProtection && line.rcd
    ? { ...line, rcd: { ...line.rcd, ratingA: line.breaker.ratingA } }
    : line;
}

// Пересобирает состав линии: приборы/слоты, комнаты, нагрузку и аппараты
// защиты. Мощность прибора делится между его слотами без двойного счёта.
function withComposition(
  line: CircuitLine,
  refs: DeviceSlotRef[],
  ctx: LineOpsContext
): CircuitLine {
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const members = normalizeRefs(refs, byId);
  const deviceIds = members.map((ref) => ref.deviceId);
  const preset = LINE_PRESETS[line.purpose];

  if (deviceIds.length === 0) {
    const next = recalculateLine({
      ...line,
      deviceIds: [],
      loadW: preset.loadW,
    });
    delete next.slotMembers;
    return syncCombinedRating(next);
  }

  const slotMembers: Record<string, number[]> = {};
  let powerW = 0;
  for (const ref of members) {
    const device = byId.get(ref.deviceId)!;
    if (ref.slots === undefined) {
      powerW += device.powerWatts;
      continue;
    }
    slotMembers[ref.deviceId] = ref.slots;
    powerW += deviceSlotsPowerW(device, ref.slots);
  }
  const roomIds = roomsForDevices(deviceIds, ctx);

  const next: CircuitLine = {
    ...line,
    deviceIds,
    roomIds: roomIds.length > 0 ? roomIds : line.roomIds,
    loadW: Math.max(preset.loadW, powerW),
  };
  if (Object.keys(slotMembers).length > 0) next.slotMembers = slotMembers;
  else delete next.slotMembers;
  return syncCombinedRating(recalculateLine(next));
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

function validLineCode(code: unknown): code is number {
  return Number.isInteger(code) && (code as number) >= 2; // QF1 — ввод
}

// Следующий свободный код группы. Удалённые коды не переиспользуются:
// новая линия получает max + 1, чтобы обозначения в старых документах
// не начали указывать на другую группу.
export function nextLineCode(panel: ElectricalPanel): number {
  let max = 1;
  panel.lines.forEach((line, index) => {
    const code = validLineCode(line.code) ? line.code : index + 2;
    if (code > max) max = code;
  });
  return max + 1;
}

// Коды линий для документов. Сохранённые коды имеют приоритет; пропуски и
// дубли закрываются следующими номерами, чтобы один код не попал дважды.
export function lineCodes(panel: ElectricalPanel): Map<string, number> {
  const stored = new Map<string, number>();
  const used = new Set<number>();
  let max = 1;
  for (const line of panel.lines) {
    if (!validLineCode(line.code) || used.has(line.code)) continue;
    used.add(line.code);
    stored.set(line.id, line.code);
    if (line.code > max) max = line.code;
  }
  for (const line of panel.lines) {
    if (stored.has(line.id)) continue;
    max += 1;
    stored.set(line.id, max);
  }
  return stored;
}

function validSlotIndexes(slots: unknown): number[] {
  if (!Array.isArray(slots)) return [];
  const unique = new Set<number>();
  for (const slot of slots) {
    if (Number.isSafeInteger(slot) && slot >= 0) unique.add(slot);
  }
  return [...unique].sort((a, b) => a - b);
}

function sameSlotMembers(
  a: Record<string, number[]> | undefined,
  b: Record<string, number[]> | undefined
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const mine = left[key];
    const other = right[key];
    return (
      Array.isArray(other) &&
      mine.length === other.length &&
      mine.every((slot, index) => slot === other[index])
    );
  });
}

// Нормализация: слот прибора не может входить в две линии (побеждает
// первая), повтор id внутри линии убирается. Каждой линии выдаётся
// стабильный код и цвет.
export function normalizeLineAssignments(panel: ElectricalPanel): ElectricalPanel {
  const wholeDevices = new Set<string>();
  const claimedSlots = new Map<string, Set<number>>();
  const usedColors = new Set<number>();
  panel.lines.forEach((line, index) => {
    usedColors.add(line.colorIndex ?? index);
  });

  let changed = false;
  let nextColor = 0;
  let maxCode = 1;
  for (const line of panel.lines) {
    if (validLineCode(line.code) && line.code > maxCode) maxCode = line.code;
  }
  const usedCodes = new Set<number>();

  const lines = panel.lines.map((line) => {
    let next = line;

    if (validLineCode(next.code) && !usedCodes.has(next.code)) {
      usedCodes.add(next.code);
    } else {
      maxCode += 1;
      usedCodes.add(maxCode);
      next = { ...next, code: maxCode };
      changed = true;
    }

    if (next.colorIndex === undefined) {
      while (usedColors.has(nextColor)) nextColor += 1;
      usedColors.add(nextColor);
      next = { ...next, colorIndex: nextColor };
      changed = true;
    }

    const localSeen = new Set<string>();
    const deviceIds: string[] = [];
    const slotMembers: Record<string, number[]> = {};
    for (const deviceId of line.deviceIds) {
      if (localSeen.has(deviceId)) {
        changed = true;
        continue;
      }
      localSeen.add(deviceId);
      const explicit = line.slotMembers?.[deviceId];
      if (explicit === undefined) {
        const alreadyClaimed =
          wholeDevices.has(deviceId) || (claimedSlots.get(deviceId)?.size ?? 0) > 0;
        if (alreadyClaimed) {
          changed = true;
          continue;
        }
        wholeDevices.add(deviceId);
        deviceIds.push(deviceId);
        continue;
      }
      const slots = validSlotIndexes(explicit);
      const taken = claimedSlots.get(deviceId) ?? new Set<number>();
      const free = slots.filter((slot) => !taken.has(slot));
      if (free.length === 0) {
        changed = true;
        continue;
      }
      if (free.length !== explicit.length) changed = true;
      for (const slot of free) taken.add(slot);
      claimedSlots.set(deviceId, taken);
      deviceIds.push(deviceId);
      slotMembers[deviceId] = free;
    }

    const hasSlotMembers = Object.keys(slotMembers).length > 0;
    // Сравниваем по содержимому, чтобы не плодить новые объекты без нужды.
    if (
      deviceIds.length !== line.deviceIds.length ||
      deviceIds.some((deviceId, index) => deviceId !== line.deviceIds[index])
    ) {
      changed = true;
      next = { ...next, deviceIds };
    }
    if (!sameSlotMembers(hasSlotMembers ? slotMembers : undefined, line.slotMembers)) {
      changed = true;
      next = { ...next };
      if (hasSlotMembers) next.slotMembers = slotMembers;
      else delete next.slotMembers;
    }

    return next;
  });

  return changed ? { ...panel, lines } : panel;
}

// Назначить линии конкретные слоты приборов. Из прежних линий эти слоты
// убираются: у линии с целым прибором остаток становится явными слотами.
export function assignDeviceSlots(
  panel: ElectricalPanel,
  lineId: string,
  refs: DeviceSlotRef[],
  ctx: LineOpsContext
): ElectricalPanel {
  if (!panel.lines.some((line) => line.id === lineId)) return panel;
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const moving = normalizeRefs(refs, byId);
  if (moving.length === 0) return panel;

  let changed = false;
  const lines = panel.lines.map((line) => {
    const current = membershipOfLine(line, byId);
    if (line.id === lineId) {
      const next = normalizeRefs([...current, ...moving], byId);
      if (sameRefs(next, current)) return line;
      changed = true;
      return withComposition(line, next, ctx);
    }
    const reduced = withoutRefs(current, moving, byId);
    if (!reduced.changed) return line;
    changed = true;
    return withComposition(line, reduced.refs, ctx);
  });

  return changed ? { ...panel, lines } : panel;
}

// Назначить приборы линии целиком. Из прежних линий они удаляются.
export function assignDevices(
  panel: ElectricalPanel,
  lineId: string,
  deviceIds: string[],
  ctx: LineOpsContext
): ElectricalPanel {
  return assignDeviceSlots(
    panel,
    lineId,
    deviceIds.map((deviceId) => ({ deviceId })),
    ctx
  );
}

// Заменить состав линии целиком (диалог состава): приборы и их слоты,
// которых нет в новом наборе, из линии уходят; входящие забираются у других.
export function setLineComposition(
  panel: ElectricalPanel,
  lineId: string,
  refs: DeviceSlotRef[],
  ctx: LineOpsContext
): ElectricalPanel {
  const target = panel.lines.find((line) => line.id === lineId);
  if (!target) return panel;
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const incoming = normalizeRefs(refs, byId);
  const unchanged = sameRefs(membershipOfLine(target, byId), incoming);

  let changed = false;
  const lines = panel.lines.map((line) => {
    if (line.id === lineId) {
      if (unchanged) return line;
      changed = true;
      return withComposition(line, incoming, ctx);
    }
    const reduced = withoutRefs(membershipOfLine(line, byId), incoming, byId);
    if (!reduced.changed) return line;
    changed = true;
    return withComposition(line, reduced.refs, ctx);
  });

  return changed ? { ...panel, lines } : panel;
}

// Убрать выбранные слоты из всех линий — они станут свободными.
export function unassignDeviceSlots(
  panel: ElectricalPanel,
  refs: DeviceSlotRef[],
  ctx: LineOpsContext
): ElectricalPanel {
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const moving = normalizeRefs(refs, byId);
  if (moving.length === 0) return panel;

  let changed = false;
  const lines = panel.lines.map((line) => {
    const reduced = withoutRefs(membershipOfLine(line, byId), moving, byId);
    if (!reduced.changed) return line;
    changed = true;
    return withComposition(line, reduced.refs, ctx);
  });

  return changed ? { ...panel, lines } : panel;
}

// Убрать приборы из всех линий целиком.
export function unassignDevices(
  panel: ElectricalPanel,
  deviceIds: string[],
  ctx: LineOpsContext
): ElectricalPanel {
  return unassignDeviceSlots(
    panel,
    deviceIds.map((deviceId) => ({ deviceId })),
    ctx
  );
}

// Новая линия из выбранных слотов. Эти слоты забираются из прежних линий,
// остальные слоты приборов остаются где были.
export function createLineFromSlots(
  panel: ElectricalPanel,
  refs: DeviceSlotRef[],
  options: LineCreateOptions,
  ctx: LineOpsContext
): LineCreateResult {
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const members = normalizeRefs(refs, byId);
  const deviceIds = members.map((ref) => ref.deviceId);
  const preset = LINE_PRESETS[options.purpose];
  const roomIds = roomsForDevices(deviceIds, ctx);
  const fallbackName = defaultLineName(options.purpose, roomIds, ctx);

  const base = options.template
    ? {
        ...options.template,
        id: nextLineId(panel),
        code: nextLineCode(panel),
        name: uniqueLineName(panel, options.name ?? options.template.name),
        deviceIds: [],
        slotMembers: undefined,
        roomIds,
        colorIndex: nextColorIndex(panel),
        loadW: preset.loadW,
        routing: options.routing ?? options.template.routing,
        // Состав другой — старая ручная трасса к нему не относится.
        manualRoute: undefined,
        waypoints: undefined,
        trace: options.trace ?? options.template.trace ?? 'none',
      }
    : {
        id: nextLineId(panel),
        code: nextLineCode(panel),
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
        trace: options.trace ?? 'none',
      };

  const lines = panel.lines.map((line) => {
    const reduced = withoutRefs(membershipOfLine(line, byId), members, byId);
    return reduced.changed ? withComposition(line, reduced.refs, ctx) : line;
  });

  let line = withComposition(base, members, ctx);
  if (options.applyStrategy) {
    line = applyStrategyProtection(line, panel.strategy, ctx.rooms);
  }

  return {
    panel: { ...panel, lines: [...lines, line] },
    lineId: line.id,
  };
}

export function createLineFromDevices(
  panel: ElectricalPanel,
  deviceIds: string[],
  options: LineCreateOptions,
  ctx: LineOpsContext
): LineCreateResult {
  return createLineFromSlots(
    panel,
    deviceIds.map((deviceId) => ({ deviceId })),
    options,
    ctx
  );
}

// Деление: выбранные слоты уходят в новую линию, остаток состава остаётся
// у исходной. Защита копируется с исходной и пересчитывается по нагрузке.
export function splitLineSlots(
  panel: ElectricalPanel,
  lineId: string,
  refs: DeviceSlotRef[],
  ctx: LineOpsContext,
  newPurpose?: LinePurpose
): LineCreateResult | null {
  const source = panel.lines.find((line) => line.id === lineId);
  if (!source) return null;
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const current = membershipOfLine(source, byId);
  const moving = intersectRefs(current, normalizeRefs(refs, byId), byId);
  if (moving.length === 0 || sameRefs(moving, current)) return null;

  const purpose = newPurpose ?? source.purpose;
  return createLineFromSlots(
    panel,
    moving,
    {
      purpose,
      template: purpose === source.purpose ? source : null,
      routing: source.routing,
      // Дочерняя линия повторяет режим трассы исходной, но не её геометрию.
      trace: source.trace === 'none' ? 'none' : 'auto',
    },
    ctx
  );
}

export function splitLine(
  panel: ElectricalPanel,
  lineId: string,
  deviceIds: string[],
  ctx: LineOpsContext,
  newPurpose?: LinePurpose
): LineCreateResult | null {
  return splitLineSlots(
    panel,
    lineId,
    deviceIds.map((deviceId) => ({ deviceId })),
    ctx,
    newPurpose
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

  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const members = normalizeRefs(
    sources.flatMap((line) => membershipOfLine(line, byId)),
    byId
  );
  const lines = panel.lines
    .filter((line) => !ids.includes(line.id) || line.id === target.id)
    .map((line) =>
      line.id === target.id ? withComposition(line, members, ctx) : line
    );

  return {
    panel: { ...panel, lines },
    lineId: target.id,
  };
}

// «Дособрать»: приборы вне линий и свободные слоты частично назначенных
// приборов группируются по комнате и назначению и добавляются только в
// подходящие существующие линии. Новые линии не создаются.
export function appendUnassignedDevices(
  panel: ElectricalPanel,
  ctx: LineOpsContext
): AppendDevicesResult {
  const byId = new Map(ctx.devices.map((device) => [device.id, device]));
  const whole = new Set<string>();
  const claimedSlots = new Map<string, Set<number>>();
  for (const line of panel.lines) {
    for (const ref of membershipOfLine(line, byId)) {
      if (ref.slots === undefined) {
        whole.add(ref.deviceId);
        continue;
      }
      const taken = claimedSlots.get(ref.deviceId) ?? new Set<number>();
      for (const slot of ref.slots) taken.add(slot);
      claimedSlots.set(ref.deviceId, taken);
    }
  }

  const freeRef = (device: ElectricalDevice): DeviceSlotRef | null => {
    if (whole.has(device.id)) return null;
    const count = deviceLineSlotCount(device);
    if (count <= 0) return { deviceId: device.id };
    const taken = claimedSlots.get(device.id) ?? new Set<number>();
    const free = deviceWholeSlots(device).filter((slot) => !taken.has(slot));
    if (free.length === 0) return null;
    return free.length === count
      ? { deviceId: device.id }
      : { deviceId: device.id, slots: free };
  };

  const groups = new Map<
    string,
    { roomId: string; purpose: LinePurpose; refs: DeviceSlotRef[] }
  >();

  for (const device of ctx.devices) {
    const ref = freeRef(device);
    if (!ref) continue;
    const roomId = deviceRoomId(device, ctx.rooms, ctx.partitions);
    if (!roomId) continue;
    const room = ctx.rooms.find((candidate) => candidate.id === roomId)!;
    const purpose = linePurposeFor(device, room);
    const key = `${roomId}:${purpose}`;
    const group = groups.get(key);
    if (group) group.refs.push(ref);
    else groups.set(key, { roomId, purpose, refs: [ref] });
  }

  if (groups.size === 0) return { panel, assigned: 0 };

  let lines = panel.lines;
  let assigned = 0;

  for (const group of groups.values()) {
    const existing = lines.find(
      (line) => line.purpose === group.purpose && line.roomIds.includes(group.roomId)
    );
    if (!existing) continue;
    const next = normalizeRefs(
      [...membershipOfLine(existing, byId), ...group.refs],
      byId
    );
    lines = lines.map((line) =>
      line.id === existing.id ? withComposition(line, next, ctx) : line
    );
    assigned += group.refs.length;
  }

  return { panel: { ...panel, lines }, assigned };
}

export interface LineCompositionWarning {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  lineId?: string;
  /** Прибор, к которому относится находка: для подсветки его клеммы на плане. */
  deviceId?: string;
  slot?: number;
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
        lineId: line.id,
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
          lineId: line.id,
        });
      }
    }
  }

  // Клавиши с общим входом (проходные выключатели) в разных линиях:
  // встречное питание даёт сквозной ток через механизм.
  const sharedSeen = new Set<string>();
  for (const line of panel.lines) {
    for (const deviceId of line.deviceIds) {
      if (sharedSeen.has(deviceId)) continue;
      const device = byId.get(deviceId);
      if (!device) continue;
      const catalog = DEVICE_CATALOG[device.type];
      if (!catalog || catalog.slotCanShareFeed !== false) continue;
      if (deviceLineSlotCount(device) < 2) continue;
      const owners = linesOfDevice(panel, device);
      if (new Set(owners.map((membership) => membership.line.id)).size < 2) continue;
      sharedSeen.add(deviceId);
      const labels = owners
        .flatMap((membership) =>
          membership.slots.map((slot) => `${deviceSlotLabel(device, slot)} → «${membership.line.name}»`)
        )
        .join(', ');
      warnings.push({
        id: `shared-feed-${deviceId}`,
        severity: 'warning',
        message: `«${device.name}»: клавиши с общим входом стоят в разных линиях (${labels}). При встречном питании возможен сквозной ток через механизм — держите их в одной линии.`,
        lineId: line.id,
        deviceId,
      });
    }
  }

  return warnings;
}

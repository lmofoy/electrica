import type { CircuitLine, ElectricalPanel, PanelStrategy, RoomZone } from '../../types';

export type PanelItemKind =
  | 'input_breaker'
  | 'meter'
  | 'main_rcd'
  | 'voltage_relay'
  | 'spd'
  | 'line_breaker'
  | 'line_rcd'
  | 'line_rcbo';

export interface PanelLayoutItem {
  id: string;
  kind: PanelItemKind;
  label: string;
  sublabel: string;
  modules: number;
  lineId?: string;
  tone: 'input' | 'protection' | 'line';
  zoneId?: string;
  zoneName?: string;
  zoneColorIndex?: number;
}

export interface PanelWarning {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// Зона раскладки: «Ввод и защита» или комната. Границы зон показываются
// на DIN-схеме и на листе ЭС-04.
export interface PanelLayoutZone {
  id: string;
  name: string;
  colorIndex?: number;
  itemIds: string[];
  lineIds: string[];
  modules: number;
}

export interface PanelLayout {
  items: PanelLayoutItem[];
  rows: PanelLayoutItem[][];
  railModules: number;
  rowsCount: number;
  modulesTotal: number;
  requiredModules: number;
  enclosureModules: number;
  freeModules: number;
  reservePercent: number;
  reserveTarget: number;
  zones: PanelLayoutZone[];
  manualOrder: boolean;
  warnings: PanelWarning[];
}

export interface PanelLayoutOptions {
  rooms?: RoomZone[];
}

export const RAIL_MODULES = 12;
// Дифавтомат 1P+N/2P занимает два модуля независимо от числа полюсов автомата.
export const RCBO_MODULES = 2;
export const ENCLOSURE_SERIES = [12, 24, 36, 48, 60, 72];
export const INPUT_ZONE_ID = 'input';
export const INPUT_ZONE_NAME = 'Ввод и защита';
const NO_ROOM_ZONE_ID = 'no-room';

export function reserveTargetFor(strategy: PanelStrategy): number {
  switch (strategy) {
    case 'budget':
      return 0.15;
    case 'optimal':
      return 0.22;
    case 'maximum':
      return 0.3;
    default:
      return 0.2;
  }
}

function breakerModules(line: CircuitLine): number {
  return line.breaker.poles;
}

function lineItems(line: CircuitLine): PanelLayoutItem[] {
  if (line.combinedProtection && line.rcd) {
    return [
      {
        id: `${line.id}-breaker`,
        kind: 'line_rcbo',
        label: `${line.breaker.ratingA} А · ${line.rcd.sensitivityMa} мА`,
        sublabel: `${line.name} · дифавтомат ${line.breaker.curve}${line.rcd.type}`,
        modules: RCBO_MODULES,
        lineId: line.id,
        tone: 'protection',
      },
    ];
  }
  const items: PanelLayoutItem[] = [
    {
      id: `${line.id}-breaker`,
      kind: 'line_breaker',
      label: `${line.breaker.ratingA} А`,
      sublabel: `${line.name} · ${line.breaker.poles}P ${line.breaker.curve}`,
      modules: breakerModules(line),
      lineId: line.id,
      tone: 'line',
    },
  ];
  if (line.rcd) {
    items.push({
      id: `${line.id}-rcd`,
      kind: 'line_rcd',
      label: `${line.rcd.sensitivityMa} мА`,
      sublabel: `${line.name} · УЗО ${line.rcd.type}`,
      modules: 2,
      lineId: line.id,
      tone: 'protection',
    });
  }
  return items;
}

function buildItems(panel: ElectricalPanel): PanelLayoutItem[] {
  const supply = panel.supply;
  const items: PanelLayoutItem[] = [];

  items.push({
    id: 'input-breaker',
    kind: 'input_breaker',
    label: `${supply.inputBreaker.ratingA} А`,
    sublabel: `Ввод · ${supply.inputBreaker.poles}P C`,
    modules: supply.inputBreaker.poles,
    tone: 'input',
  });

  if (supply.meter.enabled) {
    items.push({
      id: 'meter',
      kind: 'meter',
      label: 'Счётчик',
      sublabel: 'Учёт электроэнергии',
      modules: 6,
      tone: 'input',
    });
  }

  if (supply.mainRcd) {
    items.push({
      id: 'main-rcd',
      kind: 'main_rcd',
      label: `${supply.mainRcd.sensitivityMa} мА`,
      sublabel: `Противопожарное УЗО ${supply.mainRcd.type}${
        supply.mainRcd.selective ? ' · S' : ''
      }`,
      modules: 2,
      tone: 'protection',
    });
  }

  if (supply.voltageRelay) {
    items.push({
      id: 'voltage-relay',
      kind: 'voltage_relay',
      label: 'РКН',
      sublabel: 'Реле контроля напряжения',
      modules: 2,
      tone: 'protection',
    });
  }

  if (supply.surgeProtection) {
    items.push({
      id: 'spd',
      kind: 'spd',
      label: 'УЗИП',
      sublabel: 'Защита от импульсных перенапряжений',
      modules: 2,
      tone: 'protection',
    });
  }

  for (const line of panel.lines) {
    items.push(...lineItems(line));
  }

  return items;
}

function lineZoneName(line: CircuitLine, rooms: RoomZone[] | undefined): string {
  const roomId = line.roomIds[0];
  const room = roomId ? rooms?.find((entry) => entry.id === roomId) : undefined;
  if (room) return room.name;
  const prefix = line.name.split('—')[0]?.trim();
  return prefix || 'Без комнаты';
}

// Каждая линия относится к зоне своей первой комнаты. Приборы ввода
// собраны в отдельную зону «Ввод и защита».
function decorateItems(
  items: PanelLayoutItem[],
  panel: ElectricalPanel,
  rooms: RoomZone[] | undefined
): PanelLayoutItem[] {
  const zones = new Map<string, { id: string; name: string; colorIndex?: number }>();
  panel.lines.forEach((line, index) => {
    const roomId = line.roomIds[0];
    const id = roomId ? roomId : NO_ROOM_ZONE_ID;
    zones.set(line.id, {
      id,
      name: lineZoneName(line, rooms),
      colorIndex: line.colorIndex ?? index,
    });
  });

  return items.map((item) => {
    if (!item.lineId) {
      return {
        ...item,
        zoneId: INPUT_ZONE_ID,
        zoneName: INPUT_ZONE_NAME,
        zoneColorIndex: undefined,
      };
    }
    const zone = zones.get(item.lineId);
    return {
      ...item,
      zoneId: zone?.id ?? NO_ROOM_ZONE_ID,
      zoneName: zone?.name ?? 'Без комнаты',
      zoneColorIndex: zone?.colorIndex,
    };
  });
}

// Автопорядок: ввод первым, затем зоны в порядке появления линий,
// внутри зоны — порядок линий в щитке.
function orderByZones(items: PanelLayoutItem[]): PanelLayoutItem[] {
  const ranks = new Map<string, number>([[INPUT_ZONE_ID, 0]]);
  for (const item of items) {
    const zoneId = item.zoneId ?? INPUT_ZONE_ID;
    if (!ranks.has(zoneId)) ranks.set(zoneId, ranks.size);
  }
  const fallback = ranks.size;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rankA = ranks.get(a.item.zoneId ?? INPUT_ZONE_ID) ?? fallback;
      const rankB = ranks.get(b.item.zoneId ?? INPUT_ZONE_ID) ?? fallback;
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

// Ручной порядок хранится плоским списком id. Аппараты, которых в списке
// ещё нет (например, новая линия), встают в конец в автопорядке.
function applyDinOrder(items: PanelLayoutItem[], order: string[] | undefined): PanelLayoutItem[] {
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((id, index) => [id, index] as const));
  const listed = items
    .filter((item) => rank.has(item.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const rest = items.filter((item) => !rank.has(item.id));
  return [...listed, ...rest];
}

function collectZones(items: PanelLayoutItem[]): PanelLayoutZone[] {
  const zones = new Map<string, PanelLayoutZone>();
  for (const item of items) {
    const id = item.zoneId ?? INPUT_ZONE_ID;
    let zone = zones.get(id);
    if (!zone) {
      zone = {
        id,
        name: item.zoneName ?? (id === INPUT_ZONE_ID ? INPUT_ZONE_NAME : 'Без комнаты'),
        colorIndex: item.zoneColorIndex,
        itemIds: [],
        lineIds: [],
        modules: 0,
      };
      zones.set(id, zone);
    }
    zone.itemIds.push(item.id);
    zone.modules += item.modules;
    if (item.lineId && !zone.lineIds.includes(item.lineId)) {
      zone.lineIds.push(item.lineId);
    }
  }
  return [...zones.values()];
}

function lineNameOf(item: PanelLayoutItem): string {
  return item.sublabel.split('·')[0]?.trim() || item.label;
}

// Проверки только для ручного порядка: опасные перестановки.
function collectOrderWarnings(items: PanelLayoutItem[], manual: boolean): PanelWarning[] {
  if (!manual) return [];
  const warnings: PanelWarning[] = [];
  const indexOf = new Map<string, number>();
  items.forEach((item, index) => indexOf.set(item.id, index));

  const inputIndex = indexOf.get('input-breaker');
  const firstLineIndex = items.findIndex((item) => item.zoneId !== INPUT_ZONE_ID);
  if (
    inputIndex !== undefined &&
    firstLineIndex !== -1 &&
    inputIndex > firstLineIndex
  ) {
    warnings.push({
      id: 'din-input-not-first',
      severity: 'error',
      message:
        'Вводной автомат стоит не в начале раскладки — верните его на первую позицию.',
    });
  }

  for (const item of items) {
    if (item.kind !== 'line_rcd' || !item.lineId) continue;
    const breakerIndex = indexOf.get(`${item.lineId}-breaker`);
    const rcdIndex = indexOf.get(item.id);
    if (breakerIndex === undefined || rcdIndex === undefined) continue;
    if (rcdIndex < breakerIndex) {
      warnings.push({
        id: `din-rcd-first-${item.lineId}`,
        severity: 'error',
        message: `УЗО линии «${lineNameOf(item)}» стоит раньше своего автомата — сначала автомат, затем УЗО.`,
      });
    } else if (rcdIndex > breakerIndex + 1) {
      warnings.push({
        id: `din-pair-split-${item.lineId}`,
        severity: 'warning',
        message: `Автомат и УЗО линии «${lineNameOf(item)}» разнесены по раскладке — ставьте их рядом.`,
      });
    }
  }

  for (const zone of collectZones(items)) {
    if (zone.id === INPUT_ZONE_ID || zone.itemIds.length < 2) continue;
    const positions = zone.itemIds
      .map((id) => indexOf.get(id))
      .filter((index): index is number => index !== undefined);
    if (positions.length < 2) continue;
    const span = Math.max(...positions) - Math.min(...positions) + 1;
    if (span !== positions.length) {
      warnings.push({
        id: `din-zone-split-${zone.id}`,
        severity: 'info',
        message: `Зона «${zone.name}» разорвана другими аппаратами — для читаемости держите её вместе.`,
      });
    }
  }

  return warnings;
}

function layoutRows(items: PanelLayoutItem[], totalModules: number): PanelLayoutItem[][] {
  const rows: PanelLayoutItem[][] = [];
  let current: PanelLayoutItem[] = [];
  let used = 0;

  for (const item of items) {
    if (used + item.modules > RAIL_MODULES && current.length > 0) {
      rows.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += item.modules;
  }
  if (current.length > 0) rows.push(current);

  const emptyRows = Math.ceil(totalModules / RAIL_MODULES) - rows.length;
  for (let i = 0; i < emptyRows; i++) rows.push([]);
  return rows;
}

// Только предупреждения DIN-раскладки. Нормативные проверки живут
// в panelValidation.ts и не дублируются здесь.
function collectWarnings(panel: ElectricalPanel, modulesTotal: number, enclosureModules: number, freeModules: number, reserveTarget: number): PanelWarning[] {
  const warnings: PanelWarning[] = [];

  if (panel.lines.length === 0) {
    warnings.push({
      id: 'no-lines',
      severity: 'warning',
      message: 'В щитке нет ни одной линии. Добавьте линии или соберите черновик из приборов.',
    });
  }

  for (const line of panel.lines) {
    if (line.deviceIds.length === 0) {
      warnings.push({
        id: `line-empty-${line.id}`,
        severity: 'info',
        message: `«${line.name}»: на линии нет приборов — трасса не строится, нагрузка задана вручную.`,
      });
    }
  }

  if (modulesTotal > 72) {
    warnings.push({
      id: 'enclosure-overflow',
      severity: 'error',
      message: `Модулей ${modulesTotal} — больше максимального корпуса на 72 модуля. Уменьшите число линий или объедините их.`,
    });
  } else if (enclosureModules < 12) {
    warnings.push({
      id: 'enclosure-min',
      severity: 'warning',
      message: 'Для щитка нужен корпус минимум на 12 модулей.',
    });
  }

  const actualReserve = enclosureModules > 0 ? freeModules / enclosureModules : 0;
  if (actualReserve < reserveTarget) {
    warnings.push({
      id: 'reserve-low',
      severity: 'info',
      message: `Свободных модулей ${freeModules} (${Math.round(actualReserve * 100)} %) — меньше целевого запаса ${Math.round(reserveTarget * 100)} %.`,
    });
  }

  return warnings;
}

export function buildPanelLayout(
  panel: ElectricalPanel,
  options: PanelLayoutOptions = {}
): PanelLayout {
  const manualOrder = Boolean(panel.dinOrder && panel.dinOrder.length > 0);
  const autoItems = orderByZones(decorateItems(buildItems(panel), panel, options.rooms));
  const items = applyDinOrder(autoItems, panel.dinOrder);
  const modulesTotal = items.reduce((sum, item) => sum + item.modules, 0);
  const reserveTarget = reserveTargetFor(panel.strategy);
  const requiredModules = Math.ceil(modulesTotal / (1 - reserveTarget));
  const enclosureModules =
    ENCLOSURE_SERIES.find((size) => size >= requiredModules) ?? 72;
  const freeModules = Math.max(0, enclosureModules - modulesTotal);
  const reservePercent = enclosureModules > 0 ? (freeModules / enclosureModules) * 100 : 0;

  const rows = layoutRows(items, Math.max(enclosureModules, modulesTotal));
  const warnings = [
    ...collectWarnings(
      panel,
      modulesTotal,
      enclosureModules,
      freeModules,
      reserveTarget
    ),
    ...collectOrderWarnings(items, manualOrder),
  ];

  return {
    items,
    rows,
    railModules: RAIL_MODULES,
    rowsCount: Math.max(1, Math.ceil(enclosureModules / RAIL_MODULES)),
    modulesTotal,
    requiredModules,
    enclosureModules,
    freeModules,
    reservePercent,
    reserveTarget,
    zones: collectZones(items),
    manualOrder,
    warnings,
  };
}

import type { ElectricalPanel, RoomZone } from '../../types';
import {
  buildPanelLayout,
  INPUT_ZONE_ID,
  RAIL_MODULES,
  type PanelLayoutItem,
  type PanelItemKind,
} from './panelLayout';
import { lineColorFor } from './lineColors';
import { lineCodes } from './lineOps';
import { breakingCapacityLabel, normalizeBreakingCapacity } from './norms';
import {
  A3_HEIGHT_MM,
  A3_WIDTH_MM,
  SHEET_FRAME,
  SHEET_NOTES_BLOCK,
  type SheetRect,
} from './sheetLayout';
import {
  buildSheetDocumentBlock,
  type SheetDocumentBlock,
} from './sheetDocument';

// -------------------------------------------------------------
// Печатный DIN-лист: рейки по 12 модулей, аппараты в масштабе
// 1:1 (1 модуль = 18 мм на листе), обозначения как на схеме.
// Модуль не рисует — отдаёт миллиметровые координаты для SVG.
// -------------------------------------------------------------

export type DinTone = 'input' | 'protection' | 'line';

export interface DinSheetItem {
  id: string;
  designation: string;
  label: string;
  detail: string;
  modules: number;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: DinTone;
}

export interface DinSheetZoneSpan {
  zoneId: string;
  name: string;
  colorIndex?: number;
  x: number;
  width: number;
}

export interface DinSheetRail {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  modules: number;
  used: number;
  free: number;
  items: DinSheetItem[];
  zones: DinSheetZoneSpan[];
}

export interface DinZonesBox {
  rect: SheetRect;
  title: string;
  entries: {
    id: string;
    name: string;
    colorIndex?: number;
    modules: number;
    lines: number;
  }[];
  truncated: number;
}

export interface DinLegendEntry {
  tone: DinTone | 'free';
  label: string;
}

export interface DinInfoBox {
  rect: SheetRect;
  title: string;
  lines: string[];
}

export interface PanelDinSheet {
  panelName: string;
  title: string;
  subtitle: string;
  paper: { width: number; height: number };
  frame: SheetRect;
  titleY: number;
  subtitleY: number;
  enclosureRect: SheetRect;
  railX: number;
  railWidth: number;
  slotWidth: number;
  itemHeight: number;
  rails: DinSheetRail[];
  legend: {
    rect: SheetRect;
    title: string;
    entries: DinLegendEntry[];
  };
  summary: DinInfoBox;
  zonesBox: DinZonesBox;
  notesBlock: SheetRect;
  notesTitle: string;
  notesLines: string[];
  document: SheetDocumentBlock;
}

export interface DinSheetOptions {
  date?: string;
  rooms?: RoomZone[];
}

export const DIN_SLOT_WIDTH_MM = 18;
export const DIN_RAIL_WIDTH_MM = DIN_SLOT_WIDTH_MM * RAIL_MODULES;
export const DIN_ITEM_HEIGHT_MM = 19;
const RAIL_TOP = 44;
const RAIL_PITCH = 31.5;
const RAIL_HEIGHT = 24;

function num(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '—';
}

function designationMap(panel: ElectricalPanel): Map<string, string> {
  const map = new Map<string, string>();
  map.set('input-breaker', 'QF1');
  if (panel.supply.meter.enabled) map.set('meter', 'PI1');
  if (panel.supply.mainRcd) map.set('main-rcd', 'QD1');
  if (panel.supply.voltageRelay) map.set('voltage-relay', 'KV1');
  if (panel.supply.surgeProtection) map.set('spd', 'F1');
  let rcdCounter = panel.supply.mainRcd ? 1 : 0;
  const codes = lineCodes(panel);
  panel.lines.forEach((line, index) => {
    map.set(`${line.id}-breaker`, `QF${codes.get(line.id) ?? index + 2}`);
    if (line.rcd && !line.combinedProtection) map.set(`${line.id}-rcd`, `QD${++rcdCounter}`);
  });
  return map;
}

function toneFor(kind: PanelItemKind): DinTone {
  if (
    kind === 'input_breaker' ||
    kind === 'meter'
  ) {
    return 'input';
  }
  if (
    kind === 'main_rcd' ||
    kind === 'voltage_relay' ||
    kind === 'spd' ||
    kind === 'line_rcd' ||
    kind === 'line_rcbo'
  ) {
    return 'protection';
  }
  return 'line';
}

export function dinZoneColor(colorIndex: number | undefined, zoneId?: string): string {
  if (zoneId === INPUT_ZONE_ID) return '#b45309';
  if (colorIndex === undefined) return '#64748b';
  return lineColorFor(colorIndex);
}

function buildZoneSpans(
  items: PanelLayoutItem[],
  railX: number
): DinSheetZoneSpan[] {
  const spans: DinSheetZoneSpan[] = [];
  let spanStart = 0;
  let spanModules = 0;
  let cursor = 0;
  let current: { id: string; name: string; colorIndex?: number } | null = null;

  const flush = () => {
    if (!current || spanModules === 0) return;
    spans.push({
      zoneId: current.id,
      name: current.name,
      colorIndex: current.colorIndex,
      x: railX + spanStart * DIN_SLOT_WIDTH_MM,
      width: spanModules * DIN_SLOT_WIDTH_MM,
    });
  };

  for (const item of items) {
    const zoneId = item.zoneId ?? INPUT_ZONE_ID;
    if (!current || current.id !== zoneId) {
      flush();
      current = {
        id: zoneId,
        name: item.zoneName ?? 'Зона',
        colorIndex: item.zoneColorIndex,
      };
      spanStart = cursor;
      spanModules = 0;
    }
    spanModules += item.modules;
    cursor += item.modules;
  }
  flush();
  return spans;
}

function buildRail(
  index: number,
  items: PanelLayoutItem[],
  designations: Map<string, string>
): DinSheetRail {
  const x = SHEET_FRAME.x + 7.5;
  const y = RAIL_TOP + index * RAIL_PITCH;
  let cursor = 0;
  const placed: DinSheetItem[] = items.map((item) => {
    const width = item.modules * DIN_SLOT_WIDTH_MM;
    const placedItem: DinSheetItem = {
      id: item.id,
      designation: designations.get(item.id) ?? '—',
      label: item.label,
      detail: item.sublabel,
      modules: item.modules,
      x: x + cursor * DIN_SLOT_WIDTH_MM,
      y: y + 1,
      width: width - 0.6,
      height: DIN_ITEM_HEIGHT_MM,
      tone: toneFor(item.kind),
    };
    cursor += item.modules;
    return placedItem;
  });
  return {
    index: index + 1,
    x,
    y,
    width: DIN_RAIL_WIDTH_MM,
    height: RAIL_HEIGHT,
    modules: RAIL_MODULES,
    used: cursor,
    free: Math.max(0, RAIL_MODULES - cursor),
    items: placed,
    zones: buildZoneSpans(items, x),
  };
}

export function buildDinSheetLayout(
  panel: ElectricalPanel,
  options: DinSheetOptions = {}
): PanelDinSheet {
  const layout = buildPanelLayout(panel, { rooms: options.rooms });
  const designations = designationMap(panel);
  const rails = layout.rows.map((items, index) =>
    buildRail(index, items, designations)
  );

  const railCount = rails.length;
  const railX = SHEET_FRAME.x + 7.5;
  const enclosureTop = RAIL_TOP - 6;
  const enclosureBottom = RAIL_TOP + (railCount - 1) * RAIL_PITCH + RAIL_HEIGHT + 4;
  const enclosureRect: SheetRect = {
    x: railX - 5,
    y: enclosureTop,
    width: DIN_RAIL_WIDTH_MM + 10,
    height: Math.max(RAIL_HEIGHT + 10, enclosureBottom - enclosureTop),
  };

  const date = options.date ?? new Intl.DateTimeFormat('ru-RU').format(new Date());
  const errors = layout.warnings.filter((warning) => warning.severity === 'error').length;
  const warnings = layout.warnings.filter((warning) => warning.severity === 'warning').length;
  const infos = layout.warnings.filter((warning) => warning.severity === 'info').length;

  const legendX = railX + DIN_RAIL_WIDTH_MM + 12;
  const legendWidth = SHEET_FRAME.x + SHEET_FRAME.width - legendX - 7.5;
  const legend = {
    rect: { x: legendX, y: 44, width: legendWidth, height: 34 } as SheetRect,
    title: 'Обозначения',
    entries: [
      { tone: 'input' as const, label: 'Ввод и учёт' },
      { tone: 'protection' as const, label: 'УЗО, дифавтоматы, РКН, УЗИП' },
      { tone: 'line' as const, label: 'Групповые автоматы' },
      { tone: 'free' as const, label: 'Свободные модули' },
    ],
  };

  const summary: DinInfoBox = {
    rect: { x: legendX, y: 86, width: legendWidth, height: 44 },
    title: 'Корпус',
    lines: [
      `${layout.enclosureModules} модулей · ${railCount} реек по 12`,
      `Занято ${layout.modulesTotal}, свободно ${layout.freeModules} (${num(
        layout.reservePercent,
        0
      )} %)`,
      `Стратегия запаса ${num(layout.reserveTarget * 100, 0)} %`,
      panel.mounting === 'flush' ? 'Монтаж встроенный' : 'Монтаж накладной',
    ],
  };

  const zonesBoxEntries = layout.zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    colorIndex: zone.colorIndex,
    modules: zone.modules,
    lines: zone.lineIds.length,
  }));
  const maxZoneRows = Math.max(1, Math.floor((SHEET_NOTES_BLOCK.y - 146) / 6));
  const truncated = Math.max(0, zonesBoxEntries.length - maxZoneRows);
  const visibleZones =
    truncated > 0 ? zonesBoxEntries.slice(0, maxZoneRows - 1) : zonesBoxEntries;
  const zonesBox: DinZonesBox = {
    rect: {
      x: legendX,
      y: 136,
      width: legendWidth,
      height: Math.max(16, 10 + visibleZones.length * 6 + (truncated > 0 ? 6 : 0)),
    },
    title: 'Зоны раскладки',
    entries: visibleZones,
    truncated,
  };

  const capacity = normalizeBreakingCapacity(panel.breakingCapacityKa);
  const notes = [
    `Занято ${layout.modulesTotal} из ${layout.enclosureModules} модулей, свободно ${layout.freeModules}.`,
    `Класс всех модульных аппаратов — ${breakingCapacityLabel(
      capacity
    )} по отключающей способности (Icn).`,
    'Обозначения соответствуют схеме ЭС-01, перечень — спецификации ЭС-03.',
    'Один модуль — 17,5 мм; на листе ширина модуля 18 мм, рейка — 216 мм.',
    `Зон раскладки: ${layout.zones.length}. Границы зон показаны цветом и подписями над рейками.`,
    layout.manualOrder
      ? 'Порядок аппаратов ручной: проверьте, что ввод первый, а УЗО стоит после своего автомата.'
      : 'Порядок проектный: ввод и защита слева, далее зоны комнат по порядку линий.',
    errors + warnings + infos > 0
      ? `Раскладка: ошибок ${errors}, замечаний ${warnings}, примечаний ${infos}.`
      : 'Раскладка без замечаний: все аппараты размещены.',
    'Перед монтажом проверьте габариты корпуса, глубину аппаратов и сечения шин.',
  ];

  return {
    panelName: panel.name,
    title: 'Схема расположения оборудования в щите',
    subtitle: `${panel.name} · ${
      panel.mounting === 'flush' ? 'встроенный' : 'накладной'
    } · корпус ${layout.enclosureModules} модулей · ${railCount} реек`,
    paper: { width: A3_WIDTH_MM, height: A3_HEIGHT_MM },
    frame: { ...SHEET_FRAME },
    titleY: 13.2,
    subtitleY: 18.4,
    enclosureRect,
    railX,
    railWidth: DIN_RAIL_WIDTH_MM,
    slotWidth: DIN_SLOT_WIDTH_MM,
    itemHeight: DIN_ITEM_HEIGHT_MM,
    rails,
    legend,
    summary,
    zonesBox,
    notesBlock: { ...SHEET_NOTES_BLOCK },
    notesTitle: 'Примечания к компоновке',
    notesLines: notes,
    document: buildSheetDocumentBlock({
      title: 'Компоновка щита',
      subtitle: 'схема расположения оборудования',
      objectTitle: panel.name,
      designation: 'ЭС-04',
      basis: 'ГОСТ 2.301 · ГОСТ 2.104 · ГОСТ IEC 61439-3',
      date,
    }),
  };
}

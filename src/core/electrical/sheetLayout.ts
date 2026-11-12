import type { PhaseLabel } from '../../types';
import type { PanelSchematic, SchematicGroup, SchematicInputItem } from './schematic';

// -------------------------------------------------------------
// Раскладка листа A3 (420×297 мм, горизонтальная) для схемы щита.
// Модуль не рисует: он отдаёт координаты в миллиметрах, а SVG-слой
// переводит их в экранные пиксели. Так лист можно проверить тестами
// и позже напечатать/сохранить в PDF без пересчёта модели.
// -------------------------------------------------------------

export const A3_WIDTH_MM = 420;
export const A3_HEIGHT_MM = 297;

// Внутренняя рамка: слева 20 мм на подшивку, справа/сверху/снизу 5 мм.
export const SHEET_FRAME = { x: 20, y: 5, width: 395, height: 287 } as const;
// Основная надпись 185×55 в правом нижнем углу — ГОСТ 2.104-2006, форма 1.
export const SHEET_TITLE_BLOCK = { x: 230, y: 237, width: 185, height: 55 } as const;
export const SHEET_NOTES_BLOCK = { x: 20, y: 237, width: 205, height: 55 } as const;

const DRAWING_TOP = 5;
const DRAWING_BOTTOM = 231;
const GROUP_TOP = 46;
const GROUP_BOTTOM = 222;
const BUS_TOP = 36;
const BUS_BOTTOM = 227;
const INPUT_ROW_Y = 13.5;
const INPUT_ROW_HEIGHT = 13;
const INPUT_START_X = 30;
const INPUT_ITEM_WIDTH = 28;
const INPUT_ITEM_GAP = 3.5;
const INPUT_CONDUCTOR_Y = 20;
const DISTRIBUTION_Y = 33;
const BREAKER_X = 80;
const BREAKER_WIDTH = 13;
const RCD_X = 95;
const RCD_WIDTH = 15;
const GROUP_END_X = 411;
const PHASE_BUS_X_3: Record<'L1' | 'L2' | 'L3', number> = {
  L1: 38,
  L2: 45,
  L3: 52,
};
const NEUTRAL_BUS_X_3 = 59;
const PE_BUS_X_3 = 66;
const PHASE_BUS_X_1 = 40;
const NEUTRAL_BUS_X_1 = 55;
const PE_BUS_X_1 = 68;

export type SheetBusKey = 'L1' | 'L2' | 'L3' | 'L' | 'N' | 'PE';
export type SheetStatus = 'ok' | 'warnings' | 'errors';

export const SHEET_BUS_COLORS: Record<SheetBusKey, string> = {
  L1: '#b45309',
  L2: '#1f2937',
  L3: '#6b7280',
  L: '#b45309',
  N: '#1d4ed8',
  PE: '#4d7c0f',
};

export interface SheetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SheetPoint {
  x: number;
  y: number;
}

export interface SheetBus {
  key: SheetBusKey;
  label: string;
  x: number;
  color: string;
}

export interface SheetInputItem extends SchematicInputItem {
  rect: SheetRect;
  parallel: boolean;
}

export interface SheetGroup {
  group: SchematicGroup;
  rowY: number;
  compact: boolean;
  tapX: number;
  phaseColor: string;
  breakerRect: SheetRect;
  rcdRect: SheetRect | null;
  labelX: number;
  powerX: number;
  endpoint: SheetPoint;
}

export type SheetTitleFieldId =
  | 'designation'
  | 'name'
  | 'material'
  | 'litera'
  | 'mass'
  | 'scale'
  | 'sheet'
  | 'sheets'
  | 'organization';

export interface SheetTitleLine {
  text: string;
  fontSize: number;
  weight?: number;
  muted?: boolean;
}

export interface SheetTitleField {
  id: SheetTitleFieldId;
  rect: SheetRect;
  lines: SheetTitleLine[];
  anchor: 'start' | 'middle' | 'end';
  valign: 'top' | 'middle';
  paddingX: number;
}

export interface SheetTitleHeader {
  id: string;
  rect: SheetRect;
  text: string;
}

export interface SheetTitleRole {
  id: 'developer' | 'checker' | 'techControl' | 'normControl' | 'approver';
  label: string;
  labelRect: SheetRect;
  nameRect: SheetRect;
  signatureRect: SheetRect;
  dateRect: SheetRect;
  name: string;
  date: string;
}

export interface SheetStampLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
}

export interface SheetTitleBlock {
  rect: SheetRect;
  fields: SheetTitleField[];
  headers: SheetTitleHeader[];
  roles: SheetTitleRole[];
  grid: SheetStampLine[];
  // Сводные значения для UI и тестов.
  documentTitle: string;
  objectTitle: string;
  designation: string;
  stage: string;
  sheet: string;
  sheetTotal: string;
  scale: string;
  litera: string;
  organization: string;
  date: string;
  basis: string;
}

export interface SheetStatusBox {
  rect: SheetRect;
  title: string;
  text: string;
  severity: SheetStatus;
}

export interface PanelSheetLayout {
  paper: { width: number; height: number };
  frame: SheetRect;
  drawingArea: SheetRect;
  groupArea: SheetRect;
  titleBlock: SheetTitleBlock;
  notesBlock: SheetRect;
  notesLines: string[];
  input: {
    rowY: number;
    height: number;
    conductorY: number;
    distributionY: number;
    sourceLabel: string;
    items: SheetInputItem[];
  };
  buses: SheetBus[];
  busTop: number;
  busBottom: number;
  groups: SheetGroup[];
  groupPitch: number;
  status: SheetStatus;
  statusText: string;
  statusBox: SheetStatusBox;
}

export interface PanelSheetOptions {
  date?: string;
}

function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

function kw(value: number): string {
  return `${num(value / 1000, 2)} кВт`;
}

function cableLabel(cores: number, sectionMm2: number): string {
  return `${cores}×${sectionMm2} мм²`;
}

function buildBuses(phases: 1 | 3): SheetBus[] {
  if (phases === 3) {
    return [
      { key: 'L1', label: 'L1', x: PHASE_BUS_X_3.L1, color: SHEET_BUS_COLORS.L1 },
      { key: 'L2', label: 'L2', x: PHASE_BUS_X_3.L2, color: SHEET_BUS_COLORS.L2 },
      { key: 'L3', label: 'L3', x: PHASE_BUS_X_3.L3, color: SHEET_BUS_COLORS.L3 },
      { key: 'N', label: 'N', x: NEUTRAL_BUS_X_3, color: SHEET_BUS_COLORS.N },
      { key: 'PE', label: 'PE', x: PE_BUS_X_3, color: SHEET_BUS_COLORS.PE },
    ];
  }
  return [
    { key: 'L', label: 'L', x: PHASE_BUS_X_1, color: SHEET_BUS_COLORS.L },
    { key: 'N', label: 'N', x: NEUTRAL_BUS_X_1, color: SHEET_BUS_COLORS.N },
    { key: 'PE', label: 'PE', x: PE_BUS_X_1, color: SHEET_BUS_COLORS.PE },
  ];
}

function phaseTapX(phase: PhaseLabel | null, phases: 1 | 3): number {
  if (phases === 1) return PHASE_BUS_X_1;
  return PHASE_BUS_X_3[phase ?? 'L1'];
}

function phaseColor(phase: PhaseLabel | null, phases: 1 | 3): string {
  if (phases === 1 || !phase) return SHEET_BUS_COLORS.L;
  return SHEET_BUS_COLORS[phase];
}

function buildNotes(schematic: PanelSchematic): string[] {
  const supply = schematic.supply;
  const errors = schematic.findings.filter((finding) => finding.severity === 'error').length;
  const warnings = schematic.findings.filter(
    (finding) => finding.severity === 'warning'
  ).length;
  const series = schematic.inputItems
    .filter((item) => item.kind !== 'voltage_relay' && item.kind !== 'spd')
    .map((item) => item.designation);
  const parallel = schematic.inputItems
    .filter((item) => item.kind === 'voltage_relay' || item.kind === 'spd')
    .map((item) => item.designation);
  const sequence = parallel.length
    ? `${series.join(', ')} — последовательно; ${parallel.join(', ')} — параллельно шинам.`
    : `${series.join(', ')} — последовательно.`;
  const mainRcd = supply.mainRcd
    ? `Противопожарное УЗО: QD1 ${supply.mainRcd.sensitivityMa} мА, тип ${
        supply.mainRcd.type
      }${supply.mainRcd.selective ? ' S' : ''}${
        supply.mainRcd.selective ? ' (селективное)' : ''
      }.`
    : 'Противопожарное УЗО на вводе не предусмотрено.';
  const totalCable =
    schematic.totalCableLengthMm > 0
      ? `${num(schematic.totalCableLengthMm / 1000, 1)} м`
      : 'не рассчитана';

  return [
    `Ввод: ${supply.voltageLabel}, система ${supply.system}, категория надёжности ${supply.reliabilityCategory}.`,
    `Мощности: установленная ${kw(supply.installedPowerW)}, расчётная ${kw(
      supply.designPowerW
    )}; выделенная ${kw(supply.allocatedPowerW)}.`,
    `Расчётный ток ввода ${num(supply.designCurrentA)} А; cos φ = ${num(
      supply.cosPhi,
      2
    )}; Kс = ${num(supply.demandFactor, 2)}.`,
    `Вводной кабель: ${supply.cableBrand} ${cableLabel(
      supply.inputCable.cores,
      supply.inputCable.sectionMm2
    )}; автомат QF1 ${supply.inputBreaker.ratingA} А ${supply.inputBreaker.poles}P ${
      supply.inputBreaker.curve
    }.`,
    mainRcd,
    `Групповые линии: ${supply.cableBrand}; суммарная длина кабелей ${totalCable}.`,
    `Включение: ${sequence}`,
    'Обозначения: QF — автоматический выключатель; QD — УЗО; PI — счётчик; KV — реле напряжения; F — УЗИП.',
    'Нормативная база: ПУЭ-7; СП 256.1325800.2016; СП 31-110-2003; ГОСТ 2.702-2011.',
    schematic.groups.length === 0
      ? 'Групповые линии не заданы — схема неполная.'
      : `Проверка по нормам: ошибок ${errors}, замечаний ${warnings}.`,
  ];
}

// Основная надпись по ГОСТ 2.104-2006, форма 1: 185×55 мм.
// Слева 65 мм — таблица изменений и подписей (11 строк по 5 мм),
// справа 120 мм — графы 2, 1, 4–9. Координаты задаются в миллиметрах.
export function buildTitleBlock(
  schematic: PanelSchematic,
  date: string
): SheetTitleBlock {
  const x = SHEET_TITLE_BLOCK.x;
  const y = SHEET_TITLE_BLOCK.y;
  const right = x + SHEET_TITLE_BLOCK.width;
  const bottom = y + SHEET_TITLE_BLOCK.height;
  const leftEdge = x + 65;
  const rightStart = leftEdge + 70;

  const grid: SheetStampLine[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, weight = 0.35) =>
    grid.push({ x1, y1, x2, y2, weight });

  for (let row = 1; row < 11; row += 1) {
    line(x, y + row * 5, leftEdge, y + row * 5);
  }
  line(x + 7, y, x + 7, y + 25);
  line(x + 17, y, x + 17, bottom);
  line(x + 40, y, x + 40, bottom);
  line(x + 55, y, x + 55, bottom);
  line(leftEdge, y, leftEdge, bottom);

  line(leftEdge, y + 15, right, y + 15);
  line(leftEdge, y + 20, right, y + 20);
  line(rightStart, y + 35, right, y + 35);
  line(leftEdge, y + 40, right, y + 40);
  line(rightStart, y + 15, rightStart, bottom);
  line(rightStart + 15, y + 15, rightStart + 15, y + 35);
  line(rightStart + 32, y + 15, rightStart + 32, y + 35);
  line(rightStart + 20, y + 35, rightStart + 20, y + 40);
  line(rightStart + 5, y + 20, rightStart + 5, y + 35);
  line(rightStart + 10, y + 20, rightStart + 10, y + 35);

  const field = (
    id: SheetTitleFieldId,
    rect: SheetRect,
    lines: SheetTitleLine[],
    anchor: SheetTitleField['anchor'] = 'middle',
    valign: SheetTitleField['valign'] = 'middle',
    paddingX = 0
  ): SheetTitleField => ({ id, rect, lines, anchor, valign, paddingX });

  const fields: SheetTitleField[] = [
    field(
      'designation',
      { x: leftEdge, y, width: 120, height: 15 },
      [{ text: 'ЭС-01', fontSize: 6, weight: 700 }]
    ),
    field(
      'name',
      { x: leftEdge, y: y + 20, width: 70, height: 20 },
      [
        { text: schematic.panelName, fontSize: 3.2, weight: 700 },
        { text: schematic.title, fontSize: 1.85 },
        { text: 'Стадия Р', fontSize: 1.7, muted: true },
      ]
    ),
    field('material', { x: leftEdge, y: y + 40, width: 70, height: 15 }, []),
    field(
      'litera',
      { x: rightStart, y: y + 20, width: 15, height: 15 },
      [{ text: 'Р', fontSize: 3.2, weight: 700 }],
      'start',
      'middle',
      1.6
    ),
    field('mass', { x: rightStart + 15, y: y + 20, width: 17, height: 15 }, []),
    field(
      'scale',
      { x: rightStart + 32, y: y + 20, width: 18, height: 15 },
      [{ text: 'б/м', fontSize: 2.6 }]
    ),
    field(
      'sheet',
      { x: rightStart, y: y + 35, width: 20, height: 5 },
      [{ text: '1', fontSize: 2.2, weight: 700 }],
      'end',
      'middle',
      1.1
    ),
    field(
      'sheets',
      { x: rightStart + 20, y: y + 35, width: 30, height: 5 },
      [{ text: '1', fontSize: 2.2, weight: 700 }],
      'end',
      'middle',
      1.1
    ),
    field(
      'organization',
      { x: rightStart, y: y + 40, width: 50, height: 15 },
      [{ text: 'Electrica', fontSize: 2.6, weight: 700 }]
    ),
  ];

  const header = (id: string, rect: SheetRect, text: string): SheetTitleHeader => ({
    id,
    rect,
    text,
  });
  const headers: SheetTitleHeader[] = [
    header('litera', { x: rightStart, y: y + 15, width: 15, height: 5 }, 'Лит.'),
    header('mass', { x: rightStart + 15, y: y + 15, width: 17, height: 5 }, 'Масса'),
    header(
      'scale',
      { x: rightStart + 32, y: y + 15, width: 18, height: 5 },
      'Масштаб'
    ),
    header('change', { x, y: y + 20, width: 7, height: 5 }, 'Изм.'),
    header('sheet', { x: x + 7, y: y + 20, width: 10, height: 5 }, 'Лист'),
    header('document', { x: x + 17, y: y + 20, width: 23, height: 5 }, '№ докум.'),
    header('signature', { x: x + 40, y: y + 20, width: 15, height: 5 }, 'Подп.'),
    header('date', { x: x + 55, y: y + 20, width: 10, height: 5 }, 'Дата'),
    header('sheetCaption', { x: rightStart, y: y + 35, width: 12, height: 5 }, 'Лист'),
    header(
      'sheetsCaption',
      { x: rightStart + 20, y: y + 35, width: 18, height: 5 },
      'Листов'
    ),
  ];

  const role = (
    id: SheetTitleRole['id'],
    label: string,
    rowY: number,
    roleDate = ''
  ): SheetTitleRole => ({
    id,
    label,
    labelRect: { x, y: rowY, width: 17, height: 5 },
    nameRect: { x: x + 17, y: rowY, width: 23, height: 5 },
    signatureRect: { x: x + 40, y: rowY, width: 15, height: 5 },
    dateRect: { x: x + 55, y: rowY, width: 10, height: 5 },
    name: '',
    date: roleDate,
  });
  const roles: SheetTitleRole[] = [
    role('developer', 'Разраб.', y + 25, date),
    role('checker', 'Пров.', y + 30),
    role('techControl', 'Т. контр.', y + 35),
    role('normControl', 'Н. контр.', y + 45),
    role('approver', 'Утв.', y + 50),
  ];

  return {
    rect: { ...SHEET_TITLE_BLOCK },
    fields,
    headers,
    roles,
    grid,
    documentTitle: schematic.title,
    objectTitle: schematic.panelName,
    designation: 'ЭС-01',
    stage: 'Стадия Р',
    sheet: '1',
    sheetTotal: '1',
    scale: 'б/м',
    litera: 'Р',
    organization: 'Electrica',
    date,
    basis: 'ГОСТ 2.104-2006, форма 1',
  };
}

export function buildPanelSheet(
  schematic: PanelSchematic,
  options: PanelSheetOptions = {}
): PanelSheetLayout {
  const phases = schematic.supply.phases;
  const buses = buildBuses(phases);

  const inputItems: SheetInputItem[] = schematic.inputItems.map((item, index) => ({
    ...item,
    rect: {
      x: INPUT_START_X + index * (INPUT_ITEM_WIDTH + INPUT_ITEM_GAP),
      y: INPUT_ROW_Y,
      width: INPUT_ITEM_WIDTH,
      height: INPUT_ROW_HEIGHT,
    },
    parallel: item.kind === 'voltage_relay' || item.kind === 'spd',
  }));

  const count = schematic.groups.length;
  const areaHeight = GROUP_BOTTOM - GROUP_TOP;
  const groupPitch = count > 0 ? Math.min(10, areaHeight / count) : 10;
  const totalHeight = groupPitch * count;
  const startY = GROUP_TOP + (areaHeight - totalHeight) / 2;
  const boxHeight = Math.min(8, Math.max(2.2, groupPitch * 0.7), groupPitch - 0.6);

  const groups: SheetGroup[] = schematic.groups.map((group, index) => {
    const rowY = startY + groupPitch * (index + 0.5);
    const rcdRect = group.rcd
      ? { x: RCD_X, y: rowY - boxHeight / 2, width: RCD_WIDTH, height: boxHeight }
      : null;
    return {
      group,
      rowY,
      compact: groupPitch < 6.3,
      tapX: phaseTapX(group.phase, phases),
      phaseColor: phaseColor(group.phase, phases),
      breakerRect: {
        x: BREAKER_X,
        y: rowY - boxHeight / 2,
        width: BREAKER_WIDTH,
        height: boxHeight,
      },
      rcdRect,
      labelX: rcdRect ? RCD_X + RCD_WIDTH + 4 : BREAKER_X + BREAKER_WIDTH + 4,
      powerX: GROUP_END_X - 2,
      endpoint: { x: GROUP_END_X, y: rowY },
    };
  });

  const errors = schematic.findings.filter((finding) => finding.severity === 'error').length;
  const warnings = schematic.findings.filter(
    (finding) => finding.severity === 'warning'
  ).length;
  const status: SheetStatus =
    errors > 0 ? 'errors' : count === 0 || warnings > 0 ? 'warnings' : 'ok';
  const statusText =
    errors > 0
      ? `Ошибок: ${errors}`
      : count === 0
        ? 'Группы не заданы'
        : warnings > 0
          ? `Замечаний: ${warnings}`
          : 'Нормы соблюдены';

  return {
    paper: { width: A3_WIDTH_MM, height: A3_HEIGHT_MM },
    frame: { ...SHEET_FRAME },
    drawingArea: {
      x: SHEET_FRAME.x,
      y: DRAWING_TOP,
      width: SHEET_FRAME.width,
      height: DRAWING_BOTTOM - DRAWING_TOP,
    },
    groupArea: {
      x: SHEET_FRAME.x,
      y: GROUP_TOP,
      width: SHEET_FRAME.width,
      height: GROUP_BOTTOM - GROUP_TOP,
    },
    titleBlock: buildTitleBlock(
      schematic,
      options.date ?? new Intl.DateTimeFormat('ru-RU').format(new Date())
    ),
    notesBlock: { ...SHEET_NOTES_BLOCK },
    notesLines: buildNotes(schematic),
    input: {
      rowY: INPUT_ROW_Y,
      height: INPUT_ROW_HEIGHT,
      conductorY: INPUT_CONDUCTOR_Y,
      distributionY: DISTRIBUTION_Y,
      sourceLabel: 'Ввод 0,4 кВ',
      items: inputItems,
    },
    buses,
    busTop: BUS_TOP,
    busBottom: BUS_BOTTOM,
    groups,
    groupPitch,
    status,
    statusText,
    statusBox: {
      rect: { x: 300, y: 8, width: 111, height: 20 },
      title: 'Проверка по нормам',
      text: statusText,
      severity: status,
    },
  };
}

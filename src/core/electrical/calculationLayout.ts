import {
  A3_HEIGHT_MM,
  A3_WIDTH_MM,
  SHEET_FRAME,
  SHEET_NOTES_BLOCK,
  SHEET_TITLE_BLOCK,
  type SheetRect,
  type SheetStampLine,
  type SheetStatus,
} from './sheetLayout';
import {
  calculationStatus,
  calculationStatusText,
  type PanelCalculation,
  type PanelCalculationRow,
} from './calculation';

// -------------------------------------------------------------
// Раскладка расчётной таблицы на листе A3 (420×297 мм).
// Как и лист схемы, модуль не рисует: он отдаёт миллиметровые
// координаты, а SVG-слой переводит их в экранные пиксели.
// -------------------------------------------------------------

export type CalculationColumnId =
  | 'index'
  | 'designation'
  | 'name'
  | 'phase'
  | 'installed'
  | 'demand'
  | 'cosPhi'
  | 'design'
  | 'current'
  | 'breaker'
  | 'rcd'
  | 'cable'
  | 'length'
  | 'drop'
  | 'status';

export type CalculationAlign = 'start' | 'middle' | 'end';
export type CalculationTone = 'normal' | 'muted' | 'ok' | 'warning' | 'error';

export interface CalculationColumn {
  id: CalculationColumnId;
  label: string[];
  width: number;
  align: CalculationAlign;
}

export interface CalculationCell {
  columnId: CalculationColumnId;
  x: number;
  width: number;
  text: string;
  sub?: string;
  align: CalculationAlign;
  fontSize: number;
  subFontSize: number;
  tone: CalculationTone;
  bold: boolean;
}

export type CalculationRowKind = 'input' | 'line' | 'empty' | 'total';

export interface CalculationRow {
  kind: CalculationRowKind;
  index: number | null;
  y: number;
  height: number;
  fill: string;
  cells: CalculationCell[];
}

export interface CalculationTable {
  x: number;
  y: number;
  width: number;
  headerHeight: number;
  rowHeight: number;
  compact: boolean;
  bottom: number;
  columns: CalculationColumn[];
  rows: CalculationRow[];
  lines: SheetStampLine[];
}

export interface CalculationHeaderBox {
  rect: SheetRect;
  title: string;
  lines: string[];
  tone: CalculationTone;
}

export interface CalculationDocumentRole {
  id: 'developer' | 'checker' | 'techControl' | 'normControl' | 'approver';
  label: string;
  labelRect: SheetRect;
  nameRect: SheetRect;
  signatureRect: SheetRect;
  dateRect: SheetRect;
  date: string;
}

export interface CalculationDocumentBlock {
  rect: SheetRect;
  title: string;
  objectTitle: string;
  designation: string;
  stage: string;
  sheet: string;
  sheetTotal: string;
  organization: string;
  date: string;
  basis: string;
  roles: CalculationDocumentRole[];
  grid: SheetStampLine[];
}

export interface CalculationSheetLayout {
  paper: { width: number; height: number };
  frame: SheetRect;
  title: string;
  subtitle: string;
  titleY: number;
  subtitleY: number;
  headerBoxes: CalculationHeaderBox[];
  table: CalculationTable;
  notesBlock: SheetRect;
  notesTitle: string;
  notesLines: string[];
  document: CalculationDocumentBlock;
  status: SheetStatus;
  statusText: string;
}

export interface CalculationSheetOptions {
  date?: string;
}

const MARGIN = 7.5;
const TABLE_TOP = 38.5;
const TABLE_BOTTOM = 233;
const HEADER_HEIGHT = 8.5;
const INPUT_HEIGHT = 7;
const TOTAL_HEIGHT = 7;
const EMPTY_HEIGHT = 10;
const MIN_ROW_HEIGHT = 2.2;
const MAX_ROW_HEIGHT = 7;
const COMPACT_ROW_HEIGHT = 5.2;

const COLUMNS: CalculationColumn[] = [
  { id: 'index', label: ['№'], width: 12, align: 'middle' },
  { id: 'designation', label: ['Обозначение'], width: 18, align: 'middle' },
  { id: 'name', label: ['Потребитель', 'назначение'], width: 92, align: 'start' },
  { id: 'phase', label: ['Фаза'], width: 12, align: 'middle' },
  { id: 'installed', label: ['Pу,', 'кВт'], width: 20, align: 'end' },
  { id: 'demand', label: ['Kс'], width: 14, align: 'end' },
  { id: 'cosPhi', label: ['cos φ'], width: 16, align: 'end' },
  { id: 'design', label: ['Pр,', 'кВт'], width: 20, align: 'end' },
  { id: 'current', label: ['Iр,', 'А'], width: 18, align: 'end' },
  { id: 'breaker', label: ['Аппарат', 'защиты'], width: 34, align: 'middle' },
  { id: 'rcd', label: ['УЗО'], width: 28, align: 'middle' },
  { id: 'cable', label: ['Кабель', 'марка, мм²'], width: 40, align: 'middle' },
  { id: 'length', label: ['L,', 'м'], width: 18, align: 'end' },
  { id: 'drop', label: ['ΔU,', '%'], width: 18, align: 'end' },
  { id: 'status', label: ['Проверка'], width: 20, align: 'middle' },
];

const COLUMN_OFFSETS = new Map<CalculationColumnId, number>();
let offset = 0;
for (const column of COLUMNS) {
  COLUMN_OFFSETS.set(column.id, offset);
  offset += column.width;
}

export const CALCULATION_COLUMNS = COLUMNS;
export const CALCULATION_TABLE_WIDTH = COLUMN_OFFSETS.get('status')! + COLUMNS[COLUMNS.length - 1].width;

function num(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

function kw(value: number): string {
  return `${num(value / 1000, 2)} кВт`;
}

function cableLabel(sectionMm2: number, cores: number): string {
  return `${cores}×${num(sectionMm2, sectionMm2 % 1 === 0 ? 0 : 1)}`;
}

function breakerLabel(ratingA: number, curve: string, poles: number): string {
  return `${ratingA} А · ${curve} · ${poles}P`;
}

function rcdLabel(sensitivityMa: number, type: string, selective?: boolean): string {
  return `${sensitivityMa} мА · ${type}${selective ? ' S' : ''}`;
}

function statusLabel(errors: number, warnings: number): string {
  if (errors > 0) return `ошиб. ${errors}`;
  if (warnings > 0) return `замеч. ${warnings}`;
  return 'ОК';
}

function statusTone(errors: number, warnings: number): CalculationTone {
  if (errors > 0) return 'error';
  if (warnings > 0) return 'warning';
  return 'ok';
}

function fitText(text: string, maxWidthMm: number, fontSize: number): string {
  if (!text) return '';
  const maxChars = Math.max(1, Math.floor(maxWidthMm / (fontSize * 0.52)));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

interface CellSeed {
  text: string;
  sub?: string;
  tone?: CalculationTone;
  bold?: boolean;
}

type CellSeeds = Partial<Record<CalculationColumnId, CellSeed>>;

function buildCells(
  tableX: number,
  height: number,
  compact: boolean,
  seeds: CellSeeds
): CalculationCell[] {
  const fontSize = compact
    ? Math.min(1.85, Math.max(1.2, height * 0.42))
    : 2;
  const subFontSize = compact
    ? 0
    : Math.min(1.55, Math.max(1.1, height * 0.26));
  return COLUMNS.map((column) => {
    const seed = seeds[column.id] ?? { text: '' };
    const x = tableX + (COLUMN_OFFSETS.get(column.id) ?? 0);
    const innerWidth = column.width - 2.2;
    return {
      columnId: column.id,
      x,
      width: column.width,
      text: fitText(seed.text, innerWidth, fontSize),
      sub: seed.sub && subFontSize > 0
        ? fitText(seed.sub, innerWidth, subFontSize)
        : undefined,
      align: column.align,
      fontSize,
      subFontSize,
      tone: seed.tone ?? 'normal',
      bold: seed.bold ?? false,
    };
  });
}

function inputSeeds(calculation: PanelCalculation): CellSeeds {
  const input = calculation.input;
  return {
    index: { text: '—', tone: 'muted' },
    designation: {
      text: input.designation,
      sub: input.rcd ? 'QD1' : undefined,
      bold: true,
    },
    name: { text: input.name, sub: 'Ввод 0,4 кВ', bold: true },
    phase: { text: input.phaseLabel },
    installed: { text: num(input.installedPowerW / 1000, 2) },
    demand: { text: num(input.demandFactor, 2) },
    cosPhi: { text: num(input.cosPhi, 2) },
    design: { text: num(input.designPowerW / 1000, 2), bold: true },
    current: { text: num(input.designCurrentA, 1), bold: true },
    breaker: {
      text: breakerLabel(
        input.breaker.ratingA,
        input.breaker.curve,
        input.breaker.poles
      ),
    },
    rcd: input.rcd
      ? {
          text: rcdLabel(
            input.rcd.sensitivityMa,
            input.rcd.type,
            input.rcd.selective
          ),
          sub: `${input.rcd.poles}P · ${input.rcd.ratingA} А`,
        }
      : { text: 'нет', tone: 'muted' },
    cable: {
      text: cableLabel(input.cable.sectionMm2, input.cable.cores),
      sub: input.cableBrand,
    },
    length: { text: '—', tone: 'muted' },
    drop: { text: '—', tone: 'muted' },
    status: {
      text: statusLabel(input.errors, input.warnings),
      tone: statusTone(input.errors, input.warnings),
      bold: true,
    },
  };
}

function lineSeeds(
  row: PanelCalculationRow,
  phases: 1 | 3
): CellSeeds {
  const lengthLabel =
    row.cableLengthMm > 0 ? num(row.cableLengthMm / 1000, 1) : '—';
  const dropLabel =
    row.cableLengthMm > 0 ? num(row.voltageDropPercent, 1) : '—';
  const details = [
    row.purposeLabel,
    row.roomsLabel,
    row.deviceCount > 0 ? `${row.deviceCount} приб.` : 'нет приборов',
  ]
    .filter((part) => part.length > 0)
    .join(' · ');
  return {
    index: { text: String(row.index), tone: 'muted' },
    designation: {
      text: row.designation,
      sub: row.rcdDesignation ?? undefined,
      bold: true,
    },
    name: { text: row.name, sub: details },
    phase: { text: row.phase ?? (phases === 1 ? 'L' : '—') },
    installed: { text: num(row.installedPowerW / 1000, 2) },
    demand: { text: num(row.demandFactor, 2) },
    cosPhi: { text: num(row.cosPhi, 2) },
    design: { text: num(row.designPowerW / 1000, 2) },
    current: { text: num(row.designCurrentA, 1) },
    breaker: {
      text: breakerLabel(
        row.breaker.ratingA,
        row.breaker.curve,
        row.breaker.poles
      ),
    },
    rcd: row.rcd
      ? {
          text: rcdLabel(
            row.rcd.sensitivityMa,
            row.rcd.type,
            row.rcd.selective
          ),
          sub: `${row.rcd.poles}P · ${row.rcd.ratingA} А`,
        }
      : { text: 'нет', tone: 'muted' },
    cable: {
      text: cableLabel(row.cable.sectionMm2, row.cable.cores),
      sub: row.cableBrand,
    },
    length: { text: lengthLabel, tone: lengthLabel === '—' ? 'muted' : 'normal' },
    drop: {
      text: dropLabel,
      sub: row.cableLengthMm > 0 ? `≤ ${row.voltageDropLimitPercent}` : undefined,
      tone:
        row.cableLengthMm > 0 && !row.voltageDropOk
          ? 'warning'
          : dropLabel === '—'
            ? 'muted'
            : 'normal',
    },
    status: {
      text: statusLabel(row.errors, row.warnings),
      tone: row.status === 'error' ? 'error' : row.status === 'warning' ? 'warning' : 'ok',
      bold: true,
    },
  };
}

function totalSeeds(calculation: PanelCalculation): CellSeeds {
  const totals = calculation.totals;
  const errors = calculation.findings.filter(
    (finding) => finding.severity === 'error'
  ).length;
  const warnings = calculation.findings.filter(
    (finding) => finding.severity === 'warning'
  ).length;
  return {
    index: { text: 'Σ', bold: true },
    designation: { text: '—', tone: 'muted' },
    name: {
      text: 'Итого по щиту',
      sub: `${totals.rowCount} линий · ${totals.deviceCount} приб.`,
      bold: true,
    },
    phase: {
      text: calculation.supply.phases === 3 ? 'L1–L3' : 'L',
      bold: true,
    },
    installed: { text: num(totals.installedPowerW / 1000, 2), bold: true },
    demand: { text: '' },
    cosPhi: { text: '' },
    design: { text: num(totals.designPowerW / 1000, 2), bold: true },
    current: { text: num(totals.designCurrentA, 1), bold: true },
    breaker: { text: '—', tone: 'muted' },
    rcd: { text: '—', tone: 'muted' },
    cable: { text: '—', tone: 'muted' },
    length: {
      text:
        totals.cableLengthMm > 0
          ? num(totals.cableLengthMm / 1000, 1)
          : '—',
      bold: true,
      tone: totals.cableLengthMm > 0 ? 'normal' : 'muted',
    },
    drop: { text: '—', tone: 'muted' },
    status: {
      text: statusLabel(errors, warnings),
      tone: statusTone(errors, warnings),
      bold: true,
    },
  };
}

function buildHeaderBoxes(
  calculation: PanelCalculation,
  status: SheetStatus,
  statusText: string
): CalculationHeaderBox[] {
  const supply = calculation.supply;
  const x = SHEET_FRAME.x + MARGIN;
  const y = 21.5;
  const width = 124;
  const height = 12.5;
  const gap = 4;
  const rcd = supply.mainRcd;
  const phaseLine =
    supply.phases === 3
      ? calculation.phaseLoads
          .map((load) => `${load.phase} ${num(load.designPowerW / 1000, 2)}`)
          .join(' · ') + ' кВт'
      : `${calculation.totals.rowCount} линий · кабель ${num(
          calculation.totals.cableLengthMm / 1000,
          1
        )} м`;
  return [
    {
      rect: { x, y, width, height },
      title: 'Мощности',
      lines: [
        `Pу ${kw(supply.installedPowerW)} · Pр ${kw(supply.designPowerW)}`,
        `Kс ${num(supply.demandFactor, 2)} · cos φ ${num(supply.cosPhi, 2)}`,
      ],
      tone: 'normal',
    },
    {
      rect: { x: x + width + gap, y, width, height },
      title: 'Ввод',
      lines: [
        `QF1 ${breakerLabel(
          supply.inputBreaker.ratingA,
          supply.inputBreaker.curve,
          supply.inputBreaker.poles
        )} · ${cableLabel(supply.inputCable.sectionMm2, supply.inputCable.cores)}`,
        rcd
          ? `QD1 ${rcdLabel(
              rcd.sensitivityMa,
              rcd.type,
              rcd.selective
            )} · ${supply.system} · кат. ${supply.reliabilityCategory}`
          : `УЗО на вводе нет · ${supply.system} · кат. ${supply.reliabilityCategory}`,
      ],
      tone: 'normal',
    },
    {
      rect: { x: x + (width + gap) * 2, y, width, height },
      title: 'Проверка по нормам',
      lines: [statusText, phaseLine],
      tone: status === 'errors' ? 'error' : status === 'warnings' ? 'warning' : 'ok',
    },
  ];
}

function buildDocument(
  calculation: PanelCalculation,
  date: string
): CalculationDocumentBlock {
  const rect = { ...SHEET_TITLE_BLOCK };
  const x = rect.x;
  const y = rect.y;
  const grid: SheetStampLine[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, weight = 0.35) =>
    grid.push({ x1, y1, x2, y2, weight });
  line(x, y + 15, x + rect.width, y + 15, 0.5);
  line(x, y + 40, x + rect.width, y + 40, 0.5);
  line(x + 30, y + 15, x + 30, y + 40);
  line(x + 95, y + 15, x + 95, y + 40);
  line(x + 155, y + 15, x + 155, y + 40);
  for (let row = 1; row < 5; row += 1) {
    line(x, y + 15 + row * 5, x + rect.width, y + 15 + row * 5);
  }

  const role = (
    id: CalculationDocumentRole['id'],
    label: string,
    rowY: number,
    roleDate = ''
  ): CalculationDocumentRole => ({
    id,
    label,
    labelRect: { x, y: rowY, width: 30, height: 5 },
    nameRect: { x: x + 30, y: rowY, width: 65, height: 5 },
    signatureRect: { x: x + 95, y: rowY, width: 60, height: 5 },
    dateRect: { x: x + 155, y: rowY, width: 30, height: 5 },
    date: roleDate,
  });

  return {
    rect,
    title: 'Расчёт нагрузок',
    objectTitle: calculation.panelName,
    designation: 'ЭС-02',
    stage: 'Стадия Р',
    sheet: '1',
    sheetTotal: '1',
    organization: 'Electrica',
    date,
    basis: 'ПУЭ-7 · СП 256.1325800.2016 · СП 31-110-2003',
    roles: [
      role('developer', 'Разраб.', y + 15, date),
      role('checker', 'Пров.', y + 20),
      role('techControl', 'Т. контр.', y + 25),
      role('normControl', 'Н. контр.', y + 30),
      role('approver', 'Утв.', y + 35),
    ],
    grid,
  };
}

export function buildCalculationSheet(
  calculation: PanelCalculation,
  options: CalculationSheetOptions = {}
): CalculationSheetLayout {
  const calculationState = calculationStatus(calculation);
  const status: SheetStatus =
    calculationState === 'error'
      ? 'errors'
      : calculationState === 'warning'
        ? 'warnings'
        : 'ok';
  const statusText = calculationStatusText(calculation);
  const tableX = SHEET_FRAME.x + MARGIN;
  const tableWidth = CALCULATION_TABLE_WIDTH;
  const lineCount = calculation.rows.length;
  const available =
    TABLE_BOTTOM -
    TABLE_TOP -
    HEADER_HEIGHT -
    INPUT_HEIGHT -
    TOTAL_HEIGHT;
  const rowHeight =
    lineCount > 0
      ? Math.min(
          MAX_ROW_HEIGHT,
          Math.max(MIN_ROW_HEIGHT, available / lineCount)
        )
      : MAX_ROW_HEIGHT;
  const compact = rowHeight < COMPACT_ROW_HEIGHT;

  const rows: CalculationRow[] = [];
  let y = TABLE_TOP + HEADER_HEIGHT;
  rows.push({
    kind: 'input',
    index: null,
    y,
    height: INPUT_HEIGHT,
    fill: '#eff6ff',
    cells: buildCells(tableX, INPUT_HEIGHT, false, inputSeeds(calculation)),
  });
  y += INPUT_HEIGHT;

  if (lineCount === 0) {
    rows.push({
      kind: 'empty',
      index: null,
      y,
      height: EMPTY_HEIGHT,
      fill: '#ffffff',
      cells: buildCells(tableX, EMPTY_HEIGHT, false, {
        name: {
          text: 'Групповые линии не заданы',
          sub: 'Добавьте линии в щите или соберите их из приборов',
          tone: 'muted',
        },
        status: { text: '—', tone: 'muted' },
      }),
    });
    y += EMPTY_HEIGHT;
  } else {
    calculation.rows.forEach((row, index) => {
      rows.push({
        kind: 'line',
        index: row.index,
        y,
        height: rowHeight,
        fill: index % 2 === 0 ? '#ffffff' : '#f8fafc',
        cells: buildCells(
          tableX,
          rowHeight,
          compact,
          lineSeeds(row, calculation.supply.phases)
        ),
      });
      y += rowHeight;
    });
  }

  rows.push({
    kind: 'total',
    index: null,
    y,
    height: TOTAL_HEIGHT,
    fill: '#e2e8f0',
    cells: buildCells(tableX, TOTAL_HEIGHT, false, totalSeeds(calculation)),
  });
  y += TOTAL_HEIGHT;
  const tableBottom = y;

  const lines: SheetStampLine[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, weight = 0.35) =>
    lines.push({ x1, y1, x2, y2, weight });
  line(tableX, TABLE_TOP, tableX + tableWidth, TABLE_TOP, 0.5);
  line(
    tableX,
    TABLE_TOP + HEADER_HEIGHT,
    tableX + tableWidth,
    TABLE_TOP + HEADER_HEIGHT,
    0.5
  );
  for (const row of rows) {
    line(tableX, row.y + row.height, tableX + tableWidth, row.y + row.height, 0.25);
  }
  line(tableX, tableBottom, tableX + tableWidth, tableBottom, 0.5);
  let columnX = tableX;
  for (const column of COLUMNS.slice(0, -1)) {
    columnX += column.width;
    line(columnX, TABLE_TOP, columnX, tableBottom, 0.25);
  }

  const date =
    options.date ?? new Intl.DateTimeFormat('ru-RU').format(new Date());

  return {
    paper: { width: A3_WIDTH_MM, height: A3_HEIGHT_MM },
    frame: { ...SHEET_FRAME },
    title: calculation.title,
    subtitle: `${calculation.panelName} · ${
      calculation.supply.voltageLabel
    } · ${calculation.supply.system} · категория ${
      calculation.supply.reliabilityCategory
    }`,
    titleY: 13.2,
    subtitleY: 18.4,
    headerBoxes: buildHeaderBoxes(calculation, status, statusText),
    table: {
      x: tableX,
      y: TABLE_TOP,
      width: tableWidth,
      headerHeight: HEADER_HEIGHT,
      rowHeight,
      compact,
      bottom: tableBottom,
      columns: COLUMNS,
      rows,
      lines,
    },
    notesBlock: { ...SHEET_NOTES_BLOCK },
    notesTitle: 'Примечания и нормативные ссылки',
    notesLines: calculation.notes,
    document: buildDocument(calculation, date),
    status,
    statusText,
  };
}

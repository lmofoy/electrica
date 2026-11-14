import {
  A3_HEIGHT_MM,
  A3_WIDTH_MM,
  SHEET_FRAME,
  SHEET_NOTES_BLOCK,
  type SheetRect,
  type SheetStampLine,
  type SheetStatus,
} from './sheetLayout';
import type { PanelSpecification, SpecificationItem } from './specification';
import {
  buildSheetDocumentBlock,
  type SheetDocumentBlock,
} from './sheetDocument';

// -------------------------------------------------------------
// Раскладка спецификации на листе A3 (420×297 мм).
// Модуль отдаёт миллиметровые координаты таблицы, рамки и
// основной надписи; SVG-слой переводит их в пиксели.
// -------------------------------------------------------------

export type SpecificationColumnId =
  | 'pos'
  | 'designation'
  | 'name'
  | 'type'
  | 'unit'
  | 'qty'
  | 'note';

export type SpecificationAlign = 'start' | 'middle' | 'end';

export interface SpecificationColumn {
  id: SpecificationColumnId;
  label: string[];
  width: number;
  align: SpecificationAlign;
}

export interface SpecificationCell {
  columnId: SpecificationColumnId;
  x: number;
  width: number;
  align: SpecificationAlign;
  text: string;
  sub?: string;
  fontSize: number;
  subFontSize: number;
  muted?: boolean;
}

export type SpecificationRowKind = 'section' | 'item' | 'empty' | 'total';

export interface SpecificationRow {
  kind: SpecificationRowKind;
  index: number | null;
  y: number;
  height: number;
  fill: string;
  label?: string;
  cells: SpecificationCell[];
}

export interface SpecificationHeaderBox {
  rect: SheetRect;
  title: string;
  lines: string[];
  tone: 'normal' | 'ok' | 'warning' | 'error';
}

export interface SpecificationTable {
  x: number;
  y: number;
  width: number;
  headerHeight: number;
  rowHeight: number;
  compact: boolean;
  bottom: number;
  columns: SpecificationColumn[];
  rows: SpecificationRow[];
  lines: SheetStampLine[];
}

export interface SpecificationSheetLayout {
  paper: { width: number; height: number };
  frame: SheetRect;
  title: string;
  subtitle: string;
  titleY: number;
  subtitleY: number;
  headerBoxes: SpecificationHeaderBox[];
  table: SpecificationTable;
  notesBlock: SheetRect;
  notesTitle: string;
  notesLines: string[];
  document: SheetDocumentBlock;
  status: SheetStatus;
  statusText: string;
}

export interface SpecificationSheetOptions {
  date?: string;
}

const MARGIN = 7.5;
const TABLE_TOP = 38.5;
const TABLE_BOTTOM = 233;
const HEADER_HEIGHT = 8.5;
const SECTION_HEIGHT = 5.5;
const TOTAL_HEIGHT = 7;
const EMPTY_HEIGHT = 10;
const MIN_ROW_HEIGHT = 2.6;
const MAX_ROW_HEIGHT = 7;
const COMPACT_ROW_HEIGHT = 4.8;

const COLUMNS: SpecificationColumn[] = [
  { id: 'pos', label: ['Поз.'], width: 10, align: 'middle' },
  { id: 'designation', label: ['Обозна-', 'чение'], width: 24, align: 'start' },
  {
    id: 'name',
    label: ['Наименование и техническая характеристика'],
    width: 170,
    align: 'start',
  },
  { id: 'type', label: ['Тип,', 'марка'], width: 60, align: 'start' },
  { id: 'unit', label: ['Ед.', 'изм.'], width: 12, align: 'middle' },
  { id: 'qty', label: ['Кол.'], width: 14, align: 'middle' },
  { id: 'note', label: ['Примечание'], width: 90, align: 'start' },
];

const COLUMN_OFFSETS = new Map<SpecificationColumnId, number>();
let columnCursor = 0;
for (const column of COLUMNS) {
  COLUMN_OFFSETS.set(column.id, columnCursor);
  columnCursor += column.width;
}

export const SPECIFICATION_COLUMNS = COLUMNS;
export const SPECIFICATION_TABLE_WIDTH = columnCursor;

function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

function quantityText(item: SpecificationItem): string {
  if (item.unit === 'м' && item.quantity === 0) return '—';
  return String(item.quantity);
}

function buildCells(
  tableX: number,
  compact: boolean,
  item: SpecificationItem | null,
  position: number | null,
  extra?: { name?: string; note?: string }
): SpecificationCell[] {
  return COLUMNS.map((column) => {
    const x = tableX + (COLUMN_OFFSETS.get(column.id) ?? 0);
    const base: SpecificationCell = {
      columnId: column.id,
      x,
      width: column.width,
      align: column.align,
      text: '',
      fontSize: 1.7,
      subFontSize: 1.3,
    };
    if (!item) {
      const text =
        column.id === 'name'
          ? extra?.name ?? ''
          : column.id === 'note'
            ? extra?.note ?? ''
            : '';
      return { ...base, text, fontSize: column.id === 'name' ? 1.8 : base.fontSize };
    }
    switch (column.id) {
      case 'pos':
        return { ...base, text: position ? String(position) : '', fontSize: 1.8 };
      case 'designation':
        return { ...base, text: item.designation, fontSize: 1.7 };
      case 'name':
        return {
          ...base,
          text: item.name,
          sub: compact ? undefined : item.detail,
          fontSize: compact ? 1.55 : 1.9,
          subFontSize: 1.25,
        };
      case 'type':
        return { ...base, text: item.type, fontSize: 1.6 };
      case 'unit':
        return { ...base, text: item.unit, fontSize: 1.6 };
      case 'qty':
        return {
          ...base,
          text: quantityText(item),
          fontSize: 1.9,
          muted: item.unit === 'м' && item.quantity === 0,
        };
      case 'note':
        return { ...base, text: item.note, fontSize: 1.35 };
      default:
        return base;
    }
  });
}

function buildHeaderBoxes(
  specification: PanelSpecification,
  status: SheetStatus,
  statusText: string
): SpecificationHeaderBox[] {
  const x = SHEET_FRAME.x + MARGIN;
  const y = 21.5;
  const width = 124;
  const height = 12.5;
  const gap = 4;
  const enclosure = specification.enclosure;
  const supplyCable = specification.items.find((item) => item.id === 'input-cable');
  return [
    {
      rect: { x, y, width, height },
      title: 'Щит',
      lines: [
        `Корпус ${enclosure.modules} мод. · ${enclosure.rails} реек`,
        `${
          enclosure.mounting === 'flush' ? 'встроенный' : 'накладной'
        } · свободно ${enclosure.free} (${num(enclosure.reservePercent, 0)} %)`,
      ],
      tone: 'normal',
    },
    {
      rect: { x: x + width + gap, y, width, height },
      title: 'Ввод',
      lines: [
        `QF1 ${specification.items.find((item) => item.id === 'input-breaker')?.detail ?? ''}`,
        supplyCable
          ? `${supplyCable.type} ${supplyCable.detail}`
          : 'вводной кабель не задан',
      ],
      tone: 'normal',
    },
    {
      rect: { x: x + (width + gap) * 2, y, width, height },
      title: 'Проверка по нормам',
      lines: [
        statusText,
        `${specification.items.length} поз. · кабель ${specification.totals.cableMeters} м`,
      ],
      tone:
        status === 'errors'
          ? 'error'
          : status === 'warnings'
            ? 'warning'
            : 'ok',
    },
  ];
}

function buildTable(
  specification: PanelSpecification,
  compact: boolean,
  rowHeight: number
): SpecificationTable {
  const tableX = SHEET_FRAME.x + MARGIN;
  const rows: SpecificationRow[] = [];
  let y = TABLE_TOP + HEADER_HEIGHT;
  let position = 0;

  const itemRows = specification.items;
  if (itemRows.length === 0) {
    rows.push({
      kind: 'empty',
      index: null,
      y,
      height: EMPTY_HEIGHT,
      fill: '#ffffff',
      cells: buildCells(tableX, false, null, null, {
        name: 'Спецификация пуста',
        note: 'Добавьте линии и аппараты в щите',
      }),
    });
    y += EMPTY_HEIGHT;
  } else {
    const sections: {
      id: SpecificationItem['section'];
      label: string;
    }[] = [
      { id: 'equipment', label: 'Оборудование' },
      { id: 'materials', label: 'Материалы' },
    ];
    for (const section of sections) {
      const sectionItems = itemRows.filter((item) => item.section === section.id);
      if (sectionItems.length === 0) continue;
      rows.push({
        kind: 'section',
        index: null,
        y,
        height: SECTION_HEIGHT,
        fill: '#e2e8f0',
        label: section.label,
        cells: [],
      });
      y += SECTION_HEIGHT;
      for (const item of sectionItems) {
        position += 1;
        rows.push({
          kind: 'item',
          index: position,
          y,
          height: rowHeight,
          fill: position % 2 === 0 ? '#f8fafc' : '#ffffff',
          cells: buildCells(tableX, compact, item, position),
        });
        y += rowHeight;
      }
    }
  }

  const totalCells = buildCells(tableX, false, null, null, {
    name: 'Итого',
    note: `${specification.totals.equipmentUnits} ед. оборудования · ${specification.totals.cableMeters} м кабеля`,
  }).map((cell) =>
    cell.columnId === 'name'
      ? { ...cell, fontSize: 1.9 }
      : cell.columnId === 'note'
        ? { ...cell, fontSize: 1.45 }
        : cell
  );
  rows.push({
    kind: 'total',
    index: null,
    y,
    height: TOTAL_HEIGHT,
    fill: '#e2e8f0',
    cells: totalCells,
  });
  y += TOTAL_HEIGHT;

  const lines: SheetStampLine[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, weight = 0.35) =>
    lines.push({ x1, y1, x2, y2, weight });
  const tableWidth = SPECIFICATION_TABLE_WIDTH;
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
  line(tableX, y, tableX + tableWidth, y, 0.5);
  let columnX = tableX;
  for (const column of COLUMNS.slice(0, -1)) {
    columnX += column.width;
    line(columnX, TABLE_TOP, columnX, y, 0.25);
  }

  return {
    x: tableX,
    y: TABLE_TOP,
    width: tableWidth,
    headerHeight: HEADER_HEIGHT,
    rowHeight,
    compact,
    bottom: y,
    columns: COLUMNS,
    rows,
    lines,
  };
}

export function buildSpecificationSheet(
  specification: PanelSpecification,
  options: SpecificationSheetOptions = {}
): SpecificationSheetLayout {
  const status: SheetStatus =
    specification.status === 'error'
      ? 'errors'
      : specification.status === 'warning'
        ? 'warnings'
        : 'ok';

  const lineCount = specification.items.length;
  const available =
    TABLE_BOTTOM -
    TABLE_TOP -
    HEADER_HEIGHT -
    TOTAL_HEIGHT -
    (lineCount > 0 ? SECTION_HEIGHT * 2 : 0);
  const rowHeight =
    lineCount > 0
      ? Math.min(
          MAX_ROW_HEIGHT,
          Math.max(MIN_ROW_HEIGHT, available / lineCount)
        )
      : MAX_ROW_HEIGHT;
  const compact = rowHeight < COMPACT_ROW_HEIGHT;

  const date =
    options.date ?? new Intl.DateTimeFormat('ru-RU').format(new Date());

  return {
    paper: { width: A3_WIDTH_MM, height: A3_HEIGHT_MM },
    frame: { ...SHEET_FRAME },
    title: specification.title,
    subtitle: `${specification.panelName} · корпус ${specification.enclosure.modules} модулей · ${specification.statusText}`,
    titleY: 13.2,
    subtitleY: 18.4,
    headerBoxes: buildHeaderBoxes(
      specification,
      status,
      specification.statusText
    ),
    table: buildTable(specification, compact, rowHeight),
    notesBlock: { ...SHEET_NOTES_BLOCK },
    notesTitle: 'Примечания и нормативные ссылки',
    notesLines: specification.notes,
    document: buildSheetDocumentBlock({
      title: 'Спецификация',
      subtitle: 'оборудования и материалов',
      objectTitle: specification.panelName,
      designation: 'ЭС-03',
      basis: 'ПУЭ-7 · СП 256.1325800.2016 · ГОСТ IEC 60898-1',
      date,
    }),
    status,
    statusText: specification.statusText,
  };
}

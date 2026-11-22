import {
  A3_HEIGHT_MM,
  A3_WIDTH_MM,
  SHEET_FRAME,
  SHEET_NOTES_BLOCK,
  type SheetRect,
  type SheetStampLine,
} from './sheetLayout';
import {
  buildSheetDocumentBlock,
  type SheetDocumentBlock,
} from './sheetDocument';
import type { CableJournal } from './cableJournal';

// -------------------------------------------------------------
// Раскладка листа ЭС-07 «Кабельный журнал»: таблица групп,
// итоговая строка, примечания и основная надпись.
// -------------------------------------------------------------

export interface JournalColumn {
  id: string;
  label: string;
  width: number;
  align: 'start' | 'middle' | 'end';
}

export interface JournalCell {
  text: string;
  sub?: string;
}

export interface JournalRowLayout {
  y: number;
  height: number;
  cells: JournalCell[];
  fill: string;
}

export interface CableJournalSheet {
  title: string;
  subtitle: string;
  paper: { width: number; height: number };
  frame: SheetRect;
  columns: JournalColumn[];
  table: {
    x: number;
    y: number;
    width: number;
    headerHeight: number;
    rows: JournalRowLayout[];
    lines: SheetStampLine[];
    bottom: number;
  };
  totalsLine: { text: string; x: number; y: number };
  notesBlock: SheetRect;
  notesTitle: string;
  notesLines: string[];
  document: SheetDocumentBlock;
}

const TABLE_X = 24;
const TABLE_TOP = 36;
const TABLE_WIDTH = 372;
const HEADER_HEIGHT = 12;
const TABLE_BOTTOM_LIMIT = 231;

const COLUMNS: JournalColumn[] = [
  { id: 'no', label: '№', width: 12, align: 'middle' },
  { id: 'line', label: 'Линия', width: 96, align: 'start' },
  { id: 'start', label: 'Начало', width: 38, align: 'start' },
  { id: 'end', label: 'Конец', width: 96, align: 'start' },
  { id: 'cable', label: 'Марка и сечение кабеля', width: 78, align: 'start' },
  { id: 'routing', label: 'Прокладка', width: 32, align: 'middle' },
  { id: 'length', label: 'Длина', width: 20, align: 'end' },
];

function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function buildCableJournalSheet(
  journal: CableJournal,
  options: { date?: string; sheetNumber?: string; sheetTotal?: string } = {}
): CableJournalSheet {
  const rowCount = journal.rows.length;
  const available = TABLE_BOTTOM_LIMIT - (TABLE_TOP + HEADER_HEIGHT) - 9;
  const rowHeight =
    rowCount > 0
      ? Math.max(5.4, Math.min(10.5, available / rowCount))
      : 10.5;

  const rows: JournalRowLayout[] = journal.rows.map((row, index) => ({
    y: TABLE_TOP + HEADER_HEIGHT + index * rowHeight,
    height: rowHeight,
    fill: index % 2 === 1 ? '#f8fafc' : '#ffffff',
    cells: [
      { text: String(row.code) },
      { text: `${row.groupLabel} · ${row.lineName}`, sub: row.purposeLabel },
      { text: row.start },
      { text: row.end },
      { text: row.cable },
      { text: row.routingLabel },
      { text: row.lengthLabel },
    ],
  }));

  const bottom = TABLE_TOP + HEADER_HEIGHT + rowCount * rowHeight;
  const lines: SheetStampLine[] = [
    {
      x1: TABLE_X,
      y1: TABLE_TOP + HEADER_HEIGHT,
      x2: TABLE_X + TABLE_WIDTH,
      y2: TABLE_TOP + HEADER_HEIGHT,
      weight: 0.5,
    },
  ];
  for (let index = 1; index < rowCount; index += 1) {
    const y = TABLE_TOP + HEADER_HEIGHT + index * rowHeight;
    lines.push({ x1: TABLE_X, y1: y, x2: TABLE_X + TABLE_WIDTH, y2: y, weight: 0.2 });
  }
  let columnX = TABLE_X;
  for (const column of COLUMNS.slice(0, -1)) {
    columnX += column.width;
    lines.push({
      x1: columnX,
      y1: TABLE_TOP,
      x2: columnX,
      y2: bottom,
      weight: 0.2,
    });
  }

  const totalsText = [
    `Всего групповых линий: ${journal.totals.lines}`,
    `кабель по трассам: ${num(journal.totals.cableMeters, 1)} м`,
    `по потолку: ${journal.totals.ceilingCount}`,
    `в полу: ${journal.totals.floorCount}`,
    journal.totals.missingCount > 0
      ? `без длины: ${journal.totals.missingCount}`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  const cableBrand = journal.cableBrand || 'ВВГнг(А)-LS';
  const warningLine =
    journal.warnings.length > 0
      ? `Проверить трассы: ${journal.warnings
          .slice(0, 2)
          .map((warning) => warning.replace(/[.\s]+$/, ''))
          .join('; ')}.`
      : 'Расхождений по трассам нет.';

  const date = options.date ?? new Intl.DateTimeFormat('ru-RU').format(new Date());

  return {
    title: 'Кабельный журнал',
    subtitle: `${journal.panelName} · ${journal.totals.lines} ${plural(
      journal.totals.lines,
      'группа',
      'группы',
      'групп'
    )} · кабель ${num(journal.totals.cableMeters, 1)} м`,
    paper: { width: A3_WIDTH_MM, height: A3_HEIGHT_MM },
    frame: { ...SHEET_FRAME },
    columns: COLUMNS,
    table: {
      x: TABLE_X,
      y: TABLE_TOP,
      width: TABLE_WIDTH,
      headerHeight: HEADER_HEIGHT,
      rows,
      lines,
      bottom,
    },
    totalsLine: {
      text: totalsText,
      x: TABLE_X,
      y: bottom + 5.6,
    },
    notesBlock: { ...SHEET_NOTES_BLOCK },
    notesTitle: 'Примечания',
    notesLines: [
      'Длины кабелей — по фактическим трассам с запасом 1,5 м на подключение линии.',
      `Способ прокладки: потолок — гофра под штукатуркой; пол — ПНД-труба в стяжке.`,
      warningLine,
      `Марка кабеля — ${cableBrand}, не распространяющий горение, с низким дымовыделением.`,
      'Перед монтажом уточнить фактические длины трасс по месту.',
      'Защита групп — автоматы и УЗО по расчёту нагрузок (лист ЭС-02).',
    ],
    document: buildSheetDocumentBlock({
      title: 'Кабельный журнал',
      subtitle: 'ведомость кабелей',
      objectTitle: journal.panelName,
      designation: 'ЭС-07',
      basis: 'ГОСТ 21.613-2014 · ПУЭ-7 гл. 2.1',
      date,
      sheet: options.sheetNumber ?? '8',
      sheetTotal: options.sheetTotal ?? '8',
    }),
  };
}

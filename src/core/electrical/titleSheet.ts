import type { PlanSheetKind, RoomZone } from '../../types';
import { calculateNetAreaM2 } from '../geometry/math';
import type { PanelSchematic } from './schematic';
import type { PanelSpecification } from './specification';
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

// -------------------------------------------------------------
// Титульный лист комплекта (ЭС-00): основные параметры проекта,
// ведомость рабочих чертежей, ведомость ссылочных документов и
// короткое пояснение. Модуль не рисует — отдаёт миллиметровые
// координаты таблиц для SVG-слоя.
// -------------------------------------------------------------

export interface TitleSheetSource {
  schematic: PanelSchematic;
  specification: PanelSpecification;
  rooms: RoomZone[];
  deviceCount: number;
  // Число монтажных подрозетников; не задано — строка не выводится.
  frameCount?: number;
  // Число листов каждого плана; не задано — по одному (старые проекты).
  planSheetCounts?: Record<PlanSheetKind, number>;
}

export interface TitleSheetOptions {
  date?: string;
}

export type TitleSheetTableId = 'params' | 'sheets' | 'refs';

export type TitleSheetAlign = 'start' | 'middle' | 'end';

export interface TitleSheetColumn {
  id: string;
  label: string;
  width: number;
  align: TitleSheetAlign;
}

export interface TitleSheetRow {
  cells: string[];
}

export interface TitleSheetTable {
  id: TitleSheetTableId;
  title: string;
  rect: SheetRect;
  columns: TitleSheetColumn[];
  headerHeight: number;
  rowHeight: number;
  rows: TitleSheetRow[];
  fontSize: number;
  lines: SheetStampLine[];
}

export interface TitleSheetHeader {
  title: string;
  subtitle: string;
  objectLine: string;
  introLines: string[];
  rule: SheetStampLine;
}

export interface TitleSheetLayout {
  paper: { width: number; height: number };
  frame: SheetRect;
  header: TitleSheetHeader;
  params: TitleSheetTable;
  sheets: TitleSheetTable;
  refs: TitleSheetTable;
  notesBlock: SheetRect;
  notesTitle: string;
  notesLines: string[];
  document: SheetDocumentBlock;
}

const LEFT_X = SHEET_FRAME.x + 7.5; // 27,5 мм
const COLUMN_WIDTH = 186;
const COLUMN_GAP = 8;
const RIGHT_X = LEFT_X + COLUMN_WIDTH + COLUMN_GAP; // 221,5 мм
const PARAMS_TOP = 84;
const SHEETS_TOP = 84;
const REFS_TOP = 172;
const PARAMS_ROW = 8.8;
const SHEETS_ROW = 8.6;
const REFS_ROW = 7.6;

const MOUNTING_LABEL: Record<'flush' | 'surface', string> = {
  flush: 'встроенный',
  surface: 'накладной',
};

function num(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

function kw(value: number): string {
  return `${num(value / 1000, 2)} кВт`;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function buildTable(
  id: TitleSheetTableId,
  title: string,
  x: number,
  y: number,
  width: number,
  columns: TitleSheetColumn[],
  headerHeight: number,
  rowHeight: number,
  fontSize: number,
  rows: TitleSheetRow[]
): TitleSheetTable {
  const rect: SheetRect = {
    x,
    y,
    width,
    height: headerHeight + rowHeight * rows.length,
  };
  const lines: SheetStampLine[] = [];
  lines.push({
    x1: x,
    y1: y + headerHeight,
    x2: x + width,
    y2: y + headerHeight,
    weight: 0.45,
  });
  for (let index = 1; index < rows.length; index += 1) {
    const lineY = y + headerHeight + rowHeight * index;
    lines.push({ x1: x, y1: lineY, x2: x + width, y2: lineY, weight: 0.25 });
  }
  let columnX = x;
  for (const column of columns.slice(0, -1)) {
    columnX += column.width;
    lines.push({
      x1: columnX,
      y1: y,
      x2: columnX,
      y2: y + rect.height,
      weight: 0.25,
    });
  }
  return {
    id,
    title,
    rect,
    columns,
    headerHeight,
    rowHeight,
    rows,
    fontSize,
    lines,
  };
}

function areaLabel(rooms: RoomZone[]): string {
  if (rooms.length === 0) return 'не задана';
  const area = rooms.reduce(
    (sum, room) => sum + calculateNetAreaM2(room.vertices, room.holes ?? []),
    0
  );
  return `${num(area, 1)} м²`;
}

function buildParams(source: TitleSheetSource): TitleSheetTable {
  const { supply } = source.schematic;
  const { enclosure, totals } = source.specification;
  const rows: TitleSheetRow[] = [
    {
      cells: ['Площадь помещений', areaLabel(source.rooms)],
    },
    {
      cells: [
        'Помещений',
        `${source.rooms.length} ${plural(
          source.rooms.length,
          'помещение',
          'помещения',
          'помещений'
        )}`,
      ],
    },
    { cells: ['Приборов', String(source.deviceCount)] },
    { cells: ['Групповых линий', String(source.schematic.groups.length)] },
    ...(source.frameCount === undefined
      ? []
      : [{ cells: ['Подрозетников', String(source.frameCount)] }]),
    {
      cells: [
        'Ввод',
        `${supply.voltageLabel} · ${supply.system} · ${supply.reliabilityCategory} кат.`,
      ],
    },
    {
      cells: [
        'Мощность: установленная / расчётная',
        `${kw(supply.installedPowerW)} / ${kw(supply.designPowerW)}`,
      ],
    },
    { cells: ['Выделенная мощность', kw(supply.allocatedPowerW)] },
    {
      cells: [
        'Вводной автомат',
        `QF1 ${supply.inputBreaker.ratingA} А ${supply.inputBreaker.poles}P ${supply.inputBreaker.curve}`,
      ],
    },
    {
      cells: [
        'Вводной кабель',
        `${supply.cableBrand} ${supply.inputCable.cores}×${num(
          supply.inputCable.sectionMm2,
          Number.isInteger(supply.inputCable.sectionMm2) ? 0 : 1
        )} мм²`,
      ],
    },
    {
      cells: [
        'Противопожарное УЗО',
        supply.mainRcd
          ? `${supply.mainRcd.sensitivityMa} мА · тип ${supply.mainRcd.type}${
              supply.mainRcd.selective ? ' S' : ''
            }`
          : 'не предусмотрено',
      ],
    },
    {
      cells: [
        'Щит',
        `${enclosure.modules} мод. · ${enclosure.rails} ${plural(
          enclosure.rails,
          'рейка',
          'рейки',
          'реек'
        )} · ${MOUNTING_LABEL[enclosure.mounting]}`,
      ],
    },
    { cells: ['Кабель по трассам', `${totals.cableMeters} м`] },
  ];

  return buildTable(
    'params',
    'Основные параметры',
    LEFT_X,
    PARAMS_TOP,
    COLUMN_WIDTH,
    [
      { id: 'label', label: 'Параметр', width: 102, align: 'start' },
      { id: 'value', label: 'Значение', width: 84, align: 'start' },
    ],
    9,
    PARAMS_ROW,
    1.95,
    rows
  );
}

function sheetRange(first: number, count: number): string {
  return count > 1 ? `${first}–${first + count - 1}` : String(first);
}

function sheetNameWithCount(name: string, count: number): string {
  return count > 1
    ? `${name} — ${count} ${plural(count, 'лист', 'листа', 'листов')}`
    : name;
}

function buildSheets(source: TitleSheetSource): TitleSheetTable {
  const panelName = source.schematic.panelName;
  const powerCount = Math.max(1, source.planSheetCounts?.power ?? 1);
  const lightingCount = Math.max(1, source.planSheetCounts?.lighting ?? 1);
  const powerFirst = 6;
  const lightingFirst = powerFirst + powerCount;
  const journalNumber = lightingFirst + lightingCount;
  const rows: TitleSheetRow[] = [
    { cells: ['1', 'ЭС-00', 'Титульный лист, ведомость документов'] },
    {
      cells: [
        '2',
        'ЭС-01',
        `Схема электрическая принципиальная щита ${panelName}`,
      ],
    },
    { cells: ['3', 'ЭС-02', 'Расчёт нагрузок и проверка по нормам'] },
    { cells: ['4', 'ЭС-03', 'Спецификация оборудования и материалов'] },
    { cells: ['5', 'ЭС-04', 'Компоновка щита на DIN-рейках'] },
    {
      cells: [
        sheetRange(powerFirst, powerCount),
        'ЭС-05',
        sheetNameWithCount(
          'План розеточных сетей с высотами и привязками',
          powerCount
        ),
      ],
    },
    {
      cells: [
        sheetRange(lightingFirst, lightingCount),
        'ЭС-06',
        sheetNameWithCount(
          'План осветительных сетей с высотами и привязками',
          lightingCount
        ),
      ],
    },
    {
      cells: [
        String(journalNumber),
        'ЭС-07',
        'Кабельный журнал: группы, кабели и длины',
      ],
    },
  ];

  return buildTable(
    'sheets',
    'Ведомость рабочих чертежей',
    RIGHT_X,
    SHEETS_TOP,
    COLUMN_WIDTH,
    [
      { id: 'no', label: '№', width: 13, align: 'middle' },
      { id: 'code', label: 'Обозначение', width: 27, align: 'middle' },
      { id: 'name', label: 'Наименование', width: 146, align: 'start' },
    ],
    9,
    SHEETS_ROW,
    2.2,
    rows
  );
}

function buildRefs(): TitleSheetTable {
  const rows: TitleSheetRow[] = [
    { cells: ['ПУЭ-7', 'Правила устройства электроустановок, 7-е издание'] },
    {
      cells: [
        'СП 256.1325800.2016',
        'Электроустановки жилых и общественных зданий',
      ],
    },
    {
      cells: [
        'СП 31-110-2003',
        'Проектирование и монтаж электроустановок зданий',
      ],
    },
    { cells: ['ГОСТ 2.702-2011', 'Правила выполнения электрических схем'] },
    { cells: ['ГОСТ 2.104-2006', 'Основные надписи'] },
    {
      cells: [
        'ГОСТ 21.613-2014',
        'Рабочая документация силового электрооборудования',
      ],
    },
  ];

  return buildTable(
    'refs',
    'Ведомость ссылочных документов',
    RIGHT_X,
    REFS_TOP,
    COLUMN_WIDTH,
    [
      { id: 'code', label: 'Обозначение', width: 42, align: 'start' },
      { id: 'name', label: 'Наименование', width: 144, align: 'start' },
    ],
    8,
    REFS_ROW,
    1.85,
    rows
  );
}

export function buildTitleSheet(
  source: TitleSheetSource,
  options: TitleSheetOptions = {}
): TitleSheetLayout {
  const { schematic } = source;
  const powerCount = Math.max(1, source.planSheetCounts?.power ?? 1);
  const lightingCount = Math.max(1, source.planSheetCounts?.lighting ?? 1);
  const sheetTotal = 6 + powerCount + lightingCount;
  const roomsCount = source.rooms.length;
  const objectLine = `Объект: квартира · ${areaLabel(
    source.rooms
  )} · ${roomsCount} ${plural(roomsCount, 'помещение', 'помещения', 'помещений')} · щит ${schematic.panelName}`;

  const date =
    options.date ?? new Intl.DateTimeFormat('ru-RU').format(new Date());

  return {
    paper: { width: A3_WIDTH_MM, height: A3_HEIGHT_MM },
    frame: { ...SHEET_FRAME },
    header: {
      title: 'ПРОЕКТ ЭЛЕКТРОСНАБЖЕНИЯ КВАРТИРЫ',
      subtitle: 'Рабочая документация · Стадия Р · Electrica',
      objectLine,
      introLines: [
        'Комплект содержит планы сетей, схему щита, расчёт, спецификацию, компоновку и кабельный журнал.',
        'Решения приняты по ПУЭ-7 и СП 256.1325800.2016; проверки выполняются автоматически.',
        'Комплект не заменяет согласование с сетевой организацией и управляющей компанией.',
      ],
      rule: { x1: LEFT_X, y1: 54.5, x2: RIGHT_X + COLUMN_WIDTH, y2: 54.5, weight: 0.35 },
    },
    params: buildParams(source),
    sheets: buildSheets(source),
    refs: buildRefs(),
    notesBlock: { ...SHEET_NOTES_BLOCK },
    notesTitle: 'Как читать комплект',
    notesLines: [
      'ЭС-01 — принципиальная схема для сборки щита.',
      'ЭС-02 — токи, потери напряжения и выбор аппаратов.',
      'ЭС-03 — спецификация для закупки оборудования.',
      'ЭС-04 — порядок аппаратов на DIN-рейках.',
      'ЭС-05, ЭС-06 — планы сетей; ЭС-07 — кабельный журнал.',
    ],
    document: buildSheetDocumentBlock({
      title: 'Титульный лист',
      subtitle: 'ведомость документов',
      objectTitle: schematic.panelName,
      designation: 'ЭС-00',
      basis: 'ПУЭ-7 · СП 256.1325800.2016 · ГОСТ 21.613-2014',
      date,
      sheet: '1',
      sheetTotal: String(sheetTotal),
    }),
  };
}

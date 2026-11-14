import {
  SHEET_TITLE_BLOCK,
  type SheetRect,
  type SheetStampLine,
} from './sheetLayout';

// -------------------------------------------------------------
// Основная надпись для документов щита (ЭС-03, ЭС-04).
// Упрощённая форма: обозначение, объект, название документа,
// роли, организация и нормативная база. Модуль не рисует —
// отдаёт миллиметровые координаты для SVG-слоя.
// -------------------------------------------------------------

export type SheetDocumentRoleId =
  | 'developer'
  | 'checker'
  | 'techControl'
  | 'normControl'
  | 'approver';

export interface SheetDocumentRole {
  id: SheetDocumentRoleId;
  label: string;
  labelRect: SheetRect;
  nameRect: SheetRect;
  signatureRect: SheetRect;
  dateRect: SheetRect;
  date: string;
}

export interface SheetDocumentBlock {
  rect: SheetRect;
  title: string;
  subtitle: string;
  objectTitle: string;
  designation: string;
  stage: string;
  sheet: string;
  sheetTotal: string;
  organization: string;
  date: string;
  basis: string;
  roles: SheetDocumentRole[];
  grid: SheetStampLine[];
}

export interface SheetDocumentOptions {
  title: string;
  subtitle?: string;
  objectTitle: string;
  designation: string;
  basis: string;
  date: string;
  stage?: string;
  sheet?: string;
  sheetTotal?: string;
  organization?: string;
}

export function buildSheetDocumentBlock(
  options: SheetDocumentOptions
): SheetDocumentBlock {
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
    id: SheetDocumentRoleId,
    label: string,
    rowY: number,
    roleDate = ''
  ): SheetDocumentRole => ({
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
    title: options.title,
    subtitle: options.subtitle ?? '',
    objectTitle: options.objectTitle,
    designation: options.designation,
    stage: options.stage ?? 'Стадия Р',
    sheet: options.sheet ?? '1',
    sheetTotal: options.sheetTotal ?? '1',
    organization: options.organization ?? 'Electrica',
    date: options.date,
    basis: options.basis,
    roles: [
      role('developer', 'Разраб.', y + 15, options.date),
      role('checker', 'Пров.', y + 20),
      role('techControl', 'Т. контр.', y + 25),
      role('normControl', 'Н. контр.', y + 30),
      role('approver', 'Утв.', y + 35),
    ],
    grid,
  };
}

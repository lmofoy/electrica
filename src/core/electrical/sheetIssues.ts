// -------------------------------------------------------------
// Единый список «Замечания и ошибки» для экрана и печатных листов.
// Экран (панель проверки) и каждый лист берут замечания из одного
// и того же источника, чтобы формулировки и нумерация совпадали.
// Модуль не рисует: он только упорядочивает, нумерует и разбивает
// записи на страницы, поэтому его можно проверить тестами.
// -------------------------------------------------------------

import type { NormativeSeverity } from './panelValidation';

// Источник записи: сюда подходят PanelCheckItem и NormativeFinding.
export interface SheetIssueSource {
  id: string;
  severity: NormativeSeverity;
  message: string;
  reference?: string;
  lineId?: string;
}

// Готовая запись с общим порядковым номером (1..N).
export interface SheetIssue {
  number: number;
  id: string;
  severity: NormativeSeverity;
  message: string;
  reference?: string;
  lineId?: string;
}

const SEVERITY_ORDER: Record<NormativeSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export const ISSUE_SEVERITY_LABEL: Record<NormativeSeverity, string> = {
  error: 'Ошибка',
  warning: 'Замечание',
  info: 'Инфо',
};

export interface IssueSummary {
  errors: number;
  warnings: number;
  status: 'ok' | 'warnings' | 'errors';
  text: string;
}

// Сводка по общему списку для статусной рамки листа.
// Тексты те же, что на экране: «Ошибок: N» / «Замечаний: N» / «Нормы соблюдены».
export function summarizeIssues(
  issues: SheetIssue[],
  options: { emptyLabel?: string } = {}
): IssueSummary {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const status = errors > 0 ? 'errors' : warnings > 0 ? 'warnings' : 'ok';
  const text =
    errors > 0
      ? `Ошибок: ${errors}`
      : warnings > 0
        ? `Замечаний: ${warnings}`
        : options.emptyLabel ?? 'Нормы соблюдены';
  return { errors, warnings, status, text };
}

// Ошибки — первыми, затем замечания и информационные подсказки.
// Нумерация сквозная: один и тот же номер видят экран, блок на листе
// и номерной маркер на схеме. По умолчанию подсказки (info) на лист
// не попадают: печатаем только ошибки и замечания.
export function buildSheetIssues(
  source: SheetIssueSource[],
  options: { includeInfo?: boolean } = {}
): SheetIssue[] {
  const includeInfo = options.includeInfo ?? false;
  return source
    .filter((item) => includeInfo || item.severity !== 'info')
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const bySeverity =
        SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity];
      return bySeverity !== 0 ? bySeverity : a.index - b.index;
    })
    .map(({ item }, index) => ({
      number: index + 1,
      id: item.id,
      severity: item.severity,
      message: item.message,
      reference: item.reference,
      lineId: item.lineId,
    }));
}

// Разбивает текст на строки не длиннее maxChars по границам слов.
// Используется и для тестов, и для отрисовки блока на листе.
export function wrapIssueText(text: string, maxChars: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= limit) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

// Сколько печатных строк займёт одна запись: сообщение (+ возможно
// длинное слово разбивается) и строка со ссылкой на норму.
export function issueLineCount(issue: SheetIssue, maxChars: number): number {
  const messageLines = wrapIssueText(issue.message, maxChars).length;
  return messageLines + (issue.reference ? 1 : 0);
}

// Разбивает список на страницы, сохраняя каждую запись целиком.
// Запись, которая сама больше страницы, занимает отдельную страницу.
export function paginateIssues(
  issues: SheetIssue[],
  maxChars: number,
  maxLines: number
): SheetIssue[][] {
  const capacity = Math.max(1, Math.floor(maxLines));
  const pages: SheetIssue[][] = [];
  let current: SheetIssue[] = [];
  let used = 0;
  for (const issue of issues) {
    const lines = issueLineCount(issue, maxChars);
    if (current.length > 0 && used + lines > capacity) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(issue);
    used += lines;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

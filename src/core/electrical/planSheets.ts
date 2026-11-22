import type {
  CircuitLine,
  ElectricalDevice,
  ElectricalPanel,
  PlanSheetKind,
  PlanSheetSpec,
} from '../../types';

// -------------------------------------------------------------
// Листы печатных планов: пользователь раскладывает группы по листам,
// чтобы на одном листе не смешивать всё сразу. Старый проект без
// planSheets показывается как один лист со всеми группами.
// -------------------------------------------------------------

export const PLAN_SHEET_KINDS: PlanSheetKind[] = ['power', 'lighting'];

export const PLAN_SHEET_KIND_LABELS: Record<PlanSheetKind, string> = {
  power: 'план розеток',
  lighting: 'план света',
};

const DEFAULT_SHEET_NAME = 'Все группы';
const NAME_MAX_CHARS = 40;

export function planSheetKindForLine(line: CircuitLine): PlanSheetKind {
  return line.purpose === 'lighting' ? 'lighting' : 'power';
}

export function linesForPlanKind(
  panel: ElectricalPanel | null,
  kind: PlanSheetKind
): CircuitLine[] {
  return (panel?.lines ?? []).filter((line) => planSheetKindForLine(line) === kind);
}

function lineCode(line: CircuitLine, index: number): number {
  return Number.isInteger(line.code) && (line.code as number) > 0
    ? (line.code as number)
    : index + 2;
}

export function autoPlanSheetName(
  panel: ElectricalPanel | null,
  lineIds: string[]
): string {
  if (!panel) return DEFAULT_SHEET_NAME;
  const codes: number[] = [];
  panel.lines.forEach((line, index) => {
    if (lineIds.includes(line.id)) codes.push(lineCode(line, index));
  });
  if (codes.length === 0) return DEFAULT_SHEET_NAME;
  return `Гр. ${codes.join(', ')}`;
}

export interface PlanSheetEntry {
  id: string;
  kind: PlanSheetKind;
  name: string;
  lineIds: string[];
  stored: boolean;
  number: number; // № листа в комплекте
}

export interface PlanSheetNumbering {
  sheets: PlanSheetEntry[];
  total: number; // всего листов в комплекте
  journalNumber: number; // номер кабельного журнала
  counts: Record<PlanSheetKind, number>;
}

// Эффективные листы: сохранённые пользователем, а для вида без листов —
// один лист со всеми группами. Нумерация: 1 — титул, 2–5 — ЭС-01…ЭС-04,
// затем планы, последним — кабельный журнал.
export function buildPlanSheetNumbering(
  panel: ElectricalPanel | null
): PlanSheetNumbering {
  const sheets: PlanSheetEntry[] = [];
  for (const kind of PLAN_SHEET_KINDS) {
    const kindLines = linesForPlanKind(panel, kind);
    const allowed = new Set(kindLines.map((line) => line.id));
    const stored = (panel?.planSheets ?? []).filter((sheet) => sheet.kind === kind);
    const valid = stored
      .map((sheet) => ({
        ...sheet,
        lineIds: sheet.lineIds.filter((id) => allowed.has(id)),
      }))
      .filter((sheet) => sheet.lineIds.length > 0);

    if (valid.length > 0) {
      for (const sheet of valid) {
        sheets.push({
          id: sheet.id,
          kind: sheet.kind,
          name: sheet.name.trim() || autoPlanSheetName(panel, sheet.lineIds),
          lineIds: [...sheet.lineIds],
          stored: true,
          number: 0,
        });
      }
      continue;
    }

    sheets.push({
      id: `plan-sheet-default-${kind}`,
      kind,
      name: DEFAULT_SHEET_NAME,
      lineIds: kindLines.map((line) => line.id),
      stored: false,
      number: 0,
    });
  }

  const counts: Record<PlanSheetKind, number> = { power: 0, lighting: 0 };
  sheets.forEach((sheet, index) => {
    sheet.number = 6 + index;
    counts[sheet.kind] += 1;
  });

  return {
    sheets,
    total: 6 + sheets.length,
    journalNumber: 6 + sheets.length,
    counts,
  };
}

// Санитайзер входящего листа: лист другого вида, несуществующие группы,
// пустой набор и слишком длинное имя отбрасываются/обрезаются.
export function sanitizePlanSheet(
  value: unknown,
  panel: ElectricalPanel
): PlanSheetSpec | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== 'power' && raw.kind !== 'lighting') return null;
  const kind: PlanSheetKind = raw.kind;
  const lineById = new Map(panel.lines.map((line) => [line.id, line]));
  const lineIds: string[] = [];
  if (Array.isArray(raw.lineIds)) {
    for (const lineId of raw.lineIds) {
      if (typeof lineId !== 'string' || lineIds.includes(lineId)) continue;
      const line = lineById.get(lineId);
      if (!line || planSheetKindForLine(line) !== kind) continue;
      lineIds.push(lineId);
    }
  }
  if (lineIds.length === 0) return null;
  const id =
    typeof raw.id === 'string' && raw.id.trim().length > 0
      ? raw.id.trim()
      : `plan-sheet-${kind}-${Date.now()}`;
  const name =
    typeof raw.name === 'string' ? raw.name.trim().slice(0, NAME_MAX_CHARS) : '';
  return { id, kind, name, lineIds };
}

export function sanitizePlanSheets(
  value: unknown,
  panel: ElectricalPanel
): PlanSheetSpec[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const result: PlanSheetSpec[] = [];
  for (const item of value) {
    const sheet = sanitizePlanSheet(item, panel);
    if (!sheet || seen.has(sheet.id)) continue;
    seen.add(sheet.id);
    result.push(sheet);
  }
  return result.length > 0 ? result : undefined;
}

// После удаления линии лист не должен хранить мёртвую ссылку; лист без
// групп исчезает, а если листов не осталось — вернётся лист «Все группы».
export function prunePlanSheets(
  panel: ElectricalPanel,
  lines: CircuitLine[]
): PlanSheetSpec[] | undefined {
  if (!panel.planSheets) return undefined;
  const next = { ...panel, lines };
  const pruned: PlanSheetSpec[] = [];
  for (const sheet of panel.planSheets) {
    const cleaned = sanitizePlanSheet(sheet, next);
    if (cleaned) pruned.push(cleaned);
  }
  return pruned.length > 0 ? pruned : undefined;
}

export interface PlanSheetCheck {
  id: string;
  severity: 'warning' | 'info';
  message: string;
}

// Предупреждения до печати: группа не попала ни на один лист, лист без
// приборов, группа повторяется на нескольких листах, приборы вне линий.
export function buildPlanSheetChecks(
  panel: ElectricalPanel | null,
  devices: ElectricalDevice[]
): PlanSheetCheck[] {
  if (!panel) return [];
  const checks: PlanSheetCheck[] = [];
  const stored = panel.planSheets ?? [];
  const numbering = buildPlanSheetNumbering(panel);

  for (const kind of PLAN_SHEET_KINDS) {
    const kindSheets = stored.filter((sheet) => sheet.kind === kind);
    if (kindSheets.length === 0) continue; // один лист со всеми группами
    const covered = new Set(kindSheets.flatMap((sheet) => sheet.lineIds));
    for (const line of linesForPlanKind(panel, kind)) {
      if (covered.has(line.id)) continue;
      checks.push({
        id: `plan-sheet-missing-${line.id}`,
        severity: 'warning',
        message: `«${line.name}» не попала ни на один лист (${PLAN_SHEET_KIND_LABELS[kind]}). Добавьте её на лист в «Документах».`,
      });
    }
  }

  const lineOwnerCount = new Map<string, number>();
  for (const sheet of stored) {
    for (const lineId of sheet.lineIds) {
      lineOwnerCount.set(lineId, (lineOwnerCount.get(lineId) ?? 0) + 1);
    }
  }
  for (const [lineId, count] of lineOwnerCount) {
    if (count < 2) continue;
    const line = panel.lines.find((candidate) => candidate.id === lineId);
    if (!line) continue;
    const sheetNames = stored
      .filter((sheet) => sheet.lineIds.includes(lineId))
      .map((sheet) => {
        const entry = numbering.sheets.find((candidate) => candidate.id === sheet.id);
        return `«${entry?.name ?? sheet.name}»`;
      })
      .join(', ');
    checks.push({
      id: `plan-sheet-duplicate-${lineId}`,
      severity: 'info',
      message: `«${line.name}» выбрана на ${count} листах: ${sheetNames}. Допустимо, но проверьте, нет ли лишнего листа.`,
    });
  }

  const lineById = new Map(panel.lines.map((line) => [line.id, line]));
  for (const sheet of stored) {
    const entry = numbering.sheets.find((candidate) => candidate.id === sheet.id);
    const hasDevices = sheet.lineIds.some(
      (lineId) => (lineById.get(lineId)?.deviceIds.length ?? 0) > 0
    );
    if (hasDevices) continue;
    checks.push({
      id: `plan-sheet-empty-${sheet.id}`,
      severity: 'warning',
      message: `Лист «${entry?.name ?? sheet.name}» без приборов — это пустой чертёж. Добавьте приборы в группы или удалите лист.`,
    });
  }

  const assigned = new Set(panel.lines.flatMap((line) => line.deviceIds));
  const outside = devices.filter((device) => !assigned.has(device.id));
  if (outside.length > 0) {
    const sample = outside
      .slice(0, 3)
      .map((device) => device.name)
      .join(', ');
    checks.push({
      id: 'plan-sheet-unassigned',
      severity: 'warning',
      message: `Приборов вне линий: ${outside.length} (${sample}${
        outside.length > 3 ? '…' : ''
      }). На планы листов они не попадут — добавьте их в группы.`,
    });
  }

  return checks;
}

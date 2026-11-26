import React, { useMemo, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { usePanelDiagnostics } from '../panel/usePanelDiagnostics';
import { PanelTitleSheet } from '../panel/PanelTitleSheet';
import { PanelPlanSheet } from '../panel/PanelPlanSheet';
import { PanelSheet } from '../panel/PanelSheet';
import { PanelCalculation } from '../panel/PanelCalculation';
import { PanelSpecification } from '../panel/PanelSpecification';
import { PanelDinSheet } from '../panel/PanelDinSheet';
import { PanelCableJournal } from '../panel/PanelCableJournal';
import { buildPlanSheet, type PlanSheetLayout } from '../../core/electrical/planSheet';
import {
  buildCableJournal,
} from '../../core/electrical/cableJournal';
import { buildCableJournalSheet } from '../../core/electrical/cableJournalLayout';
import { lineCodes } from '../../core/electrical/lineOps';
import {
  buildPlanSheetChecks,
  buildPlanSheetNumbering,
  linesForPlanKind,
  type PlanSheetCheck,
  type PlanSheetEntry,
} from '../../core/electrical/planSheets';
import type { PlanSheetKind, PlanSheetSpec } from '../../types';
import {
  FileText,
  BookOpen,
  DraftingCompass,
  Calculator,
  ClipboardList,
  LayoutPanelTop,
  CircuitBoard,
  PlugZap,
  Lightbulb,
  Cable,
  ArrowRight,
  Pencil,
  Plus,
  Trash2,
  Check,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface PlanSheetLine {
  id: string;
  code: number;
  name: string;
}

export const DocsPanel: React.FC = () => {
  const {
    rooms,
    devices,
    nodes,
    walls,
    openings,
    freePartitions,
    frames,
    settings,
    setActiveStep,
    setActiveTool,
    savePlanSheet,
    deletePlanSheet,
  } = useProjectStore();
  const { panel, schematic, calculation, specification, autoLayout, routes, issues } =
    usePanelDiagnostics();

  const [titleOpen, setTitleOpen] = useState(false);
  const [openPlanSheetId, setOpenPlanSheetId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [calculationOpen, setCalculationOpen] = useState(false);
  const [specificationOpen, setSpecificationOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [dinOpen, setDinOpen] = useState(false);

  const planSource = useMemo(
    () => ({
      rooms,
      nodes,
      walls,
      openings,
      partitions: freePartitions,
      devices,
      panel,
      autoLayout,
      routes,
      wallThicknessMm: settings.defaultWallThicknessMm,
      frames,
      freePartitions,
      defaultWallThicknessMm: settings.defaultWallThicknessMm,
    }),
    [
      rooms,
      nodes,
      walls,
      openings,
      freePartitions,
      devices,
      panel,
      autoLayout,
      routes,
      frames,
      settings.defaultWallThicknessMm,
    ]
  );

  const numbering = useMemo(() => buildPlanSheetNumbering(panel), [panel]);

  const planLayouts = useMemo(() => {
    const layouts = new Map<string, PlanSheetLayout>();
    if (!panel) return layouts;
    for (const sheet of numbering.sheets) {
      layouts.set(
        sheet.id,
        buildPlanSheet(
          { ...planSource, mode: sheet.kind },
          {
            lineIds: sheet.lineIds,
            sheetName: sheet.name,
            sheetNumber: String(sheet.number),
            sheetTotal: String(numbering.total),
          }
        )
      );
    }
    return layouts;
  }, [panel, planSource, numbering]);

  const planLines = useMemo(() => {
    const codes = panel ? lineCodes(panel) : new Map<string, number>();
    const build = (kind: PlanSheetKind): PlanSheetLine[] =>
      linesForPlanKind(panel, kind).map((line, index) => ({
        id: line.id,
        code: codes.get(line.id) ?? line.code ?? index + 2,
        name: line.name,
      }));
    return { power: build('power'), lighting: build('lighting') };
  }, [panel]);

  const planChecks = useMemo<PlanSheetCheck[]>(() => {
    const checks = buildPlanSheetChecks(panel, devices);
    if (panel) {
      const scale = Math.max(
        0,
        ...[...planLayouts.values()].map((layout) => layout.scale)
      );
      if (scale > 150) {
        checks.push({
          id: 'plan-sheet-scale',
          severity: 'info',
          message: `Планы в масштабе 1:${scale} — подписи и символы мелкие. Листы по группам убирают лишние подписи, но не увеличивают символы; привязки уточняйте по месту.`,
        });
      }
    }
    return checks;
  }, [panel, devices, planLayouts]);

  const cableJournalSheet = useMemo(() => {
    if (!panel) return null;
    const journal = buildCableJournal(panel, {
      devices,
      rooms,
      partitions: freePartitions,
      routes,
    });
    return buildCableJournalSheet(journal, {
      sheetNumber: String(numbering.journalNumber),
      sheetTotal: String(numbering.total),
    });
  }, [panel, devices, rooms, freePartitions, routes, numbering]);

  const openedPlan = openPlanSheetId
    ? planLayouts.get(openPlanSheetId) ?? null
    : null;

  return (
    <>
      <aside className="w-full md:w-80 shrink-0 bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col h-[40%] md:h-full min-h-0 text-slate-200 select-none">
        <div className="p-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-sky-400 shrink-0" />
            <h2 className="text-sm font-bold text-white">Документы</h2>
          </div>
          <p className="mt-1 text-[10px] text-slate-500 leading-snug">
            Листы A3 по проекту. Открываются поверх плана, можно печатать.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {!panel ? (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400 leading-snug">
                Чертежи появятся, когда вы разместите щиток на плане и соберёте линии.
              </p>
              <button
                onClick={() => {
                  setActiveStep('plan');
                  setActiveTool('place_panel');
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-semibold transition"
              >
                <CircuitBoard size={13} />
                Разместить щиток на плане
                <ArrowRight size={13} />
              </button>
            </div>
          ) : (
            <>
              {planChecks.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5">
                  {planChecks.map((check) => (
                    <div
                      key={check.id}
                      className={`flex items-start gap-1.5 text-[10px] leading-snug ${
                        check.severity === 'warning'
                          ? 'text-amber-200/90'
                          : 'text-slate-300'
                      }`}
                    >
                      {check.severity === 'warning' ? (
                        <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-400" />
                      ) : (
                        <Info size={11} className="mt-0.5 shrink-0 text-sky-400" />
                      )}
                      <span>{check.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <DocCard
                icon={<BookOpen size={15} />}
                title="Титульный лист A3"
                subtitle={`Обложка комплекта: параметры, ${numbering.total} листов`}
                onClick={() => setTitleOpen(true)}
                disabled={!schematic || !specification}
              />

              <PlanSheetsCard
                icon={<PlugZap size={15} />}
                title="План розеточных сетей A3"
                subtitle="Розетки с высотами, группы и трассы кабелей"
                kind="power"
                sheets={numbering.sheets.filter((sheet) => sheet.kind === 'power')}
                lines={planLines.power}
                onOpen={setOpenPlanSheetId}
                onSave={savePlanSheet}
                onDelete={deletePlanSheet}
              />

              <PlanSheetsCard
                icon={<Lightbulb size={15} />}
                title="План осветительных сетей A3"
                subtitle="Светильники, выключатели, высоты и трассы"
                kind="lighting"
                sheets={numbering.sheets.filter((sheet) => sheet.kind === 'lighting')}
                lines={planLines.lighting}
                onOpen={setOpenPlanSheetId}
                onSave={savePlanSheet}
                onDelete={deletePlanSheet}
              />

              <DocCard
                icon={<DraftingCompass size={15} />}
                title="Чертёж щита A3"
                subtitle="Принципиальная схема с автоматами, УЗО и вводом"
                onClick={() => setSheetOpen(true)}
                disabled={!schematic}
              />
              <DocCard
                icon={<Calculator size={15} />}
                title="Расчёт нагрузок A3"
                subtitle="Токи, падение напряжения, выбор автоматов и кабелей"
                onClick={() => setCalculationOpen(true)}
                disabled={!calculation}
              />
              <DocCard
                icon={<ClipboardList size={15} />}
                title="Спецификация A3"
                subtitle="Оборудование и ведомость материалов с длинами кабеля"
                onClick={() => setSpecificationOpen(true)}
                disabled={!specification}
              />
              <DocCard
                icon={<Cable size={15} />}
                title="Кабельный журнал A3"
                subtitle="Группы, кабели, способ прокладки и длины"
                onClick={() => setJournalOpen(true)}
                disabled={!cableJournalSheet}
              />
              <DocCard
                icon={<LayoutPanelTop size={15} />}
                title="Компоновка щита A3"
                subtitle="DIN-рейки, зоны комнат, порядок аппаратов"
                onClick={() => setDinOpen(true)}
                disabled={!panel}
              />
            </>
          )}
        </div>
      </aside>

      {titleOpen && schematic && specification && (
        <PanelTitleSheet
          schematic={schematic}
          specification={specification}
          rooms={rooms}
          deviceCount={devices.length}
          frameCount={frames.length}
          planSheetCounts={numbering.counts}
          onClose={() => setTitleOpen(false)}
        />
      )}

      {openedPlan && (
        <PanelPlanSheet layout={openedPlan} onClose={() => setOpenPlanSheetId(null)} />
      )}

      {sheetOpen && schematic && (
        <PanelSheet
          schematic={schematic}
          issues={issues}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {calculationOpen && calculation && (
        <PanelCalculation
          calculation={calculation}
          issues={issues}
          onClose={() => setCalculationOpen(false)}
        />
      )}

      {specificationOpen && specification && (
        <PanelSpecification
          specification={specification}
          issues={issues}
          onClose={() => setSpecificationOpen(false)}
        />
      )}

      {journalOpen && cableJournalSheet && (
        <PanelCableJournal
          sheet={cableJournalSheet}
          onClose={() => setJournalOpen(false)}
        />
      )}

      {dinOpen && panel && (
        <PanelDinSheet panel={panel} rooms={rooms} onClose={() => setDinOpen(false)} />
      )}
    </>
  );
};

interface DocCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}

const DocCard: React.FC<DocCardProps> = ({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="w-full flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2.5 text-left transition hover:border-sky-500/50 hover:bg-slate-950/70 disabled:opacity-40 disabled:cursor-not-allowed"
  >
    <span className="mt-0.5 text-sky-400 shrink-0">{icon}</span>
    <span className="min-w-0">
      <span className="block text-[11px] font-bold text-slate-200">{title}</span>
      <span className="block text-[9px] text-slate-500 leading-snug mt-0.5">
        {subtitle}
      </span>
    </span>
  </button>
);

interface PlanSheetsCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  kind: PlanSheetKind;
  sheets: PlanSheetEntry[];
  lines: PlanSheetLine[];
  onOpen: (id: string) => void;
  onSave: (sheet: PlanSheetSpec) => void;
  onDelete: (id: string) => void;
}

const PlanSheetsCard: React.FC<PlanSheetsCardProps> = ({
  icon,
  title,
  subtitle,
  kind,
  sheets,
  lines,
  onOpen,
  onSave,
  onDelete,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const editable = lines.length > 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-sky-400 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold text-slate-200">{title}</div>
          <div className="text-[9px] text-slate-500 leading-snug mt-0.5">
            {subtitle}
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {sheets.map((sheet) => (
          <div key={sheet.id}>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onOpen(sheet.id)}
                className="flex-1 min-w-0 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-left hover:border-sky-500/50 hover:bg-slate-900 transition"
                title={`Открыть лист ЭС-${kind === 'power' ? '05' : '06'} № ${sheet.number}`}
              >
                <span className="text-[9px] font-mono text-sky-400 shrink-0">
                  {sheet.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold text-slate-200 truncate">
                    {sheet.name}
                  </span>
                  <span className="block text-[9px] text-slate-500">
                    {sheet.lineIds.length} гр.
                    {!sheet.stored && ' · все группы'}
                  </span>
                </span>
              </button>
              <button
                onClick={() => {
                  setDraftId(null);
                  setEditingId(editingId === sheet.id ? null : sheet.id);
                }}
                disabled={!editable}
                className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-sky-500/10 disabled:opacity-30"
                title="Выбрать группы"
              >
                <Pencil size={12} />
              </button>
              {sheet.stored && (
                <button
                  onClick={() => {
                    onDelete(sheet.id);
                    if (editingId === sheet.id) setEditingId(null);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10"
                  title="Удалить лист"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            {editingId === sheet.id && (
              <SheetEditor
                key={`${sheet.id}:${sheet.name}:${sheet.lineIds.join(',')}`}
                id={sheet.id}
                kind={sheet.kind}
                label="Изменить лист"
                initialName={sheet.name}
                initialLineIds={sheet.lineIds}
                lines={lines}
                onSave={(next) => {
                  onSave(next);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            )}
          </div>
        ))}

        {draftId && (
          <SheetEditor
            key={draftId}
            id={draftId}
            kind={kind}
            label="Новый лист"
            initialName=""
            initialLineIds={[]}
            lines={lines}
            onSave={(next) => {
              onSave(next);
              setDraftId(null);
            }}
            onCancel={() => setDraftId(null)}
          />
        )}
      </div>

      <button
        onClick={() => {
          setEditingId(null);
          setDraftId(`plan-sheet-${kind}-${Date.now()}`);
        }}
        disabled={!editable || draftId !== null}
        className="mt-2 w-full flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-700 py-1.5 text-[10px] font-semibold text-slate-400 hover:text-sky-300 hover:border-sky-500/40 disabled:opacity-30"
        title={editable ? 'Добавить лист' : 'Сначала соберите группы'}
      >
        <Plus size={11} />
        Добавить лист
      </button>
    </div>
  );
};

interface SheetEditorProps {
  id: string;
  kind: PlanSheetKind;
  label: string;
  initialName: string;
  initialLineIds: string[];
  lines: PlanSheetLine[];
  onSave: (sheet: PlanSheetSpec) => void;
  onCancel: () => void;
}

const SheetEditor: React.FC<SheetEditorProps> = ({
  id,
  kind,
  label,
  initialName,
  initialLineIds,
  lines,
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState(initialName);
  const [selected, setSelected] = useState<string[]>(initialLineIds);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  return (
    <div className="mt-1 rounded-lg border border-sky-500/30 bg-slate-950/80 p-2 space-y-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-sky-400">
        {label}
      </div>
      <label className="block">
        <span className="block text-[9px] text-slate-500 mb-0.5">
          Имя листа — пустое заполнится из групп
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder="Кухня, силовая"
          className="w-full rounded-md bg-slate-900 border border-slate-700 px-1.5 py-1 text-[10px] text-slate-100 outline-none focus:border-sky-500"
        />
      </label>
      <div className="max-h-36 overflow-y-auto space-y-0.5">
        {lines.map((line) => (
          <label
            key={line.id}
            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-slate-300 hover:bg-slate-900 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(line.id)}
              onChange={() => toggle(line.id)}
              className="accent-sky-500"
            />
            <span className="font-mono text-[9px] text-sky-400 shrink-0">
              {line.code}
            </span>
            <span className="truncate">{line.name}</span>
          </label>
        ))}
      </div>
      {selected.length === 0 && (
        <p className="text-[9px] text-amber-300/90">
          Лист без групп сохранить нельзя — отметьте хотя бы одну.
        </p>
      )}
      <div className="flex gap-1.5 pt-0.5">
        <button
          onClick={() =>
            onSave({
              id,
              kind,
              name: name.trim(),
              lineIds: selected,
            })
          }
          disabled={selected.length === 0}
          className="flex-1 flex items-center justify-center gap-1 rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/30 py-1 text-[10px] font-semibold hover:bg-sky-500/25 disabled:opacity-30"
        >
          <Check size={10} />
          Сохранить
        </button>
        <button
          onClick={onCancel}
          className="px-2 rounded-md border border-slate-700 text-slate-400 text-[10px] hover:text-slate-200"
        >
          Отмена
        </button>
      </div>
    </div>
  );
};

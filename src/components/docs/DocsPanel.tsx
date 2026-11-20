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
import { buildPlanSheet } from '../../core/electrical/planSheet';
import { buildCableJournal } from '../../core/electrical/cableJournal';
import { buildCableJournalSheet } from '../../core/electrical/cableJournalLayout';
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
} from 'lucide-react';

export const DocsPanel: React.FC = () => {
  const {
    rooms,
    devices,
    nodes,
    walls,
    openings,
    freePartitions,
    settings,
    setActiveStep,
    setActiveTool,
  } = useProjectStore();
  const { panel, schematic, calculation, specification, autoLayout, routes } =
    usePanelDiagnostics();

  const [titleOpen, setTitleOpen] = useState(false);
  const [powerPlanOpen, setPowerPlanOpen] = useState(false);
  const [lightingPlanOpen, setLightingPlanOpen] = useState(false);
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
      settings.defaultWallThicknessMm,
    ]
  );
  const powerPlan = useMemo(
    () => (panel ? buildPlanSheet({ ...planSource, mode: 'power' }) : null),
    [panel, planSource]
  );
  const lightingPlan = useMemo(
    () => (panel ? buildPlanSheet({ ...planSource, mode: 'lighting' }) : null),
    [panel, planSource]
  );
  const cableJournalSheet = useMemo(() => {
    if (!panel) return null;
    const journal = buildCableJournal(panel, {
      devices,
      rooms,
      partitions: freePartitions,
      routes,
    });
    return buildCableJournalSheet(journal);
  }, [panel, devices, rooms, freePartitions, routes]);

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
              <DocCard
                icon={<BookOpen size={15} />}
                title="Титульный лист A3"
                subtitle="Обложка комплекта: параметры, ведомость листов"
                onClick={() => setTitleOpen(true)}
                disabled={!schematic || !specification}
              />
              <DocCard
                icon={<PlugZap size={15} />}
                title="План розеточных сетей A3"
                subtitle="Розетки с высотами, группы и трассы кабелей"
                onClick={() => setPowerPlanOpen(true)}
                disabled={!powerPlan}
              />
              <DocCard
                icon={<Lightbulb size={15} />}
                title="План осветительных сетей A3"
                subtitle="Светильники, выключатели, высоты и трассы"
                onClick={() => setLightingPlanOpen(true)}
                disabled={!lightingPlan}
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
          onClose={() => setTitleOpen(false)}
        />
      )}

      {powerPlanOpen && powerPlan && (
        <PanelPlanSheet layout={powerPlan} onClose={() => setPowerPlanOpen(false)} />
      )}

      {lightingPlanOpen && lightingPlan && (
        <PanelPlanSheet layout={lightingPlan} onClose={() => setLightingPlanOpen(false)} />
      )}

      {sheetOpen && schematic && (
        <PanelSheet schematic={schematic} onClose={() => setSheetOpen(false)} />
      )}

      {calculationOpen && calculation && (
        <PanelCalculation
          calculation={calculation}
          onClose={() => setCalculationOpen(false)}
        />
      )}

      {specificationOpen && specification && (
        <PanelSpecification
          specification={specification}
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

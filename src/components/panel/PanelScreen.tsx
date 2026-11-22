import React, { useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { formatCableLengthMm } from '../../core/electrical/routing';
import { PanelScheme } from './PanelScheme';
import { PanelSupplyForm } from './PanelSupplyForm';
import { PanelLinesTable } from './PanelLinesTable';
import { PanelProtectionTable } from './PanelProtectionTable';
import { PanelChecks } from './PanelChecks';
import { usePanelDiagnostics } from './usePanelDiagnostics';
import {
  Wallet,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  CircuitBoard,
  Cable,
  ArrowRight,
  ChevronDown,
  ListChecks,
  FileText,
} from 'lucide-react';
import type { PanelStep, PanelStrategy } from '../../types';

const STRATEGIES: {
  id: PanelStrategy;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    id: 'budget',
    label: 'Эконом',
    icon: <Wallet size={16} />,
    description:
      'Одно общее УЗО 30 мА на щит, без РКН и УЗИП. Дешевле, но при утечке отключится всё.',
  },
  {
    id: 'optimal',
    label: 'Оптимальный',
    icon: <ShieldCheck size={16} />,
    description:
      'Противопожарное УЗО 100 мА на вводе, свои 30 мА на мокрые и розеточные линии, РКН и УЗИП.',
  },
  {
    id: 'maximum',
    label: 'Максимум защиты',
    icon: <ShieldAlert size={16} />,
    description:
      'Дифзащита 30 мА на каждой линии, включая свет. Больше модулей и дороже, но максимально безопасно.',
  },
  {
    id: 'custom',
    label: 'Своя защита',
    icon: <SlidersHorizontal size={16} />,
    description:
      'Автоматы, кабели и УЗО задаёте сами. Схема и ручные настройки не перезаписываются.',
  },
];

const strategyTone = (strategy: PanelStrategy): string => {
  const map: Record<PanelStrategy, string> = {
    budget: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
    optimal: 'border-sky-500/60 bg-sky-500/10 text-sky-300',
    maximum: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
    custom: 'border-slate-600 bg-slate-800/60 text-slate-300',
  };
  return map[strategy];
};

interface Pill {
  label: string;
  className: string;
}

const pillTone = (errors: number, warnings: number, okLabel = 'ОК'): Pill => {
  if (errors > 0) {
    return {
      label: `${errors} ош.`,
      className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    };
  }
  if (warnings > 0) {
    return {
      label: `${warnings} зам.`,
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    };
  }
  return {
    label: okLabel,
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  };
};

interface PanelStepCardProps {
  id: PanelStep;
  number: number;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  meta: string;
  pill: Pill;
  open: boolean;
  onOpen: () => void;
}

const PanelStepCard: React.FC<React.PropsWithChildren<PanelStepCardProps>> = ({
  id,
  number,
  title,
  subtitle,
  icon,
  meta,
  pill,
  open,
  onOpen,
  children,
}) => (
  <section
    id={`panel-step-${id}`}
    className="rounded-xl border border-slate-800 bg-slate-950/40 scroll-mt-2 overflow-hidden"
  >
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-2 p-2.5 text-left transition hover:bg-slate-900/60"
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          open ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-400'
        }`}
      >
        {number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-xs font-bold text-white">
          {icon}
          {title}
        </span>
        <span className="block truncate text-[9px] text-slate-500">{subtitle}</span>
      </span>
      <span className="shrink-0 font-mono text-[9px] text-slate-400">{meta}</span>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${pill.className}`}
      >
        {pill.label}
      </span>
      <ChevronDown
        size={13}
        className={`shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`}
      />
    </button>
    {open && (
      <div className="space-y-2 border-t border-slate-800/60 px-2.5 pb-2.5 pt-2">
        {children}
      </div>
    )}
  </section>
);

export const PanelScreen: React.FC = () => {
  const {
    rooms,
    settings,
    panelStep,
    setPanelStep,
    setActiveStep,
    setActiveTool,
    highlightedLineId,
    setHighlightedLine,
    updatePanel,
    updatePanelSupply,
    setPanelStrategy,
    appendUnassignedDevices,
    createManualPanelLine,
    updatePanelLine,
    deletePanelLine,
    clearPanelLines,
    movePanelDinItem,
    resetPanelDinOrder,
    deletePanel,
  } = useProjectStore();

  const {
    panel,
    layout,
    routes,
    totalCableMm,
    unassignedDevices,
    lineChecks,
    checksByStep,
    errors,
    warnings,
  } = usePanelDiagnostics();

  const [supplyOpen, setSupplyOpen] = useState(false);

  const scrollToChecks = () => {
    requestAnimationFrame(() => {
      document
        .getElementById('panel-checks')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openStep = (step: PanelStep, lineId?: string) => {
    if (lineId) setHighlightedLine(lineId);
    setPanelStep(step);
    requestAnimationFrame(() => {
      document
        .getElementById(`panel-step-${step}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const pickStrategy = (strategy: PanelStrategy) => {
    if (strategy !== 'custom' && panel && panel.lines.length > 0) {
      const label = STRATEGIES.find((item) => item.id === strategy)?.label ?? '';
      if (
        !confirm(
          `Стратегия «${label}» заново подберёт автоматы, УЗО и кабели всех линий. Ручные настройки защиты будут заменены. Продолжить?`
        )
      ) {
        return;
      }
    }
    setPanelStrategy(strategy);
  };

  if (!panel || !layout) {
    return (
      <aside className="w-full md:w-[420px] xl:w-[500px] shrink-0 h-[50%] md:h-full overflow-y-auto bg-slate-900 border-l border-slate-800 text-slate-200 select-none">
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CircuitBoard size={16} className="text-sky-400" />
            <h2 className="text-sm font-bold text-white">Трассировка и щиток</h2>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Сначала разместите электрощиток на плане — на шаге «План».
            После этого здесь появятся состав линий, кабели и защита.
          </p>
          <button
            onClick={() => {
              setActiveStep('plan');
              setActiveTool('place_panel');
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-semibold transition"
          >
            Разместить щиток на плане
            <ArrowRight size={13} />
          </button>
        </div>
      </aside>
    );
  }

  const routeMissingCount = panel.lines.filter(
    (line) => line.trace === 'none' && !line.manualRoute && line.deviceIds.length > 0
  ).length;
  const strategyLabel =
    STRATEGIES.find((item) => item.id === panel.strategy)?.label ?? 'Своя защита';

  const stepMeta: Record<PanelStep, string> = {
    devices:
      unassignedDevices.length > 0
        ? `${panel.lines.length} л. · ${unassignedDevices.length} вне`
        : `${panel.lines.length} л.`,
    cable:
      routeMissingCount > 0
        ? `${routeMissingCount} без трассы`
        : formatCableLengthMm(totalCableMm),
    protection: strategyLabel,
  };

  const stepPill: Record<PanelStep, Pill> = {
    devices: pillTone(checksByStep.devices.errors, checksByStep.devices.warnings),
    cable: pillTone(checksByStep.cable.errors, checksByStep.cable.warnings),
    protection: pillTone(
      checksByStep.protection.errors,
      checksByStep.protection.warnings
    ),
  };

  const stepOpen = (step: PanelStep) => panelStep === step;

  return (
    <>
      <aside className="w-full md:w-[420px] xl:w-[500px] shrink-0 h-[50%] md:h-full overflow-y-auto bg-slate-900 border-l border-slate-800 text-slate-200 select-none">
        <div className="p-3 space-y-2.5">
          {/* Шапка: название, корпус, сводка */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
            <div className="flex items-center gap-2">
              <CircuitBoard size={16} className="text-sky-400 shrink-0" />
              <input
                value={panel.name}
                onChange={(e) => updatePanel({ name: e.target.value })}
                className="flex-1 min-w-0 bg-transparent text-sm font-bold text-white focus:outline-none focus:border-b focus:border-sky-500"
              />
            </div>

            <div className="mt-1 text-[10px] text-slate-500 font-mono truncate">
              {panel.mounting === 'flush' ? 'встроенный' : 'накладной'} · H{' '}
              {panel.heightFromFloorMm} мм · {panel.supply.allocatedPowerW / 1000} кВт ·{' '}
              {panel.supply.phases === 3 ? '3 фазы 380/220 В' : '1 фаза 230 В'}
            </div>

            <button
              onClick={() => setSupplyOpen((open) => !open)}
              className="mt-1.5 flex w-full items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-slate-700"
            >
              <SlidersHorizontal size={11} className="text-sky-400" />
              Корпус и ввод
              <ChevronDown
                size={12}
                className={`ml-auto text-slate-500 transition ${supplyOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {supplyOpen && (
              <div className="mt-2">
                <PanelSupplyForm
                  panel={panel}
                  onSupply={updatePanelSupply}
                  onPanel={updatePanel}
                />
              </div>
            )}

            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-1.5 py-1 text-center">
                <div className="text-[8px] uppercase tracking-wider text-slate-500">Линий</div>
                <div className="text-sm font-bold font-mono text-white leading-none">
                  {panel.lines.length}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-1.5 py-1 text-center">
                <div className="text-[8px] uppercase tracking-wider text-slate-500">Модулей</div>
                <div className="text-sm font-bold font-mono text-white leading-none">
                  {layout.modulesTotal}/{layout.enclosureModules}
                </div>
              </div>
              <div
                className="rounded-lg border border-slate-800 bg-slate-950/60 px-1.5 py-1 text-center"
                title="Суммарная длина кабеля по всем линиям с запасом"
              >
                <div className="text-[8px] uppercase tracking-wider text-slate-500">Кабель</div>
                <div className="text-sm font-bold font-mono text-sky-300 leading-none">
                  {formatCableLengthMm(totalCableMm)}
                </div>
              </div>
              <button
                onClick={scrollToChecks}
                title="Показать замечания и ошибки внизу панели"
                className={`rounded-lg border px-1.5 py-1 text-center transition hover:brightness-110 ${
                  errors > 0
                    ? 'border-rose-500/40 bg-rose-500/10'
                    : warnings > 0
                      ? 'border-amber-500/40 bg-amber-500/10'
                      : 'border-emerald-500/40 bg-emerald-500/10'
                }`}
              >
                <div className="text-[8px] uppercase tracking-wider text-slate-400">Проверка</div>
                <div
                  className={`text-sm font-bold font-mono leading-none ${
                    errors > 0
                      ? 'text-rose-300'
                      : warnings > 0
                        ? 'text-amber-300'
                        : 'text-emerald-300'
                  }`}
                >
                  {errors > 0 ? `${errors} ош.` : warnings > 0 ? `${warnings} зам.` : 'ОК'}
                </div>
              </button>
            </div>
          </div>

          <PanelStepCard
            id="devices"
            number={1}
            title="Приборы по линиям"
            subtitle="Кто в какой линии"
            icon={<ListChecks size={13} />}
            meta={stepMeta.devices}
            pill={stepPill.devices}
            open={stepOpen('devices')}
            onOpen={() => setPanelStep('devices')}
          >
            <section className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <PanelLinesTable
                panel={panel}
                rooms={rooms}
                routes={routes}
                defaultRouting={settings.defaultRouting}
                highlightedLineId={highlightedLineId}
                unassignedCount={unassignedDevices.length}
                mode="composition"
                lineChecks={lineChecks}
                onHighlight={setHighlightedLine}
                onCreateEmpty={() => createManualPanelLine()}
                onClear={() => {
                  if (confirm('Очистить схему и собрать щиток с нуля?')) clearPanelLines();
                }}
                onUpdate={updatePanelLine}
                onDelete={deletePanelLine}
                onAppend={appendUnassignedDevices}
                onOpenStep={openStep}
              />
            </section>
          </PanelStepCard>

          <PanelStepCard
            id="cable"
            number={2}
            title="Кабель и трасса"
            subtitle="Сечение и физическая прокладка"
            icon={<Cable size={13} />}
            meta={stepMeta.cable}
            pill={stepPill.cable}
            open={stepOpen('cable')}
            onOpen={() => setPanelStep('cable')}
          >
            <section className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <PanelLinesTable
                panel={panel}
                rooms={rooms}
                routes={routes}
                defaultRouting={settings.defaultRouting}
                highlightedLineId={highlightedLineId}
                unassignedCount={unassignedDevices.length}
                mode="cable"
                lineChecks={lineChecks}
                onHighlight={setHighlightedLine}
                onCreateEmpty={() => createManualPanelLine()}
                onUpdate={updatePanelLine}
                onDelete={deletePanelLine}
                onAppend={appendUnassignedDevices}
                onOpenStep={openStep}
              />
            </section>
          </PanelStepCard>

          <PanelStepCard
            id="protection"
            number={3}
            title="Защита"
            subtitle="Автоматы, УЗО и схема щитка"
            icon={<ShieldCheck size={13} />}
            meta={stepMeta.protection}
            pill={stepPill.protection}
            open={stepOpen('protection')}
            onOpen={() => setPanelStep('protection')}
          >
            <section className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <div className="text-[11px] font-bold text-white">Стратегия защиты</div>
              <p className="text-[9px] text-slate-500 leading-snug mt-0.5 mb-2">
                Стратегия подбирает автоматы и УЗО всех линий под выбранные
                кабели. Ручная правка автомата или УЗО переключает на «Своя
                защита» и больше не перезаписывается.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {STRATEGIES.map((strategy) => {
                  const active = panel.strategy === strategy.id;
                  return (
                    <button
                      key={strategy.id}
                      onClick={() => pickStrategy(strategy.id)}
                      title={strategy.description}
                      className={`text-left rounded-lg border px-2 py-1.5 transition ${
                        active
                          ? strategyTone(strategy.id)
                          : 'border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span className="flex items-center gap-1 text-[10px] font-bold">
                        {strategy.icon}
                        {strategy.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <div className="text-[11px] font-bold text-white">Аппараты защиты линий</div>
              <p className="text-[9px] text-slate-500 leading-snug mt-0.5 mb-2">
                Ток линии ≤ автомат ≤ допуск кабеля. Для розеточных и влажных линий —
                УЗО не более 30 мА. Кабель меняется на шаге 2.
              </p>
              <PanelProtectionTable
                panel={panel}
                highlightedLineId={highlightedLineId}
                lineChecks={lineChecks}
                onHighlight={setHighlightedLine}
                onUpdate={updatePanelLine}
                onOpenCable={(lineId) => openStep('cable', lineId)}
              />
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <PanelScheme
                panel={panel}
                layout={layout}
                highlightedLineId={highlightedLineId}
                onHighlight={setHighlightedLine}
                onMoveItem={movePanelDinItem}
                onResetOrder={resetPanelDinOrder}
              />
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              <div className="flex items-center gap-2">
                <FileText size={13} className="text-sky-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-white">
                    Чертежи и спецификация
                  </div>
                  <div className="text-[9px] text-slate-500">
                    Листы A3 и печать — в шаге «Документы»
                  </div>
                </div>
                <button
                  onClick={() => setActiveStep('docs')}
                  className="flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[10px] font-bold text-sky-300 transition hover:bg-sky-500/25"
                >
                  Открыть
                  <ArrowRight size={11} />
                </button>
              </div>
            </section>
          </PanelStepCard>

          <PanelChecks />

          <button
            onClick={() => {
              if (confirm(`Удалить щиток «${panel.name}» и его схему?`)) deletePanel();
            }}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950/40 hover:border-rose-500/50 hover:text-rose-400 text-slate-500 text-[10px] font-semibold transition"
          >
            <Trash2 size={12} />
            Удалить щиток
          </button>
        </div>
      </aside>
    </>
  );
};

import React, { useEffect, useMemo } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { buildPanelLayout } from '../../core/electrical/panelLayout';
import { collectUnassignedDevices } from '../../core/electrical/lineAssignment';
import { PanelScheme } from './PanelScheme';
import { PanelSupplyForm } from './PanelSupplyForm';
import { PanelLinesTable } from './PanelLinesTable';
import {
  ArrowLeft,
  Wallet,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  CircuitBoard,
} from 'lucide-react';
import type { PanelStrategy } from '../../types';

const STRATEGIES: {
  id: PanelStrategy;
  label: string;
  icon: React.ReactNode;
  description: string;
  tone: string;
}[] = [
  {
    id: 'budget',
    label: 'Эконом',
    icon: <Wallet size={16} />,
    description:
      'Одно общее УЗО 30 мА на щит, без РКН и УЗИП. Дешевле, но при утечке отключится всё.',
    tone: 'emerald',
  },
  {
    id: 'optimal',
    label: 'Оптимальный',
    icon: <ShieldCheck size={16} />,
    description:
      'Противопожарное УЗО 100 мА на вводе, свои 30 мА на мокрые и розеточные линии, РКН и УЗИП.',
    tone: 'sky',
  },
  {
    id: 'maximum',
    label: 'Максимум защиты',
    icon: <ShieldAlert size={16} />,
    description:
      'Дифзащита 30 мА на каждой линии, включая свет. Больше модулей и дороже, но максимально безопасно.',
    tone: 'amber',
  },
  {
    id: 'custom',
    label: 'Вручную',
    icon: <SlidersHorizontal size={16} />,
    description:
      'Схема не перезаписывается. Меняйте автоматы, кабели и УЗО в таблице сами.',
    tone: 'slate',
  },
];

const WARNING_STYLE = {
  error: { icon: <XCircle size={13} />, className: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
  warning: { icon: <AlertTriangle size={13} />, className: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  info: { icon: <Info size={13} />, className: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
} as const;

export const PanelScreen: React.FC = () => {
  const {
    panel,
    rooms,
    devices,
    highlightedLineId,
    setHighlightedLine,
    setActiveView,
    updatePanel,
    updatePanelSupply,
    setPanelStrategy,
    generatePanelLines,
    addPanelLine,
    updatePanelLine,
    deletePanelLine,
    clearPanelLines,
    deletePanel,
  } = useProjectStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveView('plan');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveView]);

  const layout = useMemo(() => (panel ? buildPanelLayout(panel) : null), [panel]);
  const unassignedDevices = useMemo(
    () => collectUnassignedDevices(devices, panel),
    [devices, panel]
  );

  if (!panel || !layout) return null;

  const sampleNames = unassignedDevices
    .slice(0, 3)
    .map((device) => device.name)
    .join(', ');
  const warningsList = unassignedDevices.length
    ? [
        ...layout.warnings,
        {
          id: 'unassigned-devices',
          severity: 'warning' as const,
          message: `Вне линий: ${unassignedDevices.length} приб. (${sampleNames}${
            unassignedDevices.length > 3 ? '…' : ''
          }). Они не попадут в трассы — пересоберите линии из приборов.`,
        },
      ]
    : layout.warnings;

  const showLineOnPlan = (lineId: string) => {
    setHighlightedLine(lineId);
    setActiveView('plan');
  };

  const strategyTone = (strategy: PanelStrategy): string => {
    const map: Record<PanelStrategy, string> = {
      budget: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
      optimal: 'border-sky-500/60 bg-sky-500/10 text-sky-300',
      maximum: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
      custom: 'border-slate-600 bg-slate-800/60 text-slate-300',
    };
    return map[strategy];
  };

  const errors = warningsList.filter((warning) => warning.severity === 'error').length;
  const warnings = warningsList.filter((warning) => warning.severity === 'warning').length;

  return (
    <div className="flex-1 h-full overflow-y-auto bg-slate-950">
      <div className="max-w-[1500px] mx-auto p-5 space-y-4">
        {/* Шапка модуля */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <button
              onClick={() => setActiveView('plan')}
              className="mt-0.5 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold transition shrink-0"
              title="Вернуться к планировке (Esc)"
            >
              <ArrowLeft size={14} />
              К плану
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CircuitBoard size={18} className="text-sky-400 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-sky-400">
                  Модуль щитка
                </span>
              </div>
              <input
                value={panel.name}
                onChange={(e) => updatePanel({ name: e.target.value })}
                className="mt-0.5 w-full max-w-sm bg-transparent text-2xl font-bold text-white focus:outline-none focus:border-b focus:border-sky-500"
              />
              <div className="text-[11px] text-slate-400 font-mono">
                {panel.mounting === 'flush' ? 'встроенный' : 'накладной'} · H{' '}
                {panel.heightFromFloorMm} мм · {panel.supply.allocatedPowerW / 1000} кВт ·
                1 фаза 230 В
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Линий</div>
              <div className="text-base font-bold font-mono text-white leading-none">
                {panel.lines.length}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-center">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">Модулей</div>
              <div className="text-base font-bold font-mono text-white leading-none">
                {layout.modulesTotal}/{layout.enclosureModules}
              </div>
            </div>
            <div
              className={`rounded-xl border px-3 py-2 text-center ${
                errors > 0
                  ? 'border-rose-500/40 bg-rose-500/10'
                  : warnings > 0
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-emerald-500/40 bg-emerald-500/10'
              }`}
            >
              <div className="text-[9px] uppercase tracking-wider text-slate-400">Проверка</div>
              <div
                className={`text-base font-bold font-mono leading-none ${
                  errors > 0
                    ? 'text-rose-300'
                    : warnings > 0
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                }`}
              >
                {errors > 0 ? `${errors} ошиб.` : warnings > 0 ? `${warnings} зам.` : 'ОК'}
              </div>
            </div>
            <button
              onClick={() => {
                if (confirm(`Удалить щиток «${panel.name}» и его схему?`)) deletePanel();
              }}
              className="p-2.5 rounded-xl border border-slate-800 bg-slate-900 hover:border-rose-500/50 hover:text-rose-400 text-slate-500 transition"
              title="Удалить щиток"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {/* Стратегии */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-sm font-bold text-white">Как собрать щиток</div>
              <div className="text-[10px] text-slate-400">
                Стратегия задаёт состав защиты и запас корпуса. После выбора схему можно править.
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={generatePanelLines}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-bold transition"
                title="Построить линии по комнатам и приборам на плане"
              >
                <ShieldCheck size={13} />
                Автоматически из приборов
              </button>
              <button
                onClick={() => {
                  if (confirm('Очистить схему и собрать щиток с нуля?')) clearPanelLines();
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-semibold transition"
                title="Удалить все линии и начать с пустого щитка"
              >
                <Trash2 size={13} />
                С нуля
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
            {STRATEGIES.map((strategy) => {
              const active = panel.strategy === strategy.id;
              return (
                <button
                  key={strategy.id}
                  onClick={() => setPanelStrategy(strategy.id)}
                  className={`text-left rounded-xl border p-3 transition ${
                    active
                      ? strategyTone(strategy.id)
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      {strategy.icon}
                      {strategy.label}
                    </span>
                    {active && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-950/40 font-bold">
                        выбрано
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-slate-400">
                    {strategy.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_430px] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <PanelSupplyForm
                panel={panel}
                onSupply={updatePanelSupply}
                onPanel={updatePanel}
              />
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <PanelLinesTable
                panel={panel}
                rooms={rooms}
                highlightedLineId={highlightedLineId}
                onHighlight={setHighlightedLine}
                onShowOnPlan={showLineOnPlan}
                onAdd={addPanelLine}
                onUpdate={updatePanelLine}
                onDelete={deletePanelLine}
                onGenerate={generatePanelLines}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <PanelScheme panel={panel} layout={layout} />
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold text-white">Проверка по нормам</div>
                <span className="text-[10px] text-slate-500">
                  ПУЭ-7 · СП 256 · ГОСТ Р 50571
                </span>
              </div>

              {warningsList.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300">
                  <CheckCircle2 size={16} />
                  <span className="text-[11px] font-semibold">
                    Ошибок не найдено. Схема соответствует выбранным правилам.
                  </span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {warningsList.map((warning) => {
                    const style = WARNING_STYLE[warning.severity];
                    return (
                      <div
                        key={warning.id}
                        className={`flex items-start gap-2 rounded-lg border p-2 ${style.className}`}
                      >
                        <span className="mt-0.5 shrink-0">{style.icon}</span>
                        <span className="text-[10px] leading-snug">{warning.message}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="mt-3 text-[9px] text-slate-500 leading-snug">
                Расчёт носит справочный характер. Перед монтажом проверьте вводные данные
                (ТУ, тип кабеля, условия прокладки) с проектировщиком.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

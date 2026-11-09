import React, { useEffect, useMemo } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { buildPanelLayout } from '../../core/electrical/panelLayout';
import { collectUnassignedDevices } from '../../core/electrical/lineAssignment';
import { collectLineCompositionWarnings } from '../../core/electrical/lineOps';
import { computeLineRoutes, formatCableLengthMm } from '../../core/electrical/routing';
import { PanelScheme } from './PanelScheme';
import { PanelSupplyForm } from './PanelSupplyForm';
import { PanelLinesTable } from './PanelLinesTable';
import {
  X,
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
    nodes,
    walls,
    freePartitions,
    settings,
    highlightedLineId,
    setHighlightedLine,
    setActiveView,
    updatePanel,
    updatePanelSupply,
    setPanelStrategy,
    generatePanelLines,
    appendUnassignedDevices,
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
  const routes = useMemo(
    () =>
      computeLineRoutes({
        panel,
        devices,
        rooms,
        partitions: freePartitions,
        nodes,
        walls,
        settings,
      }),
    [panel, devices, rooms, freePartitions, nodes, walls, settings]
  );
  const totalCableMm = useMemo(
    () =>
      [...routes.values()].reduce(
        (sum, route) => sum + (route.cableLengthMm || 0),
        0
      ),
    [routes]
  );
  const unassignedDevices = useMemo(
    () => collectUnassignedDevices(devices, panel),
    [devices, panel]
  );
  const compositionWarnings = useMemo(
    () => (panel ? collectLineCompositionWarnings(panel, devices) : []),
    [panel, devices]
  );

  if (!panel || !layout) return null;

  const sampleNames = unassignedDevices
    .slice(0, 3)
    .map((device) => device.name)
    .join(', ');
  const routingWarnings = [
    ...new Set(
      [...routes.values()]
        .map((route) => route.warning)
        .filter((warning): warning is string => warning !== null)
    ),
  ];
  const warningsList = [
    ...layout.warnings,
    ...compositionWarnings,
    ...(unassignedDevices.length
      ? [
          {
            id: 'unassigned-devices',
            severity: 'warning' as const,
            message: `Вне линий: ${unassignedDevices.length} приб. (${sampleNames}${
              unassignedDevices.length > 3 ? '…' : ''
            }). Они не попадут в трассы — пересоберите линии из приборов.`,
          },
        ]
      : []),
    ...routingWarnings.map((message, index) => ({
      id: `route-warning-${index}`,
      severity: 'info' as const,
      message,
    })),
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

  const errors = warningsList.filter((warning) => warning.severity === 'error').length;
  const warnings = warningsList.filter((warning) => warning.severity === 'warning').length;

  return (
    <aside className="w-[420px] xl:w-[500px] shrink-0 h-full overflow-y-auto bg-slate-900 border-l border-slate-800 text-slate-200 select-none">
      <div className="p-3 space-y-3">
        {/* Шапка модуля */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <div className="flex items-center gap-2">
            <CircuitBoard size={16} className="text-sky-400 shrink-0" />
            <input
              value={panel.name}
              onChange={(e) => updatePanel({ name: e.target.value })}
              className="flex-1 min-w-0 bg-transparent text-sm font-bold text-white focus:outline-none focus:border-b focus:border-sky-500"
            />
            <button
              onClick={() => setActiveView('plan')}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition shrink-0"
              title="Закрыть схему (Esc)"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-1 text-[10px] text-slate-500 font-mono truncate">
            {panel.mounting === 'flush' ? 'встроенный' : 'накладной'} · H{' '}
            {panel.heightFromFloorMm} мм · {panel.supply.allocatedPowerW / 1000} кВт ·
            1 фаза 230 В
          </div>

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
            <div
              className={`rounded-lg border px-1.5 py-1 text-center ${
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
            </div>
          </div>
        </div>

        {/* Стратегии */}
        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs font-bold text-white">Как собрать щиток</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (panel.lines.length > 0) appendUnassignedDevices();
                  else generatePanelLines();
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
                title={
                  panel.lines.length > 0
                    ? 'Добавить в линии приборы, которые ещё вне линий'
                    : 'Построить линии по комнатам и приборам на плане'
                }
              >
                <ShieldCheck size={11} />
                Из приборов
              </button>
              <button
                onClick={() => {
                  if (confirm('Очистить схему и собрать щиток с нуля?')) clearPanelLines();
                }}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
                title="Удалить все линии и начать с пустого щитка"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {STRATEGIES.map((strategy) => {
              const active = panel.strategy === strategy.id;
              return (
                <button
                  key={strategy.id}
                  onClick={() => setPanelStrategy(strategy.id)}
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

        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <PanelSupplyForm
            panel={panel}
            onSupply={updatePanelSupply}
            onPanel={updatePanel}
          />
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <PanelLinesTable
            panel={panel}
            rooms={rooms}
            routes={routes}
            defaultRouting={settings.defaultRouting}
            highlightedLineId={highlightedLineId}
            unassignedCount={unassignedDevices.length}
            onHighlight={setHighlightedLine}
            onShowOnPlan={setHighlightedLine}
            onAdd={addPanelLine}
            onUpdate={updatePanelLine}
            onDelete={deletePanelLine}
            onGenerate={generatePanelLines}
            onAppend={appendUnassignedDevices}
          />
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <PanelScheme
            panel={panel}
            layout={layout}
            highlightedLineId={highlightedLineId}
            onHighlight={setHighlightedLine}
          />
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-white">Проверка по нормам</div>
            <span className="text-[9px] text-slate-500">ПУЭ-7 · СП 256</span>
          </div>

          {warningsList.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-300">
              <CheckCircle2 size={14} />
              <span className="text-[10px] font-semibold">
                Ошибок не найдено. Схема соответствует выбранным правилам.
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              {warningsList.map((warning) => {
                const style = WARNING_STYLE[warning.severity];
                return (
                  <div
                    key={warning.id}
                    className={`flex items-start gap-1.5 rounded-lg border p-1.5 ${style.className}`}
                  >
                    <span className="mt-0.5 shrink-0">{style.icon}</span>
                    <span className="text-[9px] leading-snug">{warning.message}</span>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-2 text-[9px] text-slate-500 leading-snug">
            Расчёт носит справочный характер. Перед монтажом проверьте вводные данные
            (ТУ, тип кабеля, условия прокладки) с проектировщиком.
          </p>
        </section>

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
  );
};

import React, { useState } from 'react';
import type {
  CircuitLine,
  ElectricalPanel,
  LinePurpose,
  LineRouting,
  PanelStep,
  RoomZone,
} from '../../types';
import {
  CABLE_AMPACITY_A,
  CABLE_SECTIONS,
  LINE_PRESETS,
  LINE_PURPOSES,
  makeCable,
} from '../../core/electrical/norms';
import { lineCurrentA } from '../../core/electrical/panel';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { formatCableLengthMm, type LineRoute } from '../../core/electrical/routing';
import {
  Plus,
  Trash2,
  AlertTriangle,
  Scissors,
  Merge,
  Wrench,
  ArrowRight,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { LineCompositionDialog } from './LineCompositionDialog';
import type { PanelCheckItem } from './usePanelDiagnostics';

interface PanelLinesTableProps {
  panel: ElectricalPanel;
  rooms: RoomZone[];
  routes: Map<string, LineRoute>;
  defaultRouting: LineRouting;
  highlightedLineId: string | null;
  unassignedCount: number;
  mode: 'composition' | 'cable';
  lineChecks: Map<string, PanelCheckItem[]>;
  onHighlight: (id: string | null) => void;
  onCreateEmpty: () => void;
  onUpdate: (id: string, updates: Partial<CircuitLine>) => void;
  onDelete: (id: string) => void;
  onAppend: () => void;
  onOpenStep: (step: PanelStep, lineId?: string) => void;
}

const CHECK_TEXT: Record<PanelCheckItem['severity'], string> = {
  error: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300',
};

const stripLinePrefix = (message: string) => message.replace(/^«[^»]+»:\s*/, '');

const LineChecks: React.FC<{ items: PanelCheckItem[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {items.map((item) => (
        <p
          key={item.id}
          className={`text-[9px] leading-snug ${CHECK_TEXT[item.severity]}`}
          title={item.reference}
        >
          {stripLinePrefix(item.message)}
        </p>
      ))}
    </div>
  );
};

const EmptyState: React.FC<{ mode: 'composition' | 'cable'; onCreate: () => void }> = ({
  mode,
  onCreate,
}) =>
  mode === 'composition' ? (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-center">
      <p className="text-xs text-slate-400 mb-1">Линий пока нет.</p>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Создайте линию и распределите по ней приборы. Кабель и защиту вы выберете
        следующими шагами.
      </p>
      <button
        onClick={onCreate}
        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
      >
        <Plus size={12} />
        Создать линию
      </button>
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-center">
      <p className="text-xs text-slate-400 mb-1">Кабелей пока нет.</p>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Сначала соберите линии из приборов на шаге 1 — здесь появятся их кабели и
        трассы.
      </p>
    </div>
  );

export const PanelLinesTable: React.FC<PanelLinesTableProps> = ({
  panel,
  rooms,
  routes,
  defaultRouting,
  highlightedLineId,
  unassignedCount,
  mode,
  lineChecks,
  onHighlight,
  onCreateEmpty,
  onUpdate,
  onDelete,
  onAppend,
  onOpenStep,
}) => {
  const [dialog, setDialog] = useState<{ lineId: string; mode: 'edit' | 'split' } | null>(
    null
  );
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeIds, setMergeIds] = useState<Set<string>>(new Set());
  const mergePanelLines = useProjectStore((state) => state.mergePanelLines);
  const setRouteEditLine = useProjectStore((state) => state.setRouteEditLine);
  const lineColors = buildLineColorMap(panel);
  const composition = mode === 'composition';

  const toggleMerge = (lineId: string) => {
    setMergeIds((previous) => {
      const next = new Set(previous);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const cancelMerge = () => {
    setMergeMode(false);
    setMergeIds(new Set());
  };

  const handleMerge = () => {
    if (mergeIds.size < 2) return;
    mergePanelLines([...mergeIds]);
    cancelMerge();
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-white">
            {composition ? 'Состав линий' : 'Кабели и трассы'}
          </div>
          <div className="text-[9px] text-slate-500 leading-snug">
            {composition
              ? 'Какие приборы входят в каждую линию'
              : 'Сечение, способ прокладки и физическая трасса по плану'}
          </div>
        </div>
        {composition && (
          <div className="flex items-center gap-1.5 shrink-0">
            {panel.lines.length >= 2 && (
              <button
                onClick={() => (mergeMode ? cancelMerge() : setMergeMode(true))}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-semibold transition ${
                  mergeMode
                    ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                    : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700 text-slate-300'
                }`}
                title="Объединить несколько линий в одну"
              >
                <Merge size={12} />
                Объединить
              </button>
            )}
            {panel.lines.length > 0 && unassignedCount > 0 && (
              <button
                onClick={onAppend}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-[10px] font-semibold transition"
                title="Добавить в линии приборы, оставшиеся без линии. Текущие линии и их правки не меняются."
              >
                <Plus size={12} />
                Дособрать ({unassignedCount})
              </button>
            )}
          </div>
        )}
      </div>

      {composition && mergeMode && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-1.5">
          <span className="text-[10px] text-sky-200 leading-snug">
            Отметьте 2+ линии. Они станут одной: приборы, комнаты и нагрузка объединятся.
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={cancelMerge}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold transition"
            >
              Отмена
            </button>
            <button
              onClick={handleMerge}
              disabled={mergeIds.size < 2}
              className="flex items-center gap-1 px-2 py-1 rounded bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold transition"
            >
              <Merge size={11} />
              Объединить ({mergeIds.size})
            </button>
          </div>
        </div>
      )}

      {panel.lines.length === 0 ? (
        <EmptyState mode={mode} onCreate={onCreateEmpty} />
      ) : (
        <div className="space-y-1.5">
          {panel.lines.map((line) => {
            const current = lineCurrentA(line);
            const ampacity = CABLE_AMPACITY_A[line.cable.sectionMm2] ?? 0;
            const roomId = line.roomIds[0] ?? '';
            const lineColor = lineColors.get(line.id) ?? '#38bdf8';
            const active = line.id === highlightedLineId;
            const route = routes.get(line.id);
            const routing = line.routing ?? defaultRouting;
            const routeMissing =
              line.trace === 'none' && !line.manualRoute && line.deviceIds.length > 0;
            const checks = (lineChecks.get(line.id) ?? []).filter(
              (check) => check.step === mode
            );
            const hasError = checks.some((check) => check.severity === 'error');

            return (
              <div
                key={line.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('input, select, textarea, button')) {
                    return;
                  }
                  if (mergeMode) {
                    toggleMerge(line.id);
                    return;
                  }
                  onHighlight(active ? null : line.id);
                }}
                className={`rounded-lg border px-2 py-1.5 transition ${
                  hasError
                    ? 'bg-rose-500/5 border-rose-500/30'
                    : 'bg-slate-950/60 border-slate-800/80'
                }`}
                style={
                  active
                    ? {
                        borderColor: lineColor,
                        backgroundColor: `${lineColor}1f`,
                        boxShadow: `0 0 0 1px ${lineColor}66`,
                      }
                    : mergeMode && mergeIds.has(line.id)
                      ? { boxShadow: '0 0 0 2px rgba(56, 189, 248, 0.55)' }
                      : undefined
                }
              >
                <div className="flex items-center gap-1.5">
                  {composition && mergeMode && (
                    <input
                      type="checkbox"
                      checked={mergeIds.has(line.id)}
                      onChange={() => toggleMerge(line.id)}
                      className="accent-sky-500 shrink-0"
                      title="Выбрать для объединения"
                    />
                  )}
                  <button
                    onClick={() => onHighlight(active ? null : line.id)}
                    className="shrink-0 rounded-full p-0.5 transition"
                    title={active ? 'Снять подсветку' : 'Подсветить линию на плане'}
                  >
                    <span
                      className="block w-2.5 h-2.5 rounded-full"
                      style={{
                        backgroundColor: lineColor,
                        boxShadow: active ? `0 0 6px ${lineColor}` : undefined,
                      }}
                    />
                  </button>
                  <input
                    value={line.name}
                    onChange={(e) => onUpdate(line.id, { name: e.target.value })}
                    className="flex-1 min-w-0 bg-transparent text-[11px] font-semibold text-white focus:outline-none focus:border-b focus:border-sky-400"
                  />
                  {composition ? (
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                        line.deviceIds.length === 0
                          ? 'border-amber-700/60 text-amber-300'
                          : 'border-slate-700 text-slate-400'
                      }`}
                      title="Приборов в линии"
                    >
                      {line.deviceIds.length} приб.
                    </span>
                  ) : (
                    <span
                      className={`shrink-0 font-mono text-[10px] ${
                        route?.warning || routeMissing
                          ? 'text-amber-400'
                          : route && route.cableLengthMm > 0
                            ? 'text-sky-300'
                            : 'text-slate-500'
                      }`}
                      title={
                        routeMissing
                          ? 'Трасса не проложена — проложите её в «Монтаже линии».'
                          : route
                            ? `По плану ${(route.planLengthMm / 1000).toFixed(1)} м · вертикально ${(route.verticalMm / 1000).toFixed(1)} м · с запасом`
                            : 'Трасса не рассчитана'
                      }
                    >
                      {routeMissing ? '0 м' : formatCableLengthMm(route?.cableLengthMm ?? 0)}
                    </span>
                  )}
                  {composition && (
                    <button
                      onClick={() => onDelete(line.id)}
                      className="text-slate-500 hover:text-rose-400 p-0.5 rounded shrink-0"
                      title="Удалить линию"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {composition ? (
                  <>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <div className="min-w-0">
                        <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Назначение
                        </span>
                        <select
                          value={line.purpose}
                          onChange={(e) =>
                            onUpdate(line.id, { purpose: e.target.value as LinePurpose })
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-sky-500"
                        >
                          {LINE_PURPOSES.map((purpose) => (
                            <option key={purpose} value={purpose}>
                              {LINE_PRESETS[purpose].label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Комната
                        </span>
                        <select
                          value={roomId}
                          onChange={(e) =>
                            onUpdate(line.id, {
                              roomIds: e.target.value ? [e.target.value] : [],
                            })
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-sky-500"
                        >
                          <option value="">Без комнаты</option>
                          {rooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Нагрузка
                        </span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={20000}
                            step={100}
                            value={line.loadW}
                            onChange={(e) =>
                              onUpdate(line.id, {
                                loadW: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-white font-mono focus:outline-none focus:border-sky-500"
                          />
                          <span className="text-[8px] text-slate-500">Вт</span>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Ток
                        </span>
                        <div className="rounded bg-slate-900/60 border border-slate-800 px-1.5 py-1 font-mono text-[10px] text-slate-300">
                          {current.toFixed(1)} А
                        </div>
                      </div>
                    </div>

                    <LineChecks items={checks} />

                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <button
                        onClick={() => setDialog({ lineId: line.id, mode: 'edit' })}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/60 hover:border-sky-500/60 hover:text-sky-300 text-[9px] text-slate-400 transition"
                        title="Отметить приборы, которые входят в линию"
                      >
                        Приборы ({line.deviceIds.length})
                      </button>
                      <button
                        onClick={() => setDialog({ lineId: line.id, mode: 'split' })}
                        disabled={line.deviceIds.length < 2}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/60 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-700 disabled:hover:text-slate-400 text-[9px] text-slate-400 transition"
                        title="Разделить линию на две"
                      >
                        <Scissors size={10} />
                        Разделить
                      </button>
                      <button
                        onClick={() => onOpenStep('cable', line.id)}
                        className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/60 hover:border-sky-500/60 hover:text-sky-300 text-[9px] text-slate-400 transition"
                        title="Перейти к выбору кабеля и прокладке трассы"
                      >
                        Кабель
                        <ArrowRight size={10} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <div className="min-w-0">
                        <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Кабель
                        </span>
                        <select
                          value={line.cable.sectionMm2}
                          onChange={(e) =>
                            onUpdate(line.id, {
                              cable: makeCable(
                                Number(e.target.value),
                                line.cable.cores === 5 ? 5 : 3
                              ),
                            })
                          }
                          className={`w-full bg-slate-900 border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-sky-500 ${
                            hasError
                              ? 'border-rose-700/70 text-rose-300'
                              : 'border-slate-700 text-slate-200'
                          }`}
                          title="Сечение жилы кабеля линии"
                        >
                          {CABLE_SECTIONS.map((section) => (
                            <option key={section} value={section}>
                              {section} мм²
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                          Прокладка
                        </span>
                        <select
                          value={routing}
                          onChange={(e) =>
                            onUpdate(line.id, { routing: e.target.value as LineRouting })
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-sky-500"
                          title="Способ прокладки линии"
                        >
                          <option value="ceiling">Потолок</option>
                          <option value="floor">Пол</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-1 flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
                      <span>I {current.toFixed(1)} А</span>
                      <span>· кабель до {ampacity} А</span>
                      {route?.warning && (
                        <span className="text-amber-400 truncate" title={route.warning}>
                          · трасса с разрывом
                        </span>
                      )}
                      {(routeMissing || hasError) && (
                        <AlertTriangle size={10} className="text-amber-400 shrink-0" />
                      )}
                    </div>

                    <LineChecks items={checks} />

                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <button
                        onClick={() => {
                          onHighlight(line.id);
                          setRouteEditLine(line.id);
                        }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/60 hover:border-amber-500/60 hover:text-amber-300 text-[9px] text-slate-400 transition"
                        title="Приборы, порядок подключения и трасса линии — на плане"
                      >
                        <Wrench size={10} />
                        Монтаж линии
                      </button>
                      {line.deviceIds.length === 0 && (
                        <button
                          onClick={() => onOpenStep('devices', line.id)}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-700/60 text-amber-300 text-[9px] transition hover:bg-amber-500/10"
                          title="Сначала добавьте приборы в линию"
                        >
                          Сначала приборы
                          <ArrowRight size={10} />
                        </button>
                      )}
                      <span className="ml-auto text-[9px] text-slate-500 font-mono">
                        {line.deviceIds.length} приб.
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {composition && panel.lines.length > 0 && (
        <button
          onClick={onCreateEmpty}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-bold transition"
          title="Создать пустую линию: приборы добавите в её составе"
        >
          <Plus size={13} />
          Создать линию
        </button>
      )}

      <p className="text-[9px] text-slate-500 leading-snug">
        {composition
          ? 'Прибор входит только в одну линию. «Приборы» отмечает состав, «Разделить» переносит часть приборов в новую линию. Кабель и трасса — на шаге 2.'
          : 'Новая линия создаётся без трассы: кабель 0 м, пока трасса не проложена. «Монтаж линии» открывает редактор на плане: приборы добавляются кликами, вершины двигаются, порядок точек меняется в списке.'}
      </p>

      {dialog && (
        <LineCompositionDialog
          key={`${dialog.mode}-${dialog.lineId}`}
          lineId={dialog.lineId}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};

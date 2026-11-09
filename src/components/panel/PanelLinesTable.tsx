import React, { useState } from 'react';
import type {
  CircuitLine,
  ElectricalPanel,
  LinePurpose,
  LineRouting,
  RoomZone,
} from '../../types';
import { CABLE_AMPACITY_A, LINE_PRESETS, LINE_PURPOSES, makeRcd } from '../../core/electrical/norms';
import { lineCurrentA } from '../../core/electrical/panel';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { formatCableLengthMm, type LineRoute } from '../../core/electrical/routing';
import {
  Plus,
  Trash2,
  Wand2,
  AlertTriangle,
  MapPin,
  ChevronDown,
  ListChecks,
  Scissors,
  Merge,
  MousePointerClick,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { LineCompositionDialog } from './LineCompositionDialog';

interface PanelLinesTableProps {
  panel: ElectricalPanel;
  rooms: RoomZone[];
  routes: Map<string, LineRoute>;
  defaultRouting: LineRouting;
  highlightedLineId: string | null;
  unassignedCount: number;
  onHighlight: (id: string | null) => void;
  onShowOnPlan: (id: string) => void;
  onAdd: (purpose: LinePurpose, roomIds: string[]) => void;
  onUpdate: (id: string, updates: Partial<CircuitLine>) => void;
  onDelete: (id: string) => void;
  onGenerate: () => void;
  onAppend: () => void;
}

function rcdValue(line: CircuitLine): string {
  if (!line.rcd) return 'off';
  return `${line.rcd.sensitivityMa}-${line.rcd.type}`;
}

function applyRcdValue(line: CircuitLine, value: string): CircuitLine['rcd'] {
  if (value === 'off') return null;
  const [sensitivity, type] = value.split('-');
  return makeRcd(Number(sensitivity), type as 'A' | 'AC', line.breaker.ratingA);
}

export const PanelLinesTable: React.FC<PanelLinesTableProps> = ({
  panel,
  rooms,
  routes,
  defaultRouting,
  highlightedLineId,
  unassignedCount,
  onHighlight,
  onShowOnPlan,
  onAdd,
  onUpdate,
  onDelete,
  onGenerate,
  onAppend,
}) => {
  const [newPurpose, setNewPurpose] = useState<LinePurpose>('sockets');
  const [newRoomId, setNewRoomId] = useState(rooms[0]?.id ?? '');
  const [dialog, setDialog] = useState<{ lineId: string; mode: 'edit' | 'split' } | null>(
    null
  );
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeIds, setMergeIds] = useState<Set<string>>(new Set());
  const [generateMenuOpen, setGenerateMenuOpen] = useState(false);
  const mergePanelLines = useProjectStore((state) => state.mergePanelLines);
  const setLineAssignLine = useProjectStore((state) => state.setLineAssignLine);
  const setActiveView = useProjectStore((state) => state.setActiveView);
  const lineColors = buildLineColorMap(panel);

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
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-white">Линии и аппараты защиты</div>
          <div className="text-[10px] text-slate-400">
            Номинал автомата ≤ ток кабеля · нагрузка ≤ номинал автомата
          </div>
        </div>
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
          <div className="relative">
            <button
              onClick={() => setGenerateMenuOpen((open) => !open)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-[11px] font-semibold transition"
              title="Собрать линии из приборов на плане"
            >
              <Wand2 size={13} />
              Из приборов
              <ChevronDown size={12} />
            </button>

            {generateMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setGenerateMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-1">
                  <button
                    onClick={() => {
                      setGenerateMenuOpen(false);
                      onAppend();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800 transition"
                  >
                    <span className="block text-[11px] font-semibold text-slate-200">
                      Дособрать новые
                    </span>
                    <span className="block text-[9px] text-slate-500 leading-snug">
                      {unassignedCount > 0
                        ? `Приборы вне линий: ${unassignedCount}. Текущие линии не меняются.`
                        : 'Все приборы уже распределены по линиям.'}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setGenerateMenuOpen(false);
                      const ok = window.confirm(
                        'Пересобрать все линии заново? Текущий состав, названия, ручные нагрузки и настройки УЗО будут заменены группировкой по комнатам.'
                      );
                      if (ok) onGenerate();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-rose-500/10 transition"
                  >
                    <span className="block text-[11px] font-semibold text-rose-300">
                      Пересобрать всё…
                    </span>
                    <span className="block text-[9px] text-slate-500 leading-snug">
                      Полная замена текущих линий по приборам на плане.
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {mergeMode && (
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
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center">
          <p className="text-xs text-slate-400 mb-1">Линий пока нет.</p>
          <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
            Соберите черновик из приборов на плане или добавьте линии вручную.
            Освещение и розетки группируются по комнатам.
          </p>
          <button
            onClick={onGenerate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold transition"
          >
            <Wand2 size={13} />
            Собрать из приборов
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {panel.lines.map((line) => {
            const current = lineCurrentA(line);
            const ampacity = CABLE_AMPACITY_A[line.cable.sectionMm2] ?? 0;
            const breakerCableError = line.breaker.ratingA > ampacity;
            const loadError = current > line.breaker.ratingA + 0.01;
            const roomId = line.roomIds[0] ?? '';
            const lineColor = lineColors.get(line.id) ?? '#38bdf8';
            const active = line.id === highlightedLineId;
            const route = routes.get(line.id);
            const routing = line.routing ?? defaultRouting;

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
                  breakerCableError || loadError
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
                  {mergeMode && (
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
                  <span
                    className={`shrink-0 font-mono text-[10px] ${
                      route?.warning
                        ? 'text-amber-400'
                        : route && route.cableLengthMm > 0
                          ? 'text-sky-300'
                          : 'text-slate-500'
                    }`}
                    title={
                      route
                        ? `По плану ${(route.planLengthMm / 1000).toFixed(1)} м · вертикально ${(route.verticalMm / 1000).toFixed(1)} м · с запасом`
                        : 'Трасса не рассчитана'
                    }
                  >
                    {formatCableLengthMm(route?.cableLengthMm ?? 0)}
                  </span>
                  <button
                    onClick={() => onShowOnPlan(line.id)}
                    className="text-slate-500 hover:text-sky-400 p-0.5 rounded shrink-0"
                    title="Подсветить линию на плане"
                  >
                    <MapPin size={12} />
                  </button>
                  <button
                    onClick={() => onDelete(line.id)}
                    className="text-slate-500 hover:text-rose-400 p-0.5 rounded shrink-0"
                    title="Удалить линию"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

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
                      Трасса
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

                  <div className="min-w-0">
                    <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                      Защита
                    </span>
                    <div
                      className={`font-mono text-[10px] leading-tight ${
                        breakerCableError ? 'text-rose-400' : 'text-slate-200'
                      }`}
                    >
                      <div>
                        {line.breaker.ratingA} А {line.breaker.curve} · {line.breaker.poles}P
                      </div>
                      <div className={breakerCableError ? 'text-rose-400' : 'text-slate-500'}>
                        {line.cable.sectionMm2} мм² · до {ampacity} А
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                      УЗО
                    </span>
                    <select
                      value={rcdValue(line)}
                      onChange={(e) =>
                        onUpdate(line.id, { rcd: applyRcdValue(line, e.target.value) })
                      }
                      className={`w-full bg-slate-900 border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-sky-500 ${
                        line.purpose === 'lighting' && !line.rcd
                          ? 'border-slate-700 text-slate-400'
                          : line.rcd
                            ? 'border-emerald-700/60 text-emerald-300'
                            : 'border-amber-700/60 text-amber-300'
                      }`}
                    >
                      <option value="off">Без УЗО</option>
                      <option value="30-A">30 мА · A</option>
                      <option value="30-AC">30 мА · AC</option>
                      <option value="100-A">100 мА · A</option>
                      <option value="300-A">300 мА · A</option>
                    </select>
                  </div>
                </div>

                <div className="mt-1 flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
                  <span className={loadError ? 'text-rose-400' : ''}>
                    I {current.toFixed(1)} А
                  </span>
                  {line.deviceIds.length > 0 ? (
                    <span>· приборов {line.deviceIds.length}</span>
                  ) : (
                    <span className="text-amber-400">· нет приборов</span>
                  )}
                  {route?.warning && (
                    <span className="text-amber-400 truncate" title={route.warning}>
                      · трасса с разрывом
                    </span>
                  )}
                  {(breakerCableError || loadError) && (
                    <AlertTriangle size={10} className="text-rose-400 shrink-0" />
                  )}
                </div>

                <div className="mt-1 flex items-center gap-1">
                  <button
                    onClick={() => setDialog({ lineId: line.id, mode: 'edit' })}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/60 hover:border-sky-500/60 hover:text-sky-300 text-[9px] text-slate-400 transition"
                    title="Изменить состав линии: добавить или убрать приборы"
                  >
                    <ListChecks size={10} />
                    Состав ({line.deviceIds.length})
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
                    onClick={() => {
                      onHighlight(line.id);
                      setLineAssignLine(line.id);
                      setActiveView('plan');
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-900/60 hover:border-emerald-500/60 hover:text-emerald-300 text-[9px] text-slate-400 transition"
                    title="Назначать приборы этой линии кликами прямо на плане"
                  >
                    <MousePointerClick size={10} />
                    На плане
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800">
        <span className="text-[10px] text-slate-400">Добавить линию:</span>
        <select
          value={newPurpose}
          onChange={(e) => setNewPurpose(e.target.value as LinePurpose)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-sky-500"
        >
          {LINE_PURPOSES.map((purpose) => (
            <option key={purpose} value={purpose}>
              {LINE_PRESETS[purpose].label}
            </option>
          ))}
        </select>
        <select
          value={newRoomId}
          onChange={(e) => setNewRoomId(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="">Без комнаты</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => onAdd(newPurpose, newRoomId ? [newRoomId] : [])}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
        >
          <Plus size={12} />
          Добавить
        </button>
      </div>

      <p className="text-[9px] text-slate-500 leading-snug">
        Трасса на плане: сплошная — по потолку, пунктир — по полу. Длина кабеля включает
        вертикальные спуски, запас из настроек и 1,5 м на разделку в щитке. Порядок
        подключения приборов — цепочкой от щитка.
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

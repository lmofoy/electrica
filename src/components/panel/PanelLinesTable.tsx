import React, { useState } from 'react';
import type { CircuitLine, ElectricalPanel, LinePurpose, RoomZone } from '../../types';
import { CABLE_AMPACITY_A, LINE_PRESETS, LINE_PURPOSES, makeRcd } from '../../core/electrical/norms';
import { lineCurrentA } from '../../core/electrical/panel';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { Plus, Trash2, Wand2, AlertTriangle, MapPin } from 'lucide-react';

interface PanelLinesTableProps {
  panel: ElectricalPanel;
  rooms: RoomZone[];
  highlightedLineId: string | null;
  onHighlight: (id: string | null) => void;
  onShowOnPlan: (id: string) => void;
  onAdd: (purpose: LinePurpose, roomIds: string[]) => void;
  onUpdate: (id: string, updates: Partial<CircuitLine>) => void;
  onDelete: (id: string) => void;
  onGenerate: () => void;
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
  highlightedLineId,
  onHighlight,
  onShowOnPlan,
  onAdd,
  onUpdate,
  onDelete,
  onGenerate,
}) => {
  const [newPurpose, setNewPurpose] = useState<LinePurpose>('sockets');
  const [newRoomId, setNewRoomId] = useState(rooms[0]?.id ?? '');
  const lineColors = buildLineColorMap(panel);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-white">Линии и аппараты защиты</div>
          <div className="text-[10px] text-slate-400">
            Номинал автомата ≤ ток кабеля · нагрузка ≤ номинал автомата
          </div>
        </div>
        <button
          onClick={onGenerate}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-[11px] font-semibold transition shrink-0"
          title="Пересобрать черновик линий по комнатам и приборам на плане"
        >
          <Wand2 size={13} />
          Из приборов
        </button>
      </div>

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
          <div className="grid grid-cols-[minmax(0,1fr)_122px_128px_84px_118px_112px_52px] gap-1.5 px-2 text-[9px] uppercase tracking-wider text-slate-500">
            <span>Линия</span>
            <span>Назначение</span>
            <span>Комната</span>
            <span>Нагрузка</span>
            <span>Защита</span>
            <span>УЗО</span>
            <span />
          </div>

          {panel.lines.map((line) => {
            const current = lineCurrentA(line);
            const ampacity = CABLE_AMPACITY_A[line.cable.sectionMm2] ?? 0;
            const breakerCableError = line.breaker.ratingA > ampacity;
            const loadError = current > line.breaker.ratingA + 0.01;
            const roomId = line.roomIds[0] ?? '';
            const lineColor = lineColors.get(line.id) ?? '#38bdf8';
            const active = line.id === highlightedLineId;

            return (
              <div
                key={line.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('input, select, textarea, button')) {
                    return;
                  }
                  onHighlight(active ? null : line.id);
                }}
                className={`grid grid-cols-[minmax(0,1fr)_122px_128px_84px_118px_112px_52px] gap-1.5 items-center rounded-lg border px-2 py-1.5 transition ${
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
                    : undefined
                }
              >
                <div className="min-w-0 flex items-start gap-1.5">
                  <button
                    onClick={() => onHighlight(active ? null : line.id)}
                    className="mt-1 shrink-0 rounded-full p-0.5 transition"
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
                  <div className="min-w-0 flex-1">
                    <input
                      value={line.name}
                      onChange={(e) => onUpdate(line.id, { name: e.target.value })}
                      className="w-full bg-transparent text-[11px] font-semibold text-white focus:outline-none focus:border-b focus:border-sky-400"
                    />
                    <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
                      <span className={loadError ? 'text-rose-400' : ''}>
                        I {current.toFixed(1)} А
                      </span>
                      {line.deviceIds.length > 0 ? (
                        <span>· приборов {line.deviceIds.length}</span>
                      ) : (
                        <span className="text-amber-400">· нет приборов</span>
                      )}
                      {(breakerCableError || loadError) && (
                        <AlertTriangle size={10} className="text-rose-400" />
                      )}
                    </div>
                  </div>
                </div>

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

                <div className="font-mono text-[10px] leading-tight">
                  <div className={breakerCableError ? 'text-rose-400' : 'text-slate-200'}>
                    {line.breaker.ratingA} А {line.breaker.curve} · {line.breaker.poles}P
                  </div>
                  <div className={breakerCableError ? 'text-rose-400' : 'text-slate-500'}>
                    {line.cable.sectionMm2} мм² · до {ampacity} А
                  </div>
                </div>

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

                <div className="flex items-center justify-center gap-0.5">
                  <button
                    onClick={() => onShowOnPlan(line.id)}
                    className="text-slate-500 hover:text-sky-400 p-1 rounded"
                    title="Показать линию на плане"
                  >
                    <MapPin size={12} />
                  </button>
                  <button
                    onClick={() => onDelete(line.id)}
                    className="text-slate-500 hover:text-rose-400 p-1 rounded"
                    title="Удалить линию"
                  >
                    <Trash2 size={12} />
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
        Цвет и подсветка показывают, какие приборы висят на линии. Физические трассы,
        длины кабелей и раскладка по комнатам — следующий этап.
      </p>
    </div>
  );
};

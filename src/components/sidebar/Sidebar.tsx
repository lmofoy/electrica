import React from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { calculatePolygonAreaM2 } from '../../core/geometry/math';
import { Trash2, Home, Info } from 'lucide-react';
import type { RoomType } from '../../types';

export const Sidebar: React.FC = () => {
  const { rooms, selectedRoomId, setSelectedRoomId, updateRoom, deleteRoom } = useProjectStore();

  const totalAreaM2 = rooms.reduce(
    (sum, room) => sum + calculatePolygonAreaM2(room.vertices),
    0
  );

  const roomTypeLabels: Record<RoomType, string> = {
    living: 'Гостиная',
    bedroom: 'Спальня',
    kitchen: 'Кухня',
    bathroom: 'Ванная',
    toilet: 'Санузел',
    corridor: 'Коридор',
    balcony: 'Балкон',
    storage: 'Гардеробная',
    custom: 'Помещение',
  };

  return (
    <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col h-full text-slate-200 select-none z-30">
      {/* Заголовок со сводкой */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            План квартиры
          </span>
          <span className="text-xs bg-sky-950 text-sky-400 border border-sky-800/60 px-2 py-0.5 rounded-full font-mono">
            {rooms.length} {rooms.length === 1 ? 'зона' : 'зон'}
          </span>
        </div>
        <div className="mt-3 bg-slate-950/70 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-400">Общая площадь:</div>
            <div className="text-xl font-bold font-mono text-white">
              {totalAreaM2.toFixed(2)} <span className="text-sm font-normal text-slate-400">м²</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Home size={20} />
          </div>
        </div>
      </div>

      {/* Список зон и комнат */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Список помещений
        </h3>

        {rooms.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            На плане пока нет комнат.
            <br />
            Выберите инструмент <strong className="text-slate-300">«Контур стен»</strong> вверху.
          </div>
        ) : (
          rooms.map((room) => {
            const area = calculatePolygonAreaM2(room.vertices);
            const isSelected = room.id === selectedRoomId;

            return (
              <div
                key={room.id}
                onClick={() => setSelectedRoomId(room.id)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800 border-sky-500 shadow-lg shadow-sky-950/30'
                    : 'bg-slate-950/50 border-slate-800/80 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full border"
                      style={{ backgroundColor: room.color, borderColor: '#fff' }}
                    />
                    <input
                      type="text"
                      value={room.name}
                      onChange={(e) => updateRoom(room.id, { name: e.target.value })}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-transparent font-medium text-xs text-white focus:outline-none focus:border-b focus:border-sky-400 w-36"
                    />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteRoom(room.id);
                    }}
                    className="text-slate-500 hover:text-rose-400 p-1 rounded transition"
                    title="Удалить комнату"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/50 font-mono">
                  <span>{roomTypeLabels[room.type] || 'Зона'}</span>
                  <span className="font-bold text-sky-400">{area.toFixed(2)} м²</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Инженерная шпаргалка по горячим клавишам черчения */}
      <div className="p-4 bg-slate-950/90 border-t border-slate-800 text-[11px] text-slate-400 space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-slate-300">
          <Info size={13} className="text-sky-400" />
          <span>Быстрый ввод CAD:</span>
        </div>
        <p>
          <kbd className="bg-slate-800 px-1 py-0.5 rounded text-sky-300 font-mono">Tab</kbd> — ввод точной длины (мм)
        </p>
        <p>
          <kbd className="bg-slate-800 px-1 py-0.5 rounded text-sky-300 font-mono">Enter</kbd> — фиксация длины
        </p>
        <p>
          <kbd className="bg-slate-800 px-1 py-0.5 rounded text-emerald-400 font-mono">Enter x2</kbd> — фиксация угла (°)
        </p>
        <p>
          <kbd className="bg-slate-800 px-1 py-0.5 rounded text-slate-300 font-mono">Esc</kbd> — сброс / отмена
        </p>
      </div>
    </aside>
  );
};

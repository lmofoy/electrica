import React from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { calculatePolygonAreaM2 } from '../../core/geometry/math';
import { Trash2, Home, Layers, Info } from 'lucide-react';
import type { RoomType } from '../../types';

export const Sidebar: React.FC = () => {
  const {
    apartment,
    rooms,
    selectedRoomId,
    setSelectedRoomId,
    updateRoom,
    deleteRoom,
    setApartment,
    startApartmentDrawing,
  } = useProjectStore();

  const apartmentAreaM2 = apartment
    ? calculatePolygonAreaM2(apartment.vertices)
    : 0;

  const plannedRoomsAreaM2 = rooms.reduce(
    (sum, r) => sum + calculatePolygonAreaM2(r.vertices),
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
      {/* 1. Высший уровень иерархии: Квартира */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              1. Квартира (Внешний контур)
            </span>
          </div>
          {apartment && (
            <button
              onClick={() => {
                if (confirm('Удалить контур квартиры и все комнаты?')) {
                  setApartment(null);
                }
              }}
              className="text-slate-500 hover:text-rose-400 p-1 rounded"
              title="Удалить контур квартиры"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {apartment ? (
          <div className="bg-slate-900 p-3 rounded-xl border border-amber-500/30 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400">Внутренняя площадь:</div>
              <div className="text-xl font-bold font-mono text-amber-400">
                {apartmentAreaM2.toFixed(2)} <span className="text-xs font-normal text-slate-400">м²</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Наружные стены: {apartment.exteriorWallThicknessMm || 250} мм
              </div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Home size={20} />
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/60 border border-dashed border-slate-700 rounded-xl p-3 text-center">
            <p className="text-xs text-slate-400 mb-2">Контур квартиры не задан</p>
            <button
              onClick={startApartmentDrawing}
              className="w-full py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold transition"
            >
              + Начертить контур
            </button>
          </div>
        )}
      </div>

      {/* 2. Подчиненный уровень иерархии: Комнаты внутри квартиры */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400 uppercase tracking-wider">
            <Layers size={14} />
            <span>2. Комнаты ({rooms.length})</span>
          </div>
          {apartment && (
            <span className="text-[11px] font-mono text-slate-400">
              {plannedRoomsAreaM2.toFixed(1)} / {apartmentAreaM2.toFixed(1)} м²
            </span>
          )}
        </div>

        {rooms.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs leading-relaxed">
            {apartment ? (
              <>
                Внутри квартиры пока нет комнат.
                <br />
                Нажмите <strong className="text-sky-400">«+ Комната»</strong> вверху и очертите зону.
              </>
            ) : (
              'Сначала очертите контур квартиры.'
            )}
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
                    ? 'bg-slate-800 border-sky-500 shadow-lg shadow-sky-950/40'
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
      <div className="p-4 bg-slate-950/90 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold text-slate-300">
          <Info size={13} className="text-sky-400" />
          <span>Управление и черчение:</span>
        </div>
        <p>
          <kbd className="bg-slate-800 px-1 py-0.5 rounded text-slate-300 font-mono">Колесико</kbd> — панорама в любом режиме
        </p>
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
          <span className="text-emerald-400 font-bold">Зеленый круг</span> — магнитная привязка к углам
        </p>
      </div>
    </aside>
  );
};

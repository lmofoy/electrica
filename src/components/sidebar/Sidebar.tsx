import React, { useMemo } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { calculateNetAreaM2 } from '../../core/geometry/math';
import { computeAutoFloors } from '../../core/geometry/autoLayout';
import { Trash2, Home, Layers, Info, Check } from 'lucide-react';
import type { RoomType } from '../../types';
import { DevicePassport } from '../devices/DevicePassport';
import {
  resolveDevice,
  type ResolvedDevice,
} from '../../core/electrical/devices';
import {
  buildPlanChecklist,
  collectRoomElements,
  formatRoomDeletionPrompt,
  getOpeningRoomIds,
} from '../../core/model/roomElements';
import { RoomInspector } from './RoomInspector';

export const Sidebar: React.FC = () => {
  const {
    apartment,
    rooms,
    walls,
    openings,
    freePartitions,
    devices,
    selection,
    settings,
    boundaryMode,
    setSelection,
    updateRoom,
    deleteRoom,
    deleteApartment,
    deleteOpening,
    deletePartition,
    deleteDevice,
    coveragePercent,
    isCoverageValid,
  } = useProjectStore();

  const wallThicknessMm = settings.defaultWallThicknessMm;

  const resolvedDevices = useMemo(
    () =>
      devices
        .map((device) =>
          resolveDevice(device, rooms, freePartitions, wallThicknessMm)
        )
        .filter((device): device is ResolvedDevice => device !== null),
    [devices, rooms, freePartitions, wallThicknessMm]
  );

  const inspectorRoomId = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'room') return selection.id;
    if (selection.kind === 'panel') return null;
    if (selection.kind === 'partition') {
      return freePartitions.find((partition) => partition.id === selection.id)?.roomId ?? null;
    }
    if (selection.kind === 'opening') {
      const opening = openings.find((candidate) => candidate.id === selection.id);
      return opening ? getOpeningRoomIds(opening, walls, rooms)[0] ?? null : null;
    }
    const resolved = resolvedDevices.find(
      (candidate) => candidate.device.id === selection.id
    );
    return resolved?.roomIds[0] ?? null;
  }, [selection, freePartitions, openings, walls, rooms, resolvedDevices]);

  const inspectorElements = useMemo(
    () =>
      inspectorRoomId
        ? collectRoomElements(
            inspectorRoomId,
            rooms,
            walls,
            freePartitions,
            openings,
            devices,
            wallThicknessMm
          )
        : null,
    [
      inspectorRoomId,
      rooms,
      walls,
      freePartitions,
      openings,
      devices,
      wallThicknessMm,
    ]
  );

  const autoFloors = useMemo(
    () =>
      boundaryMode === 'auto'
        ? computeAutoFloors(rooms, freePartitions, wallThicknessMm)
        : [],
    [boundaryMode, rooms, freePartitions, wallThicknessMm]
  );

  const autoFloorAreaByRoom = useMemo(() => {
    const map = new Map<string, number>();
    for (const floor of autoFloors) map.set(floor.roomId, floor.areaM2);
    return map;
  }, [autoFloors]);

  const apartmentAreaM2 = apartment
    ? calculateNetAreaM2(apartment.vertices, apartment.holes ?? [])
    : 0;

  const plannedRoomsAreaM2 =
    boundaryMode === 'auto'
      ? autoFloors.reduce((sum, floor) => sum + floor.areaM2, 0)
      : rooms.reduce((sum, r) => sum + calculateNetAreaM2(r.vertices, r.holes ?? []), 0);

  const planChecklist = useMemo(() => buildPlanChecklist(rooms, openings), [rooms, openings]);

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
    <aside className="w-full md:w-80 shrink-0 bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col h-[40%] md:h-full min-h-0 text-slate-200 select-none z-30">
      {/* 1. Высший уровень иерархии: Квартира */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              {boundaryMode === 'auto'
                ? '1. Квартира (Расчётный контур)'
                : '1. Квартира (Внешний контур)'}
            </span>
          </div>
          {boundaryMode === 'auto'
            ? rooms.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Удалить все комнаты, проёмы и перегородки?')) {
                      deleteApartment();
                    }
                  }}
                  className="text-slate-500 hover:text-rose-400 p-1 rounded"
                  title="Удалить все комнаты"
                >
                  <Trash2 size={13} />
                </button>
              )
            : apartment && (
                <button
                  onClick={() => {
                    if (confirm('Удалить контур квартиры, комнаты, проёмы и перегородки?')) {
                      deleteApartment();
                    }
                  }}
                  className="text-slate-500 hover:text-rose-400 p-1 rounded"
                  title="Удалить контур квартиры"
                >
                  <Trash2 size={13} />
                </button>
              )}
        </div>

        {boundaryMode === 'auto' ? (
          rooms.length > 0 ? (
            <div className="bg-slate-900 p-3 rounded-xl border border-amber-500/30 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-400">Чистовая площадь комнат:</div>
                <div className="text-xl font-bold font-mono text-amber-400">
                  {plannedRoomsAreaM2.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-400">м²</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Внешний контур: {apartmentAreaM2.toFixed(2)} м²
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Толщина стен: {settings.defaultWallThicknessMm} мм
                </div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Home size={20} />
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-dashed border-slate-700 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400">Расчётный контур появится после первой комнаты.</p>
              <p className="mt-1 text-[10px] text-slate-500">
                Нарисуйте её кнопкой «Начертить первую комнату» на плане.
              </p>
            </div>
          )
        ) : apartment ? (
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
            <p className="text-xs text-slate-400">Контур квартиры не задан.</p>
            <p className="mt-1 text-[10px] text-slate-500">
              Кнопка «Начертить контур квартиры» ждёт в центре плана.
            </p>
          </div>
        )}

        {boundaryMode === 'manual' && apartment && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Покрытие комнатами</span>
              <span className={isCoverageValid ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                {coveragePercent.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
              <div
                className={`h-full transition-all ${isCoverageValid ? 'bg-emerald-500' : 'bg-amber-500'}`}
                style={{ width: `${coveragePercent}%` }}
              />
            </div>
            {!isCoverageValid && (
              <p className="text-[10px] text-amber-400/90 mt-1 leading-snug">
                Есть незаполненные зоны — проверьте площади комнат.
              </p>
            )}
          </div>
        )}

      </div>

      {/* 2. Подчиненный уровень иерархии: Комнаты внутри квартиры */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {selection?.kind === 'device' && (
          <DevicePassport
            key={selection.id}
            deviceId={selection.id}
            onClose={() => setSelection(null)}
          />
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400 uppercase tracking-wider">
            <Layers size={14} />
            <span>2. Комнаты ({rooms.length})</span>
          </div>
          {boundaryMode === 'auto'
            ? rooms.length > 0 && (
                <span className="text-[11px] font-mono text-slate-400">
                  {plannedRoomsAreaM2.toFixed(1)} м²
                </span>
              )
            : apartment && (
                <span className="text-[11px] font-mono text-slate-400">
                  {plannedRoomsAreaM2.toFixed(1)} / {apartmentAreaM2.toFixed(1)} м²
                </span>
              )}
        </div>

        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-950/60 px-2.5 py-2"
          title="Разметка плана: комнаты, двери и окна"
        >
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Разметка
          </span>
          {planChecklist.items.map((item) => (
            <span
              key={item.id}
              className={`flex items-center gap-1 text-[10px] font-mono ${
                item.done ? 'text-emerald-300' : 'text-slate-500'
              }`}
            >
              {item.label} <strong className="font-semibold">{item.count}</strong>
              {item.done && <Check size={10} />}
            </span>
          ))}
        </div>

        {rooms.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs leading-relaxed">
            {boundaryMode === 'auto' ? (
              <>
                Комнат пока нет.
                <br />
                Нарисуйте первую комнату кнопкой на плане — стены и контур квартиры
                построятся автоматически.
              </>
            ) : apartment ? (
              <>
                Внутри квартиры пока нет комнат.
                <br />
                Нажмите <strong className="text-sky-400">«Комната»</strong> слева и очертите
                зону.
              </>
            ) : (
              'Сначала очертите контур квартиры.'
            )}
          </div>
        ) : (
          rooms.map((room) => {
            const area =
              boundaryMode === 'auto'
                ? autoFloorAreaByRoom.get(room.id) ?? 0
                : calculateNetAreaM2(room.vertices, room.holes ?? []);
            const isSelected = room.id === inspectorRoomId;

            return (
              <div
                key={room.id}
                onClick={() => setSelection({ kind: 'room', id: room.id })}
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
                      const elements = collectRoomElements(
                        room.id,
                        rooms,
                        walls,
                        freePartitions,
                        openings,
                        devices,
                        wallThicknessMm
                      );
                      if (confirm(formatRoomDeletionPrompt(room.name, elements))) {
                        deleteRoom(room.id);
                      }
                    }}
                    className="text-slate-500 hover:text-rose-400 p-1 rounded transition"
                    title="Удалить комнату"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-slate-400 pt-1 border-t border-slate-800/50 font-mono">
                  <select
                    value={room.type}
                    onChange={(e) =>
                      updateRoom(room.id, { type: e.target.value as RoomType })
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 max-w-[120px] cursor-pointer bg-transparent text-[10px] text-slate-400 hover:text-sky-300 focus:text-sky-300 focus:outline-none"
                    title="Тип комнаты"
                  >
                    {(Object.entries(roomTypeLabels) as [RoomType, string][]).map(
                      ([value, label]) => (
                        <option key={value} value={value} className="bg-slate-900 text-slate-200">
                          {label}
                        </option>
                      )
                    )}
                  </select>
                  <span className="font-bold text-sky-400">{area.toFixed(2)} м²</span>
                </div>

                {isSelected && inspectorElements && (
                  <RoomInspector
                    elements={inspectorElements}
                    selection={selection}
                    walls={walls}
                    rooms={rooms}
                    onSelect={setSelection}
                    onDeleteOpening={deleteOpening}
                    onDeletePartition={deletePartition}
                    onDeleteDevice={deleteDevice}
                  />
                )}
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
          <kbd className="bg-slate-800 px-1 py-0.5 rounded text-rose-300 font-mono">Delete</kbd> — удалить выбранный элемент
        </p>
        <p>
          <span className="text-emerald-400 font-bold">Зеленый круг</span> — магнитная привязка к углам
        </p>
      </div>
    </aside>
  );
};

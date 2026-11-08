import React, { useMemo, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { calculateNetAreaM2 } from '../../core/geometry/math';
import { computeAutoFloors } from '../../core/geometry/autoLayout';
import {
  Trash2,
  Home,
  Layers,
  Info,
  PenTool,
  DoorOpen,
  Square,
  Split,
  Plug,
  CircuitBoard,
  ExternalLink,
  Move,
  Cable,
} from 'lucide-react';
import type { RoomType, RoomZone, Selection, Wall } from '../../types';
import { resolveDevice, type ResolvedDevice } from '../../core/electrical/devices';
import { buildPanelLayout } from '../../core/electrical/panelLayout';
import { collectUnassignedDevices } from '../../core/electrical/lineAssignment';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { computeLineRoutes, formatCableLengthMm } from '../../core/electrical/routing';
import {
  collectRoomElements,
  formatRoomDeletionPrompt,
  getOpeningRoomIds,
  type RoomElements,
} from '../../core/model/roomElements';

type RoomTab = 'doors' | 'windows' | 'partitions' | 'devices';

interface RoomInspectorProps {
  elements: RoomElements;
  selection: Selection | null;
  walls: Wall[];
  rooms: RoomZone[];
  onSelect: (selection: Selection) => void;
  onDeleteOpening: (id: string) => void;
  onDeletePartition: (id: string) => void;
  onDeleteDevice: (id: string) => void;
}

const RoomInspector: React.FC<RoomInspectorProps> = ({
  elements,
  selection,
  walls,
  rooms,
  onSelect,
  onDeleteOpening,
  onDeletePartition,
  onDeleteDevice,
}) => {
  const [tab, setTab] = useState<RoomTab>('doors');

  const tabs: { id: RoomTab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: 'doors', label: 'Двери', count: elements.doors.length, icon: <DoorOpen size={11} /> },
    { id: 'windows', label: 'Окна', count: elements.windows.length, icon: <Square size={11} /> },
    {
      id: 'partitions',
      label: 'Перегородки',
      count: elements.partitions.length,
      icon: <Split size={11} />,
    },
    { id: 'devices', label: 'Электрика', count: elements.devices.length, icon: <Plug size={11} /> },
  ];

  const isSelected = (kind: Selection['kind'], id: string) =>
    selection?.kind === kind && selection.id === id;

  const rowClass = (selected: boolean) =>
    `flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border transition cursor-pointer ${
      selected
        ? 'bg-sky-500/10 border-sky-500/50'
        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/50'
    }`;

  const renderEmpty = (text: string) => (
    <p className="text-[11px] text-slate-500 py-2 text-center leading-snug">{text}</p>
  );

  return (
    <div
      className="mt-3 pt-3 border-t border-slate-700/60 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Состав комнаты
        </span>
        <span className="text-[10px] text-slate-500">клик — выделить, Del — удалить</span>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg border text-[9px] font-semibold transition ${
              tab === item.id
                ? 'bg-sky-500/15 border-sky-500/60 text-sky-300'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title={item.label}
          >
            <span className="flex items-center gap-1">
              {item.icon}
              <span>{item.count}</span>
            </span>
            <span className="leading-none">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="space-y-1">
        {tab === 'doors' &&
          (elements.doors.length === 0
            ? renderEmpty('В комнате нет дверей. Нарисуйте проём в режиме «Архитектура».')
            : elements.doors.map((door) => {
                const wallRooms = getOpeningRoomIds(door, walls, rooms);
                const sharedWall = wallRooms.length > 1;
                return (
                  <div
                    key={door.id}
                    className={rowClass(isSelected('opening', door.id))}
                    onClick={() => onSelect({ kind: 'opening', id: door.id })}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <DoorOpen size={12} className="text-sky-400 shrink-0" />
                        <span className="text-xs text-slate-200 truncate">Дверь</span>
                        {sharedWall && (
                          <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">
                            общая
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {door.widthMm} мм · h {door.heightMm} мм
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteOpening(door.id);
                      }}
                      className="text-slate-500 hover:text-rose-400 p-1 rounded shrink-0"
                      title="Удалить дверь"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              }))}

        {tab === 'windows' &&
          (elements.windows.length === 0
            ? renderEmpty('В комнате нет окон.')
            : elements.windows.map((windowItem) => {
                const wallRooms = getOpeningRoomIds(windowItem, walls, rooms);
                const sharedWall = wallRooms.length > 1;
                return (
                  <div
                    key={windowItem.id}
                    className={rowClass(isSelected('opening', windowItem.id))}
                    onClick={() => onSelect({ kind: 'opening', id: windowItem.id })}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Square size={12} className="text-emerald-400 shrink-0" />
                        <span className="text-xs text-slate-200 truncate">Окно</span>
                        {sharedWall && (
                          <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">
                            общая
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {windowItem.widthMm}×{windowItem.heightMm} мм · от пола{' '}
                        {windowItem.elevationMm} мм
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteOpening(windowItem.id);
                      }}
                      className="text-slate-500 hover:text-rose-400 p-1 rounded shrink-0"
                      title="Удалить окно"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              }))}

        {tab === 'partitions' &&
          (elements.partitions.length === 0
            ? renderEmpty('В комнате нет перегородок.')
            : elements.partitions.map((partition) => {
                const lengthMm = Math.round(
                  Math.hypot(
                    partition.p2.x - partition.p1.x,
                    partition.p2.y - partition.p1.y
                  )
                );
                return (
                  <div
                    key={partition.id}
                    className={rowClass(isSelected('partition', partition.id))}
                    onClick={() => onSelect({ kind: 'partition', id: partition.id })}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Split size={12} className="text-orange-400 shrink-0" />
                        <span className="text-xs text-slate-200 truncate">Перегородка</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {lengthMm} мм · {partition.thicknessMm} мм
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePartition(partition.id);
                      }}
                      className="text-slate-500 hover:text-rose-400 p-1 rounded shrink-0"
                      title="Удалить перегородку"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              }))}

        {tab === 'devices' &&
          (elements.devices.length === 0
            ? renderEmpty(
                'В комнате нет приборов. Переключитесь в режим «Электрика» и поставьте розетки.'
              )
            : elements.devices.map((resolved) => (
                <div
                  key={resolved.device.id}
                  className={rowClass(isSelected('device', resolved.device.id))}
                  onClick={() => onSelect({ kind: 'device', id: resolved.device.id })}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Plug size={12} className="text-sky-400 shrink-0" />
                      <span className="text-xs text-slate-200 truncate">
                        {resolved.device.name}
                      </span>
                      {resolved.isShared && (
                        <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">
                          2 комн.
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      H {resolved.device.heightFromFloorMm} мм
                      {resolved.device.powerWatts > 0
                        ? ` · ${resolved.device.powerWatts} Вт`
                        : ''}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteDevice(resolved.device.id);
                    }}
                    className="text-slate-500 hover:text-rose-400 p-1 rounded shrink-0"
                    title="Удалить прибор"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )))}
      </div>
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const {
    apartment,
    rooms,
    walls,
    nodes,
    shafts,
    openings,
    freePartitions,
    devices,
    panel,
    selection,
    highlightedLineId,
    settings,
    boundaryMode,
    setSelection,
    setActiveTool,
    setDesignMode,
    setActiveView,
    setHighlightedLine,
    updateRoom,
    deleteRoom,
    deleteApartment,
    deleteOpening,
    deletePartition,
    deleteDevice,
    deletePanel,
    startApartmentDrawing,
    startRoomDrawing,
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
        ? computeAutoFloors(rooms, shafts, freePartitions, wallThicknessMm)
        : [],
    [boundaryMode, rooms, shafts, freePartitions, wallThicknessMm]
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

  const panelLayout = useMemo(() => (panel ? buildPanelLayout(panel) : null), [panel]);
  const lineColors = useMemo(() => buildLineColorMap(panel), [panel]);
  const lineRoutes = useMemo(
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
  const unassignedDevices = useMemo(
    () => collectUnassignedDevices(devices, panel),
    [devices, panel]
  );

  const startPanelPlacement = () => {
    setDesignMode('electrical');
    setActiveTool('place_panel');
  };

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
              {boundaryMode === 'auto'
                ? '1. Квартира (Расчётный контур)'
                : '1. Квартира (Внешний контур)'}
            </span>
          </div>
          {boundaryMode === 'auto'
            ? rooms.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Удалить все комнаты, шахты, проёмы и перегородки?')) {
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
                  {shafts.length > 0 && ` • Шахт: ${shafts.length}`}
                </div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Home size={20} />
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-dashed border-slate-700 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400 mb-2">Расчётный контур появится после первой комнаты</p>
              <button
                onClick={() => startRoomDrawing()}
                className="w-full py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold transition"
              >
                + Начертить комнату
              </button>
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
            <p className="text-xs text-slate-400 mb-2">Контур квартиры не задан</p>
            <button
              onClick={startApartmentDrawing}
              className="w-full py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold transition"
            >
              + Начертить контур
            </button>
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

        <div className="mt-3 pt-3 border-t border-slate-800">
          {panel && panelLayout ? (
            <div
              onClick={() => setSelection({ kind: 'panel', id: panel.id })}
              className={`p-3 rounded-xl border cursor-pointer transition ${
                selection?.kind === 'panel'
                  ? 'bg-slate-800 border-sky-500 shadow-lg shadow-sky-950/40'
                  : 'bg-slate-900 border-sky-500/30 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CircuitBoard size={15} className="text-sky-400 shrink-0" />
                  <span className="text-xs font-semibold text-white truncate">
                    {panel.name}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Удалить электрощиток и его схему?')) deletePanel();
                  }}
                  className="text-slate-500 hover:text-rose-400 p-1 rounded shrink-0"
                  title="Удалить щиток"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-1">
                {panel.lines.length} линий · {panelLayout.modulesTotal} мод. · корпус{' '}
                {panelLayout.enclosureModules} · свободно {panelLayout.freeModules}
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveView('panel');
                  }}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-bold transition"
                >
                  <ExternalLink size={12} />
                  Открыть схему
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startPanelPlacement();
                  }}
                  className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition"
                  title="Переместить щиток на другую стену"
                >
                  <Move size={12} />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={startPanelPlacement}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-lg text-xs font-semibold transition"
            >
              <CircuitBoard size={13} />
              + Электрощиток на стену
            </button>
          )}
        </div>
      </div>

      {/* 2. Подчиненный уровень иерархии: Комнаты внутри квартиры */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {panel && panel.lines.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-2">
            <div className="flex items-center justify-between px-1 mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-400">
                <Cable size={12} />
                Линии ({panel.lines.length})
              </div>
              {highlightedLineId && (
                <button
                  onClick={() => setHighlightedLine(null)}
                  className="text-[9px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
                >
                  снять подсветку
                </button>
              )}
            </div>

            <div className="space-y-1">
              {panel.lines.map((line) => {
                const color = lineColors.get(line.id) ?? '#38bdf8';
                const active = line.id === highlightedLineId;
                const lineDevices = devices.filter((device) =>
                  line.deviceIds.includes(device.id)
                );
                const route = lineRoutes.get(line.id);

                return (
                  <div
                    key={line.id}
                    className={`rounded-lg border transition ${
                      active ? '' : 'border-slate-800/80 bg-slate-950/50'
                    }`}
                    style={
                      active
                        ? {
                            borderColor: color,
                            backgroundColor: `${color}1f`,
                            boxShadow: `0 0 0 1px ${color}55`,
                          }
                        : undefined
                    }
                  >
                    <button
                      onClick={() => setHighlightedLine(active ? null : line.id)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left"
                      title="Подсветить линию и её приборы на плане"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: color,
                          boxShadow: active ? `0 0 6px ${color}` : undefined,
                        }}
                      />
                      <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-200 truncate">
                        {line.name}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500 shrink-0">
                        {lineDevices.length} приб. · {Math.round(line.loadW)} Вт
                        {route && route.cableLengthMm > 0
                          ? ` · ${formatCableLengthMm(route.cableLengthMm)}`
                          : ''}
                      </span>
                    </button>

                    {active && (
                      <div className="px-2 pb-1.5 space-y-0.5">
                        {lineDevices.length === 0 ? (
                          <div className="text-[10px] text-amber-400">
                            На линии нет приборов.
                          </div>
                        ) : (
                          lineDevices.map((device) => {
                            const resolved = resolvedDevices.find(
                              (candidate) => candidate.device.id === device.id
                            );
                            const roomId = resolved?.roomIds[0];
                            const roomName = roomId
                              ? rooms.find((room) => room.id === roomId)?.name
                              : null;
                            return (
                              <div
                                key={device.id}
                                className="flex items-center gap-1.5 text-[10px] text-slate-400"
                              >
                                <span
                                  className="w-1 h-1 rounded-full shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                                <span className="truncate">{device.name}</span>
                                {roomName && (
                                  <span className="text-slate-600 truncate">
                                    · {roomName}
                                  </span>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {unassignedDevices.length > 0 && (
              <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300 leading-snug">
                Вне линий: {unassignedDevices.length} приб. — они не попадут в трассы.
              </div>
            )}
          </div>
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

        {rooms.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs leading-relaxed">
            {boundaryMode === 'auto' ? (
              <>
                Комнат пока нет.
                <br />
                Начните с первой комнаты — стены и контур квартиры построятся автоматически.
                <button
                  onClick={() => startRoomDrawing()}
                  className="mt-3 mx-auto flex items-center justify-center gap-2 py-1.5 px-3 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 rounded-lg text-xs font-semibold transition"
                >
                  <PenTool size={13} />
                  Начертить комнату
                </button>
              </>
            ) : apartment ? (
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

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/50 font-mono">
                  <span>{roomTypeLabels[room.type] || 'Зона'}</span>
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

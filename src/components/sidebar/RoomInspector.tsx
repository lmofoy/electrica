import React, { useState } from 'react';
import {
  DoorOpen,
  Plug,
  Split,
  Square,
  Trash2,
} from 'lucide-react';
import type { RoomZone, Selection, Wall } from '../../types';
import type { RoomElements } from '../../core/model/roomElements';
import { getOpeningRoomIds } from '../../core/model/roomElements';

type RoomTab = 'openings' | 'devices';

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

export const RoomInspector: React.FC<RoomInspectorProps> = ({
  elements,
  selection,
  walls,
  rooms,
  onSelect,
  onDeleteOpening,
  onDeletePartition,
  onDeleteDevice,
}) => {
  const [tab, setTab] = useState<RoomTab>('openings');

  const openingsCount =
    elements.doors.length + elements.windows.length + elements.partitions.length;
  const tabs: { id: RoomTab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: 'openings', label: 'Проёмы', count: openingsCount, icon: <DoorOpen size={11} /> },
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

  const groupHeader = (label: string, count: number) => (
    <div className="flex items-center justify-between px-1 pt-1">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span className="text-[9px] font-mono text-slate-500">{count}</span>
    </div>
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

      <div className="grid grid-cols-2 gap-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-[9px] font-semibold transition ${
              tab === item.id
                ? 'bg-sky-500/15 border-sky-500/60 text-sky-300'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            <span className="font-mono">{item.count}</span>
          </button>
        ))}
      </div>

      <div className="space-y-1">
        {tab === 'openings' &&
          (openingsCount === 0
            ? renderEmpty(
                'В комнате нет проёмов и перегородок. Нарисуйте их в режиме «Архитектура».'
              )
            : (
                <>
                  {elements.doors.length > 0 && (
                    <>
                      {groupHeader('Двери', elements.doors.length)}
                      {elements.doors.map((door) => {
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
                                <span className="text-xs text-slate-200 truncate">
                                  Дверь
                                </span>
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
                      })}
                    </>
                  )}

                  {elements.windows.length > 0 && (
                    <>
                      {groupHeader('Окна', elements.windows.length)}
                      {elements.windows.map((windowItem) => {
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
                      })}
                    </>
                  )}

                  {elements.partitions.length > 0 && (
                    <>
                      {groupHeader('Перегородки', elements.partitions.length)}
                      {elements.partitions.map((partition) => {
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
                                <span className="text-xs text-slate-200 truncate">
                                  Перегородка
                                </span>
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
                      })}
                    </>
                  )}
                </>
              ))}

        {tab === 'devices' &&
          (elements.devices.length === 0
            ? renderEmpty(
                'В комнате нет приборов. Поставьте их на шаге «План» кликами по стене.'
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

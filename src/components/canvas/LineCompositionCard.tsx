import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ListChecks, X } from 'lucide-react';
import type {
  CircuitLine,
  ElectricalDevice,
  ElectricalPanel,
  FreePartition,
  RoomZone,
} from '../../types';
import { DEVICE_CATALOG } from '../../core/electrical/devices';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { deviceRoomId } from '../../core/electrical/lineOps';
import { deviceIcon } from './deviceIcon';

interface LineCompositionCardProps {
  line: CircuitLine;
  panel: ElectricalPanel;
  devices: ElectricalDevice[];
  rooms: RoomZone[];
  partitions: FreePartition[];
  bounds: { width: number; height: number };
  onClose: () => void;
}

const CARD_WIDTH = 300;

/**
 * Плавающая карточка состава линии (шаг «Приборы по линиям»).
 * Оформление и перетаскивание — как у «Списка точек» на шаге трассы,
 * но содержимое другое: приборы в линии и вне неё. Пометка состава —
 * только кликами по плану.
 */
export const LineCompositionCard: React.FC<LineCompositionCardProps> = ({
  line,
  panel,
  devices,
  rooms,
  partitions,
  bounds,
  onClose,
}) => {
  const lineColors = useMemo(() => buildLineColorMap(panel), [panel]);
  const color = lineColors.get(line.id) ?? '#38bdf8';
  const ownerByDevice = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    panel.lines.forEach((candidate) => {
      candidate.deviceIds.forEach((id) => {
        if (!map.has(id)) map.set(id, candidate);
      });
    });
    return map;
  }, [panel]);

  const inside = useMemo(() => {
    const byId = new Map(devices.map((device) => [device.id, device]));
    return line.deviceIds
      .map((id) => byId.get(id))
      .filter((device): device is ElectricalDevice => Boolean(device));
  }, [devices, line.deviceIds]);
  const insideIds = useMemo(() => new Set(line.deviceIds), [line.deviceIds]);
  const outside = useMemo(
    () => devices.filter((device) => !insideIds.has(device.id)),
    [devices, insideIds]
  );

  const roomName = useCallback(
    (roomId: string | null) =>
      roomId
        ? rooms.find((room) => room.id === roomId)?.name ?? 'Без комнаты'
        : 'Без комнаты',
    [rooms]
  );

  const outsideGroups = useMemo(() => {
    const byRoom = new Map<string, ElectricalDevice[]>();
    for (const device of outside) {
      const roomId = deviceRoomId(device, rooms, partitions) ?? '';
      const list = byRoom.get(roomId) ?? [];
      list.push(device);
      byRoom.set(roomId, list);
    }
    const order = new Map(rooms.map((room, index) => [room.id, index]));
    return [...byRoom.entries()].sort(
      (a, b) =>
        (order.get(a[0]) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b[0]) ?? Number.MAX_SAFE_INTEGER)
    );
  }, [outside, rooms, partitions]);

  const panelDragRef = useRef<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);
  const [panelDragging, setPanelDragging] = useState(false);
  const [position, setPosition] = useState(() => ({
    x: Math.max(8, bounds.width - CARD_WIDTH - 16),
    y: 132,
  }));

  const clamp = useCallback(
    (next: { x: number; y: number }) => ({
      x: Math.min(Math.max(8, next.x), Math.max(8, bounds.width - CARD_WIDTH - 8)),
      y: Math.min(Math.max(8, next.y), Math.max(8, bounds.height - 140)),
    }),
    [bounds.width, bounds.height]
  );
  const safePosition = clamp(position);

  const renderDeviceRow = (device: ElectricalDevice) => {
    const catalog = DEVICE_CATALOG[device.type];
    const Icon = deviceIcon(device.type);
    const roomId = deviceRoomId(device, rooms, partitions);
    const owner = ownerByDevice.get(device.id);
    const ownerColor = owner ? lineColors.get(owner.id) : undefined;
    const inLine = insideIds.has(device.id);
    return (
      <div
        key={device.id}
        data-composition-device={device.id}
        className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 ${
          inLine
            ? 'border-slate-700/80 bg-slate-950/70'
            : 'border-slate-800/70 bg-slate-950/40'
        }`}
      >
        <span
          className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
          style={{ backgroundColor: `${inLine ? color : '#64748b'}1f`, color: inLine ? color : '#94a3b8' }}
        >
          <Icon size={12} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-semibold text-slate-100 truncate leading-tight">
            {device.name}
          </span>
          <span className="block text-[9px] text-slate-500 truncate leading-tight">
            {catalog.label}
            {roomId ? ` · ${roomName(roomId)}` : ''}
            {device.powerWatts > 0 ? ` · ${device.powerWatts} Вт` : ''}
          </span>
        </span>
        {owner && owner.id !== line.id && (
          <span
            className="flex items-center gap-1 shrink-0 text-[9px] text-slate-500 max-w-[92px]"
            title={`Сейчас в линии «${owner.name}» — клик на плане перенесёт прибор`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: ownerColor ?? '#64748b' }}
            />
            <span className="truncate">{owner.name}</span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      data-line-composition="card"
      className="absolute z-40 flex flex-col rounded-2xl border bg-slate-900/95 shadow-2xl backdrop-blur-md overflow-hidden"
      style={{
        left: safePosition.x,
        top: safePosition.y,
        width: CARD_WIDTH,
        maxHeight: Math.max(220, bounds.height - safePosition.y - 16),
        borderColor: `${color}66`,
        boxShadow: `0 18px 50px -12px rgba(2, 6, 23, 0.9), 0 0 0 1px ${color}22`,
        transition: panelDragging ? 'none' : 'box-shadow 160ms ease',
      }}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-800 cursor-grab active:cursor-grabbing"
        style={{
          background: `linear-gradient(135deg, ${color}26 0%, rgba(15, 23, 42, 0) 62%)`,
          touchAction: 'none',
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          panelDragRef.current = {
            clientX: event.clientX,
            clientY: event.clientY,
            x: position.x,
            y: position.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanelDragging(true);
        }}
        onPointerMove={(event) => {
          const start = panelDragRef.current;
          if (!start) return;
          setPosition(
            clamp({
              x: start.x + (event.clientX - start.clientX),
              y: start.y + (event.clientY - start.clientY),
            })
          );
        }}
        onPointerUp={(event) => {
          panelDragRef.current = null;
          setPanelDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          panelDragRef.current = null;
          setPanelDragging(false);
        }}
      >
        <span
          className="flex items-center justify-center w-6 h-6 rounded-lg shrink-0"
          style={{ backgroundColor: `${color}22`, color }}
        >
          <ListChecks size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold text-white leading-tight truncate">
            Состав линии
          </div>
          <div className="text-[9px] text-slate-400 leading-tight truncate">
            {line.name} · приборов {line.deviceIds.length}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Закончить набор приборов"
          aria-label="Закончить набор приборов"
        >
          <X size={14} />
        </button>
      </div>

      <div className="route-stops-scroll flex-1 overflow-y-auto px-2 py-2 space-y-2.5">
        <section>
          <div className="flex items-center gap-1.5 px-1 mb-1">
            <span className="text-[10px] font-bold text-slate-200 truncate">
              В линии
            </span>
            <span className="ml-auto shrink-0 text-[9px] font-mono text-slate-500">
              {inside.length}
            </span>
          </div>
          {inside.length === 0 ? (
            <p className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1.5 leading-snug">
              В линии пока нет приборов — клик по прибору на плане добавит его.
            </p>
          ) : (
            <div className="space-y-1">{inside.map(renderDeviceRow)}</div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-1.5 px-1 mb-1">
            <span className="text-[10px] font-bold text-slate-400 truncate">
              Вне линии
            </span>
            <span className="ml-auto shrink-0 text-[9px] font-mono text-slate-500">
              {outside.length}
            </span>
          </div>
          {outside.length === 0 ? (
            <p className="text-[10px] text-slate-500 px-1">
              Все приборы уже в этой линии.
            </p>
          ) : (
            <div className="space-y-2">
              {outsideGroups.map(([roomId, groupDevices]) => (
                <div key={roomId || 'none'}>
                  <div className="text-[9px] text-slate-500 mb-1 px-1">
                    {roomName(roomId || null)}
                  </div>
                  <div className="space-y-1">
                    {groupDevices.map(renderDeviceRow)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="px-2.5 py-2 border-t border-slate-800 space-y-1.5 bg-slate-950/40">
        <p className="text-[9px] text-slate-500 leading-snug">
          Клик по прибору на плане — добавить или убрать его из линии, список
          обновляется сразу. Прибор входит только в одну линию. Enter — сохранить,
          Esc — отменить изменения состава.
        </p>
        <button
          onClick={onClose}
          className="w-full py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
        >
          Готово
        </button>
      </div>
    </div>
  );
};

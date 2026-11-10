import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ElectricalDevice, LinePurpose } from '../../types';
import { useProjectStore } from '../../store/useProjectStore';
import { DEVICE_CATALOG } from '../../core/electrical/devices';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { deviceRoomId } from '../../core/electrical/lineOps';
import { LINE_PRESETS, LINE_PURPOSES } from '../../core/electrical/norms';
import { Check, Scissors, X } from 'lucide-react';

interface LineCompositionDialogProps {
  lineId: string;
  mode: 'edit' | 'split';
  onClose: () => void;
}

interface DeviceGroup {
  roomId: string;
  roomName: string;
  devices: ElectricalDevice[];
}

function sameSet(a: Set<string>, b: string[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

export const LineCompositionDialog: React.FC<LineCompositionDialogProps> = ({
  lineId,
  mode,
  onClose,
}) => {
  const panel = useProjectStore((state) => state.panel);
  const devices = useProjectStore((state) => state.devices);
  const rooms = useProjectStore((state) => state.rooms);
  const partitions = useProjectStore((state) => state.freePartitions);
  const setPanelLineComposition = useProjectStore(
    (state) => state.setPanelLineComposition
  );
  const splitPanelLine = useProjectStore((state) => state.splitPanelLine);

  const line = panel?.lines.find((candidate) => candidate.id === lineId) ?? null;
  const originalIds = useMemo(() => line?.deviceIds ?? [], [line]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(originalIds)
  );
  const [newPurpose, setNewPurpose] = useState<LinePurpose>(
    line?.purpose ?? 'sockets'
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const lineColors = useMemo(() => buildLineColorMap(panel), [panel]);
  const deviceLine = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    panel?.lines.forEach((candidate) => {
      candidate.deviceIds.forEach((id) => {
        if (!map.has(id)) map.set(id, candidate);
      });
    });
    return map;
  }, [panel]);

  const pool = useMemo(() => {
    if (mode === 'split') {
      return devices.filter((device) => originalIds.includes(device.id));
    }
    return devices;
  }, [devices, mode, originalIds]);

  const roomName = useCallback(
    (roomId: string | null) =>
      roomId
        ? rooms.find((room) => room.id === roomId)?.name ?? 'Без комнаты'
        : 'Без комнаты',
    [rooms]
  );

  const inside = pool.filter((device) => selected.has(device.id));
  const outside = pool.filter((device) => !selected.has(device.id));

  const groups = useMemo<DeviceGroup[]>(() => {
    const byRoom = new Map<string, DeviceGroup>();
    for (const device of outside) {
      const roomId = deviceRoomId(device, rooms, partitions) ?? '';
      const group = byRoom.get(roomId) ?? {
        roomId,
        roomName: roomName(roomId || null),
        devices: [],
      };
      group.devices.push(device);
      byRoom.set(roomId, group);
    }
    const order = new Map(rooms.map((room, index) => [room.id, index]));
    return [...byRoom.values()].sort(
      (a, b) =>
        (order.get(a.roomId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.roomId) ?? Number.MAX_SAFE_INTEGER)
    );
  }, [outside, rooms, partitions, roomName]);

  if (!panel || !line) return null;

  const color = lineColors.get(line.id) ?? '#38bdf8';
  const unchanged = sameSet(selected, originalIds);
  const moveCount = originalIds.filter((id) => !selected.has(id)).length;
  const remainCount = originalIds.filter((id) => selected.has(id)).length;

  const toggle = (deviceId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  };

  const handleSave = () => {
    setPanelLineComposition(line.id, [...selected]);
    onClose();
  };

  const handleSplit = () => {
    const moving = originalIds.filter((id) => !selected.has(id));
    if (moving.length === 0 || moving.length === originalIds.length) return;
    splitPanelLine(
      line.id,
      moving,
      newPurpose === line.purpose ? undefined : newPurpose
    );
    onClose();
  };

  const renderDeviceRow = (device: ElectricalDevice) => {
    const owner = deviceLine.get(device.id);
    const ownerColor = owner ? lineColors.get(owner.id) : undefined;
    const roomId = deviceRoomId(device, rooms, partitions);
    return (
      <label
        key={device.id}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80 hover:bg-slate-800/40 cursor-pointer transition"
      >
        <input
          type="checkbox"
          checked={selected.has(device.id)}
          onChange={() => toggle(device.id)}
          className="accent-sky-500 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-slate-200 truncate">
            {device.name}
          </span>
          <span className="block text-[9px] text-slate-500 truncate">
            {DEVICE_CATALOG[device.type].label}
            {roomId ? ` · ${roomName(roomId)}` : ''}
            {device.powerWatts > 0 ? ` · ${device.powerWatts} Вт` : ''}
          </span>
        </span>
        {owner && owner.id !== line.id && (
          <span className="flex items-center gap-1 shrink-0 text-[9px] text-slate-500 max-w-[110px]">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: ownerColor ?? '#64748b' }}
            />
            <span className="truncate">{owner.name}</span>
          </span>
        )}
      </label>
    );
  };

  const insideTitle =
    mode === 'split' ? 'Остаются в линии' : 'В линии';
  const outsideTitle =
    mode === 'split' ? 'Уйдут в новую линию' : 'Вне линии';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'split' ? 'Разделить линию' : 'Состав линии'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-2 p-3 border-b border-slate-800">
          <span
            className="w-3 h-3 rounded-full mt-1 shrink-0"
            style={{ backgroundColor: color }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-white truncate">
              {mode === 'split' ? 'Разделить линию' : 'Состав линии'}
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {line.name} · {LINE_PRESETS[line.purpose].label}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 p-1 rounded shrink-0"
            title="Закрыть"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {insideTitle} ({inside.length})
              </span>
              {mode === 'edit' && inside.length > 0 && (
                <button
                  onClick={() =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      inside.forEach((device) => next.delete(device.id));
                      return next;
                    })
                  }
                  className="text-[9px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
                >
                  снять все
                </button>
              )}
            </div>
            {inside.length === 0 ? (
              <p className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1.5">
                {mode === 'split'
                  ? 'Отметьте хотя бы один прибор, который останется в линии.'
                  : 'На линии нет приборов. Отметьте приборы ниже.'}
              </p>
            ) : (
              <div className="space-y-1">{inside.map(renderDeviceRow)}</div>
            )}
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              {outsideTitle} ({outside.length})
            </div>
            {outside.length === 0 ? (
              <p className="text-[10px] text-slate-500 px-1">
                {mode === 'split'
                  ? 'Все приборы линии отмечены — делить нечего.'
                  : 'Все приборы уже в этой линии.'}
              </p>
            ) : (
              <div className="space-y-2">
                {groups.map((group) => (
                  <div key={group.roomId || 'none'}>
                    <div className="text-[9px] text-slate-500 mb-1 px-1">
                      {group.roomName}
                    </div>
                    <div className="space-y-1">
                      {group.devices.map(renderDeviceRow)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[9px] text-slate-500 leading-snug">
            {mode === 'split'
              ? 'Отмеченные приборы останутся в текущей линии, снятые перейдут в новую. Защита новой линии пересчитается по её нагрузке.'
              : 'Прибор входит только в одну линию. Отмеченные приборы будут перенесены в эту линию из других линий или из списка «вне линий».'}
          </p>
        </div>

        <div className="p-3 border-t border-slate-800 space-y-2">
          {mode === 'split' ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400 shrink-0">
                  Новая линия:
                </span>
                <select
                  value={newPurpose}
                  onChange={(event) =>
                    setNewPurpose(event.target.value as LinePurpose)
                  }
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  {LINE_PURPOSES.map((purpose) => (
                    <option key={purpose} value={purpose}>
                      {LINE_PRESETS[purpose].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-mono text-slate-500">
                  остаётся {remainCount} · уйдёт {moveCount}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={onClose}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold transition"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={handleSplit}
                    disabled={moveCount === 0 || remainCount === 0}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-[10px] font-bold transition"
                  >
                    <Scissors size={12} />
                    Разделить
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-mono text-slate-500">
                в линии {selected.size} из {devices.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onClose}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold transition"
                >
                  Отмена
                </button>
                <button
                  onClick={handleSave}
                  disabled={unchanged}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold transition"
                >
                  <Check size={12} />
                  Сохранить
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

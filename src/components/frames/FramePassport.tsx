import React, { useMemo, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import {
  DEVICE_CATALOG,
  DEVICE_TYPES,
  deviceLineSlotCount,
  deviceSlotLabel,
  isMechanismType,
} from '../../core/electrical/devices';
import {
  freeDeviceSlots,
  linesOfDevice,
} from '../../core/electrical/lineAssignment';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { FRAME_POSTS_OPTIONS } from '../../core/electrical/frames';
import { SquareDashed, Trash2 } from 'lucide-react';
import type {
  DeviceType,
  ElectricalDevice,
  ElectricalPanel,
  FramePosts,
} from '../../types';

interface FramePassportProps {
  frameId: string;
  onClose: () => void;
}

/** Группы механизмов для выпадающего списка места: розетки и выключатели. */
const SEAT_GROUPS: { id: 'socket' | 'switch'; label: string }[] = [
  { id: 'socket', label: 'Розетки' },
  { id: 'switch', label: 'Выключатели' },
];

const mechanismTypesByGroup = (group: 'socket' | 'switch'): DeviceType[] =>
  DEVICE_TYPES.filter(
    (type) => isMechanismType(type) && DEVICE_CATALOG[type].group === group
  );

/** Линии механизма: имя линии и, у многоклавишных, конкретные клавиши. */
const SeatLines: React.FC<{
  device: ElectricalDevice;
  panel: ElectricalPanel | null;
  lineColors: Map<string, string>;
}> = ({ device, panel, lineColors }) => {
  const memberships = linesOfDevice(panel, device);
  const slotCount = deviceLineSlotCount(device);
  const free = slotCount > 1 ? freeDeviceSlots(panel, device) : [];
  const partial = (slots: number[]) =>
    slotCount > 1 && slots.length > 0 && slots.length < slotCount;

  return (
    <div className="ml-5 flex flex-wrap items-center gap-1 text-[9px] leading-tight">
      {memberships.length === 0 && (
        <span className="rounded border border-dashed border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-500">
          Без линии
        </span>
      )}
      {memberships.map(({ line, slots }) => (
        <span
          key={line.id}
          className="inline-flex max-w-full items-center gap-1 rounded border border-slate-800 bg-slate-900 px-1 py-0.5 text-slate-400"
          title={`Линия «${line.name}»${
            partial(slots)
              ? `: ${slots.map((slot) => deviceSlotLabel(device, slot)).join(', ')}`
              : ''
          }`}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: lineColors.get(line.id) ?? '#38bdf8' }}
          />
          <span className="max-w-[96px] truncate">{line.name}</span>
          {partial(slots) && (
            <span className="text-slate-500">
              · {slots.map((slot) => deviceSlotLabel(device, slot)).join(', ')}
            </span>
          )}
        </span>
      ))}
      {free.length > 0 && (
        <span className="rounded border border-dashed border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-500">
          свободна: {free.map((slot) => deviceSlotLabel(device, slot)).join(', ')}
        </span>
      )}
    </div>
  );
};

const FrameHeightField: React.FC<{
  frameId: string;
  heightMm: number;
  onCommit: (id: string, heightMm: number) => void;
}> = ({ frameId, heightMm, onCommit }) => {
  const [draft, setDraft] = useState(String(heightMm));
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(frameId, parsed);
    else setDraft(String(heightMm));
  };
  return (
    <label className="block">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
        Высота от пола, мм
      </span>
      <input
        type="number"
        step={10}
        min={0}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-sky-500"
      />
    </label>
  );
};

export const FramePassport: React.FC<FramePassportProps> = ({
  frameId,
  onClose,
}) => {
  const {
    frames,
    devices,
    panel,
    setFramePosts,
    setFrameMounting,
    setFrameHeight,
    setFrameSeatType,
    deleteFrame,
  } = useProjectStore();

  const frame = frames.find((candidate) => candidate.id === frameId) ?? null;
  const lineColors = useMemo(() => buildLineColorMap(panel), [panel]);

  const seats = useMemo(() => {
    if (!frame) return [];
    return Array.from({ length: frame.posts }, (_, seatIndex) => {
      const device =
        devices.find(
          (candidate) =>
            candidate.frameId === frame.id && candidate.seatIndex === seatIndex
        ) ?? null;
      return { seatIndex, device };
    });
  }, [frame, devices]);

  const socketTypes = useMemo(() => mechanismTypesByGroup('socket'), []);
  const switchTypes = useMemo(() => mechanismTypesByGroup('switch'), []);

  if (!frame) return null;

  return (
    <div className="rounded-xl border border-sky-500/40 bg-slate-950/70 p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <SquareDashed size={12} className="text-sky-400 shrink-0" />
            <span className="truncate">
              Подрозетник · {frame.posts} {frame.posts === 1 ? 'место' : 'места'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {frame.mounting === 'flush' ? 'Скрытая' : 'Накладная'} · H{' '}
            {frame.heightFromFloorMm} мм · занято {seats.filter((seat) => seat.device).length}{' '}
            из {frame.posts}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 p-1 rounded shrink-0"
          title="Закрыть паспорт"
          aria-label="Закрыть паспорт подрозетника"
        >
          ×
        </button>
      </div>

      <div>
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
          Монтаж
        </span>
        <div className="mt-0.5 grid grid-cols-2 gap-0.5">
          {(
            [
              { id: 'flush', label: 'Скрытая' },
              { id: 'surface', label: 'Накладная' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFrameMounting(frame.id, option.id)}
              className={`rounded py-1 text-[10px] font-semibold transition ${
                frame.mounting === option.id
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
          Число мест
        </span>
        <div className="mt-0.5 grid grid-cols-4 gap-0.5">
          {FRAME_POSTS_OPTIONS.map((posts: FramePosts) => (
            <button
              key={posts}
              type="button"
              onClick={() => setFramePosts(frame.id, posts)}
              className={`rounded py-1 text-[10px] font-mono font-semibold transition ${
                frame.posts === posts
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
              title={`Подрозетник на ${posts} ${posts === 1 ? 'место' : 'места'}`}
            >
              {posts}
            </button>
          ))}
        </div>
      </div>

      <FrameHeightField
        key={`${frame.id}:${frame.heightFromFloorMm}`}
        frameId={frame.id}
        heightMm={frame.heightFromFloorMm}
        onCommit={setFrameHeight}
      />

      <div className="space-y-1">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
          Места
        </span>
        {seats.map(({ seatIndex, device }) => (
          <div key={seatIndex} className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-center font-mono text-[10px] text-slate-500">
                {seatIndex + 1}
              </span>
              <select
                value={device?.type ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setFrameSeatType(
                    frame.id,
                    seatIndex,
                    value ? (value as DeviceType) : null
                  );
                }}
                className="min-w-0 flex-1 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                title={device ? device.name : 'Место свободно'}
              >
                <option value="">Заглушка</option>
                {SEAT_GROUPS.map((group) => {
                  const types = group.id === 'socket' ? socketTypes : switchTypes;
                  if (types.length === 0) return null;
                  return (
                    <optgroup key={group.id} label={group.label}>
                      {types.map((type) => (
                        <option key={type} value={type}>
                          {DEVICE_CATALOG[type].label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
            {device && (
              <SeatLines device={device} panel={panel} lineColors={lineColors} />
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => {
          deleteFrame(frame.id);
          onClose();
        }}
        className="w-full flex items-center justify-center gap-1.5 py-1 rounded-lg border border-slate-800 bg-slate-900/60 hover:border-rose-500/50 hover:text-rose-400 text-slate-400 text-[10px] font-semibold transition"
      >
        <Trash2 size={11} />
        Удалить подрозетник
      </button>
    </div>
  );
};

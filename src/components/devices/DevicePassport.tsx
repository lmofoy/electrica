import React, { useMemo, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import {
  DEVICE_CATALOG,
  DEVICE_NOTE_MAX_CHARS,
  resolveDevice,
  type ResolvedDevice,
} from '../../core/electrical/devices';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { Plug, Repeat2, Trash2 } from 'lucide-react';

interface DevicePassportProps {
  deviceId: string;
  onClose: () => void;
}

const DeviceNoteField: React.FC<{
  deviceId: string;
  note: string | undefined;
  onCommit: (id: string, note: string) => void;
}> = ({ deviceId, note, onCommit }) => {
  const [draft, setDraft] = useState(note ?? '');
  const commit = () => onCommit(deviceId, draft);
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
        Заметка для плана
      </span>
      <textarea
        value={draft}
        maxLength={DEVICE_NOTE_MAX_CHARS}
        rows={2}
        placeholder="Например: над столешницей"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        className="mt-1 w-full resize-none bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
      />
      <span className="mt-0.5 block text-[9px] text-slate-500 leading-snug">
        Печатается с выноской у прибора; пустое поле — без подписи.
      </span>
    </label>
  );
};

export const DevicePassport: React.FC<DevicePassportProps> = ({
  deviceId,
  onClose,
}) => {
  const {
    rooms,
    devices,
    freePartitions,
    settings,
    panel,
    setHighlightedLine,
    assignDevicesToLine,
    unassignDevicesFromLines,
    setDeviceNote,
    deleteDevice,
  } = useProjectStore();

  const resolvedDevices = useMemo(
    () =>
      devices
        .map((device) =>
          resolveDevice(
            device,
            rooms,
            freePartitions,
            settings.defaultWallThicknessMm
          )
        )
        .filter((device): device is ResolvedDevice => device !== null),
    [devices, rooms, freePartitions, settings.defaultWallThicknessMm]
  );

  const lineColors = useMemo(() => buildLineColorMap(panel), [panel]);

  const selected =
    resolvedDevices.find((item) => item.device.id === deviceId) ?? null;
  if (!selected) return null;

  const selectedLine =
    panel?.lines.find((line) => line.deviceIds.includes(selected.device.id)) ??
    null;

  const selectedRoomNames = selected.roomIds
    .map((roomId) => rooms.find((room) => room.id === roomId)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="rounded-xl border border-sky-500/40 bg-slate-950/70 p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Plug size={12} className="text-sky-400 shrink-0" />
            <span className="truncate">{selected.device.name}</span>
            {selected.isShared && (
              <span
                className="flex items-center gap-0.5 text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 shrink-0"
                title="Сквозной прибор принадлежит двум смежным комнатам"
              >
                <Repeat2 size={9} />2 комн.
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {DEVICE_CATALOG[selected.device.type].label}
            {selectedRoomNames.length > 0 && ` · ${selectedRoomNames.join(', ')}`}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 p-1 rounded shrink-0"
          title="Закрыть паспорт"
        >
          ×
        </button>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-slate-400">
        <span>
          H{' '}
          <strong className="text-slate-200">
            {selected.device.heightFromFloorMm} мм
          </strong>
        </span>
        {selected.device.powerWatts > 0 && (
          <span>
            <strong className="text-slate-200">{selected.device.powerWatts} Вт</strong>
          </span>
        )}
        <span>
          Установка:{' '}
          <strong className="text-slate-200">
            {DEVICE_CATALOG[selected.device.type].mounting === 'ceiling'
              ? 'потолок'
              : 'стена'}
          </strong>
        </span>
      </div>

      <DeviceNoteField
        key={`${selected.device.id}:${selected.device.note ?? ''}`}
        deviceId={selected.device.id}
        note={selected.device.note}
        onCommit={setDeviceNote}
      />

      {panel && panel.lines.length > 0 ? (
        <label className="block">
          <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
            Линия прибора
            {selectedLine && (
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: lineColors.get(selectedLine.id) ?? '#38bdf8',
                }}
              />
            )}
          </span>
          <select
            value={selectedLine?.id ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) {
                unassignDevicesFromLines([selected.device.id]);
                setHighlightedLine(null);
                return;
              }
              const targetLine = panel.lines.find((line) => line.id === value);
              if (
                selectedLine &&
                targetLine &&
                selectedLine.id !== value &&
                !confirm(
                  `Перенести «${selected.device.name}» из линии «${selectedLine.name}» в «${targetLine.name}»? Прибор будет удалён из старой линии.`
                )
              ) {
                return;
              }
              assignDevicesToLine(value, [selected.device.id]);
              setHighlightedLine(value);
            }}
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="">Без линии</option>
            {panel.lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[10px] text-slate-500 leading-snug">
          {panel
            ? 'Линий пока нет — они создаются на шаге «Трассировка».'
            : 'Линии появятся после размещения щитка.'}
        </p>
      )}

      <button
        onClick={() => {
          deleteDevice(selected.device.id);
          onClose();
        }}
        className="w-full flex items-center justify-center gap-1.5 py-1 rounded-lg border border-slate-800 bg-slate-900/60 hover:border-rose-500/50 hover:text-rose-400 text-slate-400 text-[10px] font-semibold transition"
      >
        <Trash2 size={11} />
        Удалить прибор
      </button>
    </div>
  );
};

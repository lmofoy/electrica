import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Droplets,
  GitFork,
  GripVertical,
  Lightbulb,
  ListOrdered,
  Lock,
  MapPin,
  PenLine,
  Plug,
  Plus,
  RotateCcw,
  Square,
  ToggleLeft,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CircuitLine,
  DeviceType,
  ElectricalDevice,
  ManualRoute,
} from '../../types';
import { DEVICE_CATALOG } from '../../core/electrical/devices';
import {
  manualRouteBranches,
  type ManualRouteStop,
} from '../../core/electrical/manualRoute';

interface RouteStopsPopoverProps {
  line: CircuitLine;
  route: ManualRoute;
  color: string;
  devices: ElectricalDevice[];
  selectedNode: number | null;
  bounds: { width: number; height: number };
  cableLengthMm: number;
  error: string | null;
  assignActive: boolean;
  onSelectNode: (index: number | null) => void;
  onReorder: (branchIndex: number, fromIndex: number, toIndex: number) => void;
  onRemoveNode: (nodeIndex: number) => void;
  onReset: () => void;
  onAddDevices: () => void;
  onBeginManualDraw: () => void;
  onClose: () => void;
}

interface DragSource {
  branchIndex: number;
  index: number;
}

const CARD_WIDTH = 326;

function deviceIcon(type: DeviceType) {
  const entry = DEVICE_CATALOG[type];
  if (entry.group === 'light') return Lightbulb;
  if (entry.group === 'switch') return ToggleLeft;
  return entry.ipRating !== 'IP20' ? Droplets : Plug;
}

function stopMeta(
  stop: ManualRouteStop,
  device: ElectricalDevice | undefined,
  point: { x: number; y: number },
  order: number
): { title: string; subtitle: string; tone: string; Icon: typeof Plug } {
  if (stop.kind === 'panel') {
    return {
      title: 'Щиток',
      subtitle: 'начало линии · закреплён',
      tone: '#94a3b8',
      Icon: Square,
    };
  }
  if (stop.kind === 'device') {
    const catalog = device ? DEVICE_CATALOG[device.type] : null;
    return {
      title: device?.name ?? 'Прибор',
      subtitle: catalog
        ? `${catalog.label}${device && device.powerWatts > 0 ? ` · ${device.powerWatts} Вт` : ''}`
        : 'прибор линии',
      tone: '#38bdf8',
      Icon: device ? deviceIcon(device.type) : Plug,
    };
  }
  if (stop.kind === 'junction') {
    return {
      title: 'Стык (ветвление)',
      subtitle: 'здесь кабель расходится на ветви',
      tone: '#fbbf24',
      Icon: GitFork,
    };
  }
  return {
    title: `Точка ${order}`,
    subtitle: `X ${Math.round(point.x)} · Y ${Math.round(point.y)} мм`,
    tone: '#34d399',
    Icon: MapPin,
  };
}

/**
 * Плавающий список порядка линии: ветви трассы, внутри каждой — щиток,
 * приборы, стыки и точки в том порядке, в котором их обходит кабель.
 * Перетаскивание строки перестраивает только эту ветвь; сами приборы и
 * щиток на плане не двигаются. Панель можно таскать за шапку.
 */
export const RouteStopsPopover: React.FC<RouteStopsPopoverProps> = ({
  line,
  route,
  color,
  devices,
  selectedNode,
  bounds,
  cableLengthMm,
  error,
  assignActive,
  onSelectNode,
  onReorder,
  onRemoveNode,
  onReset,
  onAddDevices,
  onBeginManualDraw,
  onClose,
}) => {
  const branches = useMemo(() => manualRouteBranches(route), [route]);
  const deviceById = useMemo(
    () => new Map(devices.map((device) => [device.id, device] as const)),
    [devices]
  );
  // Прибор может быть в линии, но ещё не на трассе: список показывает и его,
  // отдельной группой, чтобы состав линии всегда был виден целиком.
  const connectedDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const branch of branches) {
      for (const stop of branch.stops) {
        if (stop.kind === 'device' && stop.deviceId) ids.add(stop.deviceId);
      }
    }
    return ids;
  }, [branches]);
  const unconnectedDevices = useMemo(
    () =>
      line.deviceIds
        .filter((id) => !connectedDeviceIds.has(id))
        .map((id) => deviceById.get(id))
        .filter((device): device is ElectricalDevice => Boolean(device)),
    [line.deviceIds, connectedDeviceIds, deviceById]
  );
  const connectedCount = line.deviceIds.filter((id) =>
    connectedDeviceIds.has(id)
  ).length;
  const panelDragRef = useRef<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [panelDragging, setPanelDragging] = useState(false);
  const [position, setPosition] = useState(() => ({
    x: Math.max(8, bounds.width - CARD_WIDTH - 16),
    y: 132,
  }));
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [over, setOver] = useState<DragSource | null>(null);

  const clamp = useCallback(
    (next: { x: number; y: number }) => ({
      x: Math.min(Math.max(8, next.x), Math.max(8, bounds.width - CARD_WIDTH - 8)),
      // Высота карточки и так ограничена maxHeight, поэтому для вертикали
      // достаточно оставить на экране шапку и несколько строк.
      y: Math.min(Math.max(8, next.y), Math.max(8, bounds.height - 140)),
    }),
    [bounds.width, bounds.height]
  );

  // Позиция ограничивается рамкой холста при отрисовке: отдельный эффект
  // не нужен, панель не выходит за пределы экрана при изменении размеров окна.
  const safePosition = clamp(position);

  const canReset = Boolean(
    line.manualRoute || line.waypoints?.length || line.trace === 'none'
  );

  const move = (branchIndex: number, index: number, delta: number) => {
    const stops = branches[branchIndex]?.stops ?? [];
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    if (stops[index].kind === 'panel') return;
    if (target === 0 && stops[0].kind === 'panel') return;
    onReorder(branchIndex, index, target);
  };

  const handleDrop = (branchIndex: number, index: number) => {
    if (!drag || drag.branchIndex !== branchIndex) return;
    if (drag.index !== index) onReorder(branchIndex, drag.index, index);
    setDrag(null);
    setOver(null);
  };

  return (
    <div
      data-route-stops="panel"
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
          <ListOrdered size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold text-white leading-tight truncate">
            Список точек
          </div>
          <div className="text-[9px] text-slate-400 leading-tight truncate">
            {line.name} · приборов {line.deviceIds.length}
            {line.deviceIds.length > 0 && ` (на трассе ${connectedCount})`} ·{' '}
            {cableLengthMm > 0
              ? `кабель ${(cableLengthMm / 1000).toFixed(1)} м`
              : 'трасса не проложена'}
          </div>
        </div>
        <button
          onClick={() => setCollapsed((value) => !value)}
          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title={collapsed ? 'Развернуть список' : 'Свернуть список'}
          aria-label={collapsed ? 'Развернуть список' : 'Свернуть список'}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Выйти из монтажа линии"
          aria-label="Выйти из монтажа линии"
        >
          <X size={14} />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="route-stops-scroll flex-1 overflow-y-auto px-2 py-2 space-y-2.5">
            {branches.length === 0 && (
              <p className="text-[10px] text-slate-400 px-1 py-3 text-center leading-snug">
                {line.deviceIds.length === 0
                  ? 'В линии пока нет приборов — добавьте их кнопкой «Приборы».'
                  : 'Трасса не проложена — приборы линии перечислены ниже. Проведите кабель вручную или нажмите «Сбросить к авто».'}
              </p>
            )}

            {branches.map((branch, branchOrder) => {
              const single = branches.length === 1;
              return (
                <section key={branchOrder} data-route-branch={branchOrder}>
                  <div className="flex items-center gap-1.5 px-1 mb-1">
                    <span
                      className="flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold shrink-0"
                      style={{ backgroundColor: `${color}26`, color }}
                    >
                      {branchOrder + 1}
                    </span>
                    <span className="text-[10px] font-bold text-slate-200 truncate">
                      {single ? 'Основная цепочка' : `Ветвь ${branchOrder + 1}`}
                    </span>
                    <span className="ml-auto shrink-0 text-[9px] font-mono text-slate-500">
                      {branch.stops.length} · {(branch.lengthMm / 1000).toFixed(1)} м
                    </span>
                  </div>

                  <div className="space-y-1">
                    {branch.stops.map((stop, index) => {
                      const point = route.nodes[stop.nodeIndex];
                      if (!point) return null;
                      const device = stop.deviceId
                        ? deviceById.get(stop.deviceId)
                        : undefined;
                      const meta = stopMeta(stop, device, point, index + 1);
                      const Icon = meta.Icon;
                      const isPanel = stop.kind === 'panel';
                      const selected = selectedNode === stop.nodeIndex;
                      const dragging =
                        drag?.branchIndex === branchOrder && drag.index === index;
                      const dropHere =
                        over?.branchIndex === branchOrder &&
                        over.index === index &&
                        drag !== null &&
                        !dragging;
                      const canUp =
                        !isPanel && index > (branch.stops[0].kind === 'panel' ? 1 : 0);
                      const canDown = !isPanel && index < branch.stops.length - 1;

                      return (
                        <div key={`${branchOrder}-${stop.nodeIndex}-${index}`} className="relative">
                          {dropHere && (
                            <div
                              className="route-stops-drop absolute -top-[3px] left-1 right-1 h-0.5 rounded-full pointer-events-none"
                              style={{ backgroundColor: color }}
                            />
                          )}
                          <div
                            data-route-stop={index}
                            data-route-stop-kind={stop.kind}
                            draggable={!isPanel}
                            onDragStart={(event) => {
                              if (isPanel) {
                                event.preventDefault();
                                return;
                              }
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', String(index));
                              setDrag({ branchIndex: branchOrder, index });
                              onSelectNode(stop.nodeIndex);
                            }}
                            onDragEnd={() => {
                              setDrag(null);
                              setOver(null);
                            }}
                            onDragOver={(event) => {
                              if (!drag || drag.branchIndex !== branchOrder) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                              if (over?.index !== index || over.branchIndex !== branchOrder) {
                                setOver({ branchIndex: branchOrder, index });
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleDrop(branchOrder, index);
                            }}
                            onClick={() => onSelectNode(stop.nodeIndex)}
                            className={`group relative flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-all duration-150 ${
                              isPanel ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                            } ${
                              selected
                                ? 'bg-slate-800/80 border-transparent'
                                : 'bg-slate-950/60 border-slate-800 hover:bg-slate-800/50 hover:border-slate-700'
                            } ${dragging ? 'opacity-40 scale-[0.98]' : ''}`}
                            style={
                              selected
                                ? { boxShadow: `0 0 0 1.5px ${color}, 0 0 14px -4px ${color}` }
                                : undefined
                            }
                            title={
                              isPanel
                                ? 'Щиток всегда первый: это начало линии'
                                : 'Перетащите строку или используйте стрелки — линия перестроится в этом порядке'
                            }
                          >
                            <span
                              className="shrink-0 text-slate-600 group-hover:text-slate-400 transition"
                              aria-hidden
                            >
                              {isPanel ? <Lock size={11} /> : <GripVertical size={12} />}
                            </span>
                            <span
                              className="flex items-center justify-center w-5 h-5 rounded-md shrink-0 text-[9px] font-bold"
                              style={{ backgroundColor: `${meta.tone}1f`, color: meta.tone }}
                            >
                              {index + 1}
                            </span>
                            <span
                              className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                              style={{ backgroundColor: `${meta.tone}14`, color: meta.tone }}
                            >
                              <Icon size={12} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[10.5px] font-semibold text-slate-100 truncate leading-tight">
                                {meta.title}
                              </span>
                              <span className="block text-[9px] text-slate-500 truncate leading-tight">
                                {meta.subtitle}
                              </span>
                            </span>
                            <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  move(branchOrder, index, -1);
                                }}
                                disabled={!canUp}
                                className="p-0.5 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition"
                                title="Поднять на одну позицию"
                                aria-label="Поднять на одну позицию"
                              >
                                <ChevronUp size={12} />
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  move(branchOrder, index, 1);
                                }}
                                disabled={!canDown}
                                className="p-0.5 rounded text-slate-400 hover:text-sky-300 hover:bg-slate-800 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition"
                                title="Опустить на одну позицию"
                                aria-label="Опустить на одну позицию"
                              >
                                <ChevronDown size={12} />
                              </button>
                              {stop.kind === 'point' && (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onRemoveNode(stop.nodeIndex);
                                  }}
                                  className="p-0.5 rounded text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition"
                                  title="Удалить точку: участок между соседями перестроится под 90°"
                                  aria-label="Удалить точку"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {branch.stops.length > 1 && (
                      <div
                        onDragOver={(event) => {
                          if (!drag || drag.branchIndex !== branchOrder) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setOver({
                            branchIndex: branchOrder,
                            index: branch.stops.length - 1,
                          });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDrop(branchOrder, branch.stops.length - 1);
                        }}
                        className={`h-4 mx-1 rounded-md border border-dashed transition ${
                          over?.branchIndex === branchOrder &&
                          over.index === branch.stops.length - 1 &&
                          drag !== null
                            ? 'border-transparent'
                            : 'border-slate-800/70'
                        }`}
                        style={
                          over?.branchIndex === branchOrder &&
                          over.index === branch.stops.length - 1 &&
                          drag !== null
                            ? { backgroundColor: `${color}33` }
                            : undefined
                        }
                        title="Бросить сюда — поставить в конец ветви"
                      />
                    )}
                  </div>
                </section>
              );
            })}

            {unconnectedDevices.length > 0 && (
              <section data-route-unconnected={unconnectedDevices.length}>
                <div className="flex items-center gap-1.5 px-1 mb-1">
                  <span
                    className="flex items-center justify-center w-4 h-4 rounded shrink-0"
                    style={{ backgroundColor: '#f59e0b26', color: '#fbbf24' }}
                  >
                    <AlertTriangle size={9} />
                  </span>
                  <span className="text-[10px] font-bold text-amber-200 truncate">
                    Не на трассе
                  </span>
                  <span className="ml-auto shrink-0 text-[9px] font-mono text-slate-500">
                    {unconnectedDevices.length} приб.
                  </span>
                </div>
                <div className="space-y-1">
                  {unconnectedDevices.map((device) => {
                    const catalog = DEVICE_CATALOG[device.type];
                    const Icon = deviceIcon(device.type);
                    return (
                      <div
                        key={device.id}
                        data-route-unconnected-device={device.id}
                        className="flex items-center gap-1.5 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 px-1.5 py-1"
                        title="Прибор в линии, но кабель к нему ещё не проложен: «Сбросить к авто» или «Проложить вручную» добавят его в трассу"
                      >
                        <span className="flex items-center justify-center w-5 h-5 rounded-md shrink-0 text-[9px] font-bold text-amber-300/80 bg-amber-500/10">
                          ·
                        </span>
                        <span
                          className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
                          style={{ backgroundColor: '#f59e0b14', color: '#fbbf24' }}
                        >
                          <Icon size={12} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10.5px] font-semibold text-amber-100/90 truncate leading-tight">
                            {device.name}
                          </span>
                          <span className="block text-[9px] text-slate-500 truncate leading-tight">
                            {catalog.label}
                            {device.powerWatts > 0 ? ` · ${device.powerWatts} Вт` : ''} · в
                            линии, нет в трассе
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <div className="px-2.5 py-2 border-t border-slate-800 space-y-1.5 bg-slate-950/40">
            {error && (
              <p className="text-[9px] text-rose-400 font-semibold leading-snug">{error}</p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={onAddDevices}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-semibold transition ${
                  assignActive
                    ? 'bg-emerald-500 border-emerald-400 text-slate-950 shadow-[0_0_12px_-2px_rgba(16,185,129,0.7)]'
                    : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-300'
                }`}
                title={
                  assignActive
                    ? 'Кликайте приборы на плане — они сразу появляются в списке. Повторное нажатие или Enter — закончить.'
                    : 'Добавлять приборы этой линии кликами на плане'
                }
              >
                <Plus size={11} />
                {assignActive ? 'Добавление…' : 'Приборы'}
              </button>
              <button
                onClick={onBeginManualDraw}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-bold transition"
                title="Провести трассу по плану вручную"
              >
                <PenLine size={11} />
                Проложить вручную
              </button>
              <button
                onClick={onReset}
                disabled={!canReset}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="Построить автоматическую трассу и порядок по ближайшему прибору"
              >
                <RotateCcw size={11} />
                Сбросить к авто
              </button>
              <button
                onClick={onClose}
                className="ml-auto px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
              >
                Готово
              </button>
            </div>
            <p className="text-[9px] text-slate-500 leading-snug">
              {assignActive
                ? 'Клик по прибору на плане — добавить или убрать его из линии, список обновляется сразу. Enter — закончить, Esc — отменить изменения состава. Трасса к новым приборам появится после «Сбросить к авто» или ручной прокладки.'
                : 'Перетащите строку — кабель пойдёт строго в этом порядке, перестроится только эта ветвь. Клик по линии — вставить точку, Delete — удалить, Esc — выйти. Приборы и щиток на плане не двигаются. Стык — место ветвления, не распределительная коробка.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
};
import React, { useState } from 'react';
import type { ElectricalPanel } from '../../types';
import {
  INPUT_ZONE_ID,
  type PanelLayout,
  type PanelLayoutItem,
  type PanelLayoutZone,
} from '../../core/electrical/panelLayout';
import { buildLineColorMap, lineColorFor } from '../../core/electrical/lineColors';

interface PanelSchemeProps {
  panel: ElectricalPanel;
  layout: PanelLayout;
  highlightedLineId: string | null;
  onHighlight: (id: string | null) => void;
  onMoveItem: (itemId: string, targetIndex: number) => void;
  onResetOrder: () => void;
}

function zoneColor(zone: PanelLayoutZone): string {
  if (zone.id === INPUT_ZONE_ID) return '#f59e0b';
  if (zone.colorIndex !== undefined) return lineColorFor(zone.colorIndex);
  return '#64748b';
}

function itemZoneColor(item: PanelLayoutItem): string {
  if (!item.zoneId || item.zoneId === INPUT_ZONE_ID) return '#f59e0b';
  if (item.zoneColorIndex !== undefined) return lineColorFor(item.zoneColorIndex);
  return '#64748b';
}

const TONE_CLASS: Record<PanelLayoutItem['tone'], string> = {
  input: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  protection: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  line: 'bg-sky-500/15 border-sky-500/40 text-sky-200',
};

interface ItemCellProps {
  item: PanelLayoutItem;
  active: boolean;
  color: string | null;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onToggle: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (before: boolean) => void;
  onDrop: (before: boolean) => void;
}

const ItemCell: React.FC<ItemCellProps> = ({
  item,
  active,
  color,
  dragging,
  dropBefore,
  dropAfter,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}) => {
  const dropShadow = dropBefore
    ? 'inset 2px 0 0 0 #38bdf8'
    : dropAfter
      ? 'inset -2px 0 0 0 #38bdf8'
      : null;
  const shadows = [
    ...(active && color ? [`0 0 0 1px ${color}`, `0 0 8px ${color}66`] : []),
    ...(dropShadow ? [dropShadow] : []),
  ];
  return (
    <div
      role={item.lineId ? 'button' : undefined}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        onDragOver(event.clientX < rect.left + rect.width / 2);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onDrop(event.clientX < rect.left + rect.width / 2);
      }}
      onClick={() => item.lineId && onToggle(item.lineId)}
      className={`relative flex flex-col items-center justify-center rounded-md border px-1 py-1 overflow-hidden transition ${
        TONE_CLASS[item.tone]
      } ${item.lineId ? 'cursor-pointer hover:brightness-125' : ''} ${
        dragging ? 'opacity-40' : ''
      } ${item.lineId ? 'active:cursor-grabbing' : 'cursor-grab'}`}
      style={{
        gridColumn: `span ${item.modules}`,
        ...(active && color
          ? { borderColor: color, backgroundColor: `${color}2e` }
          : undefined),
        ...(shadows.length > 0 ? { boxShadow: shadows.join(', ') } : undefined),
      }}
      title={`${item.sublabel} · ${item.modules} мод. · зона «${item.zoneName ?? '—'}»${
        item.lineId ? ' · клик — подсветить линию, перетаскивание — порядок' : ''
      }`}
    >
      <span
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ backgroundColor: itemZoneColor(item) }}
      />
      <span className="text-[10px] font-bold leading-tight truncate w-full text-center">
        {item.label}
      </span>
      <span className="text-[8px] leading-tight opacity-70 truncate w-full text-center">
        {item.sublabel}
      </span>
      {active && color && (
        <span
          className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
    </div>
  );
};

export const PanelScheme: React.FC<PanelSchemeProps> = ({
  panel,
  layout,
  highlightedLineId,
  onHighlight,
  onMoveItem,
  onResetOrder,
}) => {
  const lineColors = buildLineColorMap(panel);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    itemId: string | null;
    rowIndex: number;
    before: boolean;
  } | null>(null);

  const toggle = (id: string) => onHighlight(id === highlightedLineId ? null : id);
  const toneCounts = layout.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {});

  const offsets = layout.rows.map((_, rowIndex) =>
    layout.rows.slice(0, rowIndex).reduce((sum, row) => sum + row.length, 0)
  );
  const flatIndexOf = (id: string): number => {
    for (let rowIndex = 0; rowIndex < layout.rows.length; rowIndex += 1) {
      const index = layout.rows[rowIndex].findIndex((item) => item.id === id);
      if (index !== -1) return offsets[rowIndex] + index;
    }
    return -1;
  };
  const dropAt = (targetFlat: number) => {
    if (!draggingId) return;
    const from = flatIndexOf(draggingId);
    if (from !== -1) {
      const target = from < targetFlat ? targetFlat - 1 : targetFlat;
      if (target !== from) onMoveItem(draggingId, target);
    }
    setDraggingId(null);
    setDropTarget(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white">Компоновка на DIN-рейках</span>
            {layout.manualOrder && (
              <span className="px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300 text-[8px] font-bold uppercase tracking-wider">
                ручной порядок
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400">
            {panel.lines.length} линий · {layout.items.length} аппаратов · перетаскивайте
            аппараты, чтобы изменить порядок
          </div>
          {layout.manualOrder && (
            <button
              onClick={onResetOrder}
              className="mt-1 text-[9px] text-sky-400 hover:text-sky-300 underline decoration-dotted underline-offset-2"
            >
              Сбросить к автоматическому порядку
            </button>
          )}
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-400">Корпус</div>
          <div className="text-lg font-bold font-mono text-sky-300 leading-none">
            {layout.enclosureModules}
          </div>
          <div className="text-[9px] text-slate-500">модулей</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {layout.zones.map((zone) => (
          <span
            key={zone.id}
            className="flex items-center gap-1 text-[9px] text-slate-400"
            title={
              zone.lineIds.length > 0
                ? `Линий в зоне: ${zone.lineIds.length}`
                : 'Аппараты ввода'
            }
          >
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: zoneColor(zone) }}
            />
            {zone.name}
            <span className="text-slate-600 font-mono">{zone.modules}</span>
          </span>
        ))}
      </div>

      <div className="rounded-xl border border-slate-700/80 bg-slate-950/70 p-2.5 space-y-1.5">
        {layout.rows.map((row, rowIndex) => (
          <div key={`rail-${rowIndex}`} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[8px] font-mono text-slate-500 text-right">
              DIN {rowIndex + 1}
            </span>
            <div
              className={`flex-1 grid gap-1 rounded-md bg-slate-900/80 p-1 border transition ${
                dropTarget?.itemId === null && dropTarget.rowIndex === rowIndex
                  ? 'border-sky-500/60'
                  : 'border-slate-800'
              }`}
              style={{
                gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
                backgroundImage:
                  'repeating-linear-gradient(to right, rgba(51,65,85,0.55) 0 1px, transparent 1px calc(100% / 12))',
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget({ itemId: null, rowIndex, before: false });
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropAt(offsets[rowIndex] + row.length);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                if (dropTarget?.itemId === null && dropTarget.rowIndex === rowIndex) {
                  setDropTarget(null);
                }
              }}
            >
              {row.length === 0 && (
                <div className="col-span-12 py-2 text-center text-[9px] text-slate-600">
                  свободная рейка
                </div>
              )}
              {row.map((item, itemIndex) => (
                <ItemCell
                  key={item.id}
                  item={item}
                  active={item.lineId !== undefined && item.lineId === highlightedLineId}
                  color={item.lineId ? lineColors.get(item.lineId) ?? null : null}
                  dragging={draggingId === item.id}
                  dropBefore={
                    dropTarget?.itemId === item.id &&
                    dropTarget.before &&
                    draggingId !== item.id
                  }
                  dropAfter={
                    dropTarget?.itemId === item.id &&
                    !dropTarget.before &&
                    draggingId !== item.id
                  }
                  onToggle={toggle}
                  onDragStart={() => setDraggingId(item.id)}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(before) =>
                    setDropTarget({ itemId: item.id, rowIndex, before })
                  }
                  onDrop={(before) =>
                    dropAt(offsets[rowIndex] + itemIndex + (before ? 0 : 1))
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">Занято</div>
          <div className="text-base font-bold font-mono text-white">
            {layout.modulesTotal}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">Свободно</div>
          <div className="text-base font-bold font-mono text-emerald-400">
            {layout.freeModules}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-center">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">Запас</div>
          <div
            className={`text-base font-bold font-mono ${
              layout.reservePercent >= layout.reserveTarget * 100
                ? 'text-emerald-400'
                : 'text-amber-400'
            }`}
          >
            {Math.round(layout.reservePercent)}%
          </div>
        </div>
      </div>

      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-sky-500"
          style={{ width: `${Math.min(100, (layout.modulesTotal / layout.enclosureModules) * 100)}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-slate-500">
        <span>Ввод {toneCounts.input_breaker ?? 0}</span>
        <span>Счётчик {panel.supply.meter.enabled ? 1 : 0}</span>
        <span>УЗО {toneCounts.main_rcd ?? 0}</span>
        <span>РКН {toneCounts.voltage_relay ?? 0}</span>
        <span>УЗИП {toneCounts.spd ?? 0}</span>
        <span>Автоматы линий {toneCounts.line_breaker ?? 0}</span>
        <span>Дифзащита линий {toneCounts.line_rcd ?? 0}</span>
        {(toneCounts.line_rcbo ?? 0) > 0 && (
          <span>Дифавтоматы {toneCounts.line_rcbo ?? 0}</span>
        )}
      </div>
    </div>
  );
};

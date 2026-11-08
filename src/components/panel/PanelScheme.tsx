import React from 'react';
import type { ElectricalPanel } from '../../types';
import type { PanelLayout, PanelLayoutItem } from '../../core/electrical/panelLayout';

interface PanelSchemeProps {
  panel: ElectricalPanel;
  layout: PanelLayout;
}

const TONE_CLASS: Record<PanelLayoutItem['tone'], string> = {
  input: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  protection: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  line: 'bg-sky-500/15 border-sky-500/40 text-sky-200',
};

const ItemCell: React.FC<{ item: PanelLayoutItem }> = ({ item }) => (
  <div
    className={`relative flex flex-col items-center justify-center rounded-md border px-1 py-1 overflow-hidden ${TONE_CLASS[item.tone]}`}
    style={{ gridColumn: `span ${item.modules}` }}
    title={`${item.sublabel} · ${item.modules} мод.`}
  >
    <span className="text-[10px] font-bold leading-tight truncate w-full text-center">
      {item.label}
    </span>
    <span className="text-[8px] leading-tight opacity-70 truncate w-full text-center">
      {item.sublabel}
    </span>
  </div>
);

export const PanelScheme: React.FC<PanelSchemeProps> = ({ panel, layout }) => {
  const toneCounts = layout.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-white">Компоновка на DIN-рейках</div>
          <div className="text-[10px] text-slate-400">
            {panel.lines.length} линий · {layout.items.length} аппаратов
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-400">Корпус</div>
          <div className="text-lg font-bold font-mono text-sky-300 leading-none">
            {layout.enclosureModules}
          </div>
          <div className="text-[9px] text-slate-500">модулей</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700/80 bg-slate-950/70 p-2.5 space-y-1.5">
        {layout.rows.map((row, rowIndex) => (
          <div key={`rail-${rowIndex}`} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[8px] font-mono text-slate-500 text-right">
              DIN {rowIndex + 1}
            </span>
            <div
              className="flex-1 grid gap-1 rounded-md bg-slate-900/80 p-1 border border-slate-800"
              style={{
                gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
                backgroundImage:
                  'repeating-linear-gradient(to right, rgba(51,65,85,0.55) 0 1px, transparent 1px calc(100% / 12))',
              }}
            >
              {row.length === 0 && (
                <div className="col-span-12 py-2 text-center text-[9px] text-slate-600">
                  свободная рейка
                </div>
              )}
              {row.map((item) => (
                <ItemCell key={item.id} item={item} />
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
      </div>
    </div>
  );
};

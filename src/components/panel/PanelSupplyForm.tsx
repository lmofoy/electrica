import React from 'react';
import type { ElectricalPanel, PanelSupply, RcdSpec } from '../../types';
import { POWER_PRESETS_W, calculateInput, makeRcd } from '../../core/electrical/norms';

interface PanelSupplyFormProps {
  panel: ElectricalPanel;
  onSupply: (updates: Partial<PanelSupply>) => void;
  onPanel: (updates: Partial<Pick<ElectricalPanel, 'mounting' | 'heightFromFloorMm'>>) => void;
}

const Toggle: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}> = ({ checked, onChange, label, hint }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`flex items-start gap-2 rounded-xl border p-2.5 text-left transition ${
      checked
        ? 'bg-sky-500/10 border-sky-500/50'
        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
    }`}
  >
    <span
      className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold shrink-0 ${
        checked
          ? 'bg-sky-500 border-sky-400 text-white'
          : 'border-slate-600 text-transparent'
      }`}
    >
      ✓
    </span>
    <span className="min-w-0">
      <span className="block text-[11px] font-semibold text-slate-200">{label}</span>
      {hint && <span className="block text-[9px] text-slate-500 leading-snug">{hint}</span>}
    </span>
  </button>
);

function mainRcdValue(rcd: RcdSpec | null): string {
  return rcd ? String(rcd.sensitivityMa) : 'off';
}

export const PanelSupplyForm: React.FC<PanelSupplyFormProps> = ({
  panel,
  onSupply,
  onPanel,
}) => {
  const supply = panel.supply;
  const mainRcd = supply.mainRcd;
  const input = calculateInput(supply.allocatedPowerW, supply.cosPhi);

  const handlePowerChange = (watts: number) => {
    const safe = Math.max(1000, Math.min(30000, Math.round(watts / 100) * 100));
    onSupply({ allocatedPowerW: safe });
  };

  const handleMainRcd = (value: string) => {
    if (value === 'off') {
      onSupply({ mainRcd: null });
      return;
    }
    const sensitivityMa = Number(value);
    onSupply({
      mainRcd: makeRcd(sensitivityMa, supply.mainRcd?.type ?? 'A', input.breakerRatingA),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-white">Ввод и питание</div>
          <div className="text-[10px] text-slate-400">
            {supply.phases === 3 ? '3 фазы · 380/220 В ·' : '1 фаза · 230 В ·'} медный
            кабель {supply.inputCable.cores}×
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-400">Расчётный ток</div>
          <div className="text-lg font-bold font-mono text-amber-300 leading-none">
            {input.currentA.toFixed(1)} А
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Выделенная мощность
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {POWER_PRESETS_W.map((preset) => (
            <button
              key={preset}
              onClick={() => handlePowerChange(preset)}
              className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                supply.allocatedPowerW === preset
                  ? 'bg-amber-500 text-slate-950 border-amber-400'
                  : 'bg-slate-950/60 border-slate-700 text-slate-300 hover:border-amber-500/50'
              }`}
            >
              {preset / 1000} кВт
            </button>
          ))}
          <div className="flex items-center gap-1 ml-auto">
            <input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={Number((supply.allocatedPowerW / 1000).toFixed(2))}
              onChange={(e) => handlePowerChange(Number(e.target.value) * 1000)}
              className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
            />
            <span className="text-[10px] text-slate-500">кВт</span>
          </div>
        </div>
        <div className="text-[9px] text-slate-500 mt-1">
          Мощность берётся из ТУ на подключение. Автомат и кабель подобраны по току.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 block">
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">
            Система заземления
          </span>
          <select
            value={supply.system}
            onChange={(e) =>
              onSupply({ system: e.target.value as PanelSupply['system'] })
            }
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
          >
            <option value="TN-S">TN-S</option>
            <option value="TN-C-S">TN-C-S</option>
          </select>
        </label>
        <label className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 block">
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">
            Категория надёжности
          </span>
          <select
            value={supply.reliabilityCategory}
            onChange={(e) =>
              onSupply({
                reliabilityCategory: e.target.value as PanelSupply['reliabilityCategory'],
              })
            }
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
          >
            <option value="I">I</option>
            <option value="II">II</option>
            <option value="III">III</option>
          </select>
        </label>
      </div>

      <label className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 block">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider">
          Марка кабеля
        </span>
        <input
          value={supply.cableBrand}
          onChange={(e) => onSupply({ cableBrand: e.target.value })}
          className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">
            Вводной автомат
          </div>
          <div className="text-sm font-bold font-mono text-white">
            {supply.inputBreaker.ratingA} А · {supply.inputBreaker.poles}P C
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider">
            Вводной кабель
          </div>
          <div className="text-sm font-bold font-mono text-white">
            {supply.inputCable.sectionMm2} мм² · {supply.inputCable.cores} жил
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 block">
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">
            Монтаж
          </span>
          <select
            value={panel.mounting}
            onChange={(e) =>
              onPanel({ mounting: e.target.value as ElectricalPanel['mounting'] })
            }
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
          >
            <option value="flush">Встроенный</option>
            <option value="surface">Накладной</option>
          </select>
        </label>
        <label className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 block">
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">
            Высота, мм
          </span>
          <input
            type="number"
            min={300}
            max={2200}
            step={50}
            value={panel.heightFromFloorMm}
            onChange={(e) =>
              onPanel({ heightFromFloorMm: Number(e.target.value) || 1600 })
            }
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
          />
        </label>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Аппараты ввода
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 block">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">
              Противопожарное УЗО
            </span>
            <select
              value={mainRcdValue(supply.mainRcd)}
              onChange={(e) => handleMainRcd(e.target.value)}
              className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
            >
              <option value="off">Нет</option>
              <option value="30">30 мА</option>
              <option value="100">100 мА</option>
              <option value="300">300 мА</option>
            </select>
          </label>
          <label className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 block">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">
              Тип УЗО
            </span>
            <select
              value={supply.mainRcd?.type ?? 'A'}
              disabled={!supply.mainRcd}
              onChange={(e) =>
                supply.mainRcd &&
                onSupply({
                  mainRcd: { ...supply.mainRcd, type: e.target.value as 'A' | 'AC' },
                })
              }
              className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500 disabled:opacity-40"
            >
              <option value="A">A</option>
              <option value="AC">AC</option>
            </select>
          </label>
        </div>
      </div>

      {mainRcd && (
        <Toggle
          checked={Boolean(mainRcd.selective)}
          onChange={(selective) =>
            onSupply({ mainRcd: { ...mainRcd, selective } })
          }
          label="Селективное УЗО (тип S)"
          hint="Выдержка по времени: первым отключается групповая защита"
        />
      )}

      <div className="grid grid-cols-1 gap-2">
        <Toggle
          checked={supply.meter.enabled}
          onChange={(enabled) => onSupply({ meter: { enabled } })}
          label="Счётчик электроэнергии"
          hint="6 модулей · обычно уже установлен в щите"
        />
        <Toggle
          checked={supply.voltageRelay}
          onChange={(voltageRelay) => onSupply({ voltageRelay })}
          label="РКН — реле контроля напряжения"
          hint="Защита техники от скачков и обрыва нуля"
        />
        <Toggle
          checked={supply.surgeProtection}
          onChange={(surgeProtection) => onSupply({ surgeProtection })}
          label="УЗИП — защита от перенапряжений"
          hint="Обязателен для частных домов с воздушным вводом"
        />
      </div>
    </div>
  );
};

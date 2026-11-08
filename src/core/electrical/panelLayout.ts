import type { CircuitLine, ElectricalPanel, PanelStrategy } from '../../types';
import { CABLE_AMPACITY_A, VOLTAGE_V, COS_PHI, CABLE_SECTIONS } from './norms';

export type PanelItemKind =
  | 'input_breaker'
  | 'meter'
  | 'main_rcd'
  | 'voltage_relay'
  | 'spd'
  | 'line_breaker'
  | 'line_rcd';

export interface PanelLayoutItem {
  id: string;
  kind: PanelItemKind;
  label: string;
  sublabel: string;
  modules: number;
  lineId?: string;
  tone: 'input' | 'protection' | 'line';
}

export interface PanelWarning {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface PanelLayout {
  items: PanelLayoutItem[];
  rows: PanelLayoutItem[][];
  railModules: number;
  rowsCount: number;
  modulesTotal: number;
  requiredModules: number;
  enclosureModules: number;
  freeModules: number;
  reservePercent: number;
  reserveTarget: number;
  warnings: PanelWarning[];
}

export const RAIL_MODULES = 12;
export const ENCLOSURE_SERIES = [12, 24, 36, 48, 60, 72];

export function reserveTargetFor(strategy: PanelStrategy): number {
  switch (strategy) {
    case 'budget':
      return 0.15;
    case 'optimal':
      return 0.22;
    case 'maximum':
      return 0.3;
    default:
      return 0.2;
  }
}

function breakerModules(line: CircuitLine): number {
  return line.breaker.poles;
}

function lineItems(line: CircuitLine): PanelLayoutItem[] {
  const items: PanelLayoutItem[] = [
    {
      id: `${line.id}-breaker`,
      kind: 'line_breaker',
      label: `${line.breaker.ratingA} А`,
      sublabel: `${line.name} · ${line.breaker.poles}P ${line.breaker.curve}`,
      modules: breakerModules(line),
      lineId: line.id,
      tone: 'line',
    },
  ];
  if (line.rcd) {
    items.push({
      id: `${line.id}-rcd`,
      kind: 'line_rcd',
      label: `${line.rcd.sensitivityMa} мА`,
      sublabel: `${line.name} · УЗО ${line.rcd.type}`,
      modules: 2,
      lineId: line.id,
      tone: 'protection',
    });
  }
  return items;
}

function buildItems(panel: ElectricalPanel): PanelLayoutItem[] {
  const supply = panel.supply;
  const items: PanelLayoutItem[] = [];

  items.push({
    id: 'input-breaker',
    kind: 'input_breaker',
    label: `${supply.inputBreaker.ratingA} А`,
    sublabel: `Ввод · ${supply.inputBreaker.poles}P C`,
    modules: supply.inputBreaker.poles,
    tone: 'input',
  });

  if (supply.meter.enabled) {
    items.push({
      id: 'meter',
      kind: 'meter',
      label: 'Счётчик',
      sublabel: 'Учёт электроэнергии',
      modules: 6,
      tone: 'input',
    });
  }

  if (supply.mainRcd) {
    items.push({
      id: 'main-rcd',
      kind: 'main_rcd',
      label: `${supply.mainRcd.sensitivityMa} мА`,
      sublabel: `Противопожарное УЗО ${supply.mainRcd.type}`,
      modules: 2,
      tone: 'protection',
    });
  }

  if (supply.voltageRelay) {
    items.push({
      id: 'voltage-relay',
      kind: 'voltage_relay',
      label: 'РКН',
      sublabel: 'Реле контроля напряжения',
      modules: 2,
      tone: 'protection',
    });
  }

  if (supply.surgeProtection) {
    items.push({
      id: 'spd',
      kind: 'spd',
      label: 'УЗИП',
      sublabel: 'Защита от импульсных перенапряжений',
      modules: 2,
      tone: 'protection',
    });
  }

  for (const line of panel.lines) {
    items.push(...lineItems(line));
  }

  return items;
}

function layoutRows(items: PanelLayoutItem[], totalModules: number): PanelLayoutItem[][] {
  const rows: PanelLayoutItem[][] = [];
  let current: PanelLayoutItem[] = [];
  let used = 0;

  for (const item of items) {
    if (used + item.modules > RAIL_MODULES && current.length > 0) {
      rows.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += item.modules;
  }
  if (current.length > 0) rows.push(current);

  const emptyRows = Math.ceil(totalModules / RAIL_MODULES) - rows.length;
  for (let i = 0; i < emptyRows; i++) rows.push([]);
  return rows;
}

function collectWarnings(panel: ElectricalPanel, modulesTotal: number, enclosureModules: number, freeModules: number, reserveTarget: number): PanelWarning[] {
  const warnings: PanelWarning[] = [];
  const supply = panel.supply;

  if (panel.lines.length === 0) {
    warnings.push({
      id: 'no-lines',
      severity: 'warning',
      message: 'В щитке нет ни одной линии. Добавьте линии или соберите черновик из приборов.',
    });
  }

  const inputAmpacity = CABLE_AMPACITY_A[supply.inputCable.sectionMm2] ?? 0;
  if (supply.inputBreaker.ratingA > inputAmpacity) {
    warnings.push({
      id: 'input-breaker-cable',
      severity: 'error',
      message: `Вводной автомат ${supply.inputBreaker.ratingA} А превышает допуск кабеля ${supply.inputCable.sectionMm2} мм² (${inputAmpacity} А).`,
    });
  }
  if (!(CABLE_SECTIONS as readonly number[]).includes(supply.inputCable.sectionMm2)) {
    warnings.push({
      id: 'input-cable-section',
      severity: 'error',
      message: `Сечение вводного кабеля ${supply.inputCable.sectionMm2} мм² отсутствует в ряду стандартных сечений.`,
    });
  }

  const totalLoad = panel.lines.reduce((sum, line) => sum + line.loadW, 0);
  if (totalLoad > supply.allocatedPowerW) {
    warnings.push({
      id: 'total-load',
      severity: 'warning',
      message: `Суммарная нагрузка ${(totalLoad / 1000).toFixed(1)} кВт превышает выделенную мощность ${(supply.allocatedPowerW / 1000).toFixed(1)} кВт.`,
    });
  }

  const inputCurrent = totalLoad / (VOLTAGE_V * COS_PHI);
  if (inputCurrent > supply.inputBreaker.ratingA) {
    warnings.push({
      id: 'input-current',
      severity: 'warning',
      message: `Расчётный ток ввода ${inputCurrent.toFixed(1)} А превышает номинал вводного автомата ${supply.inputBreaker.ratingA} А.`,
    });
  }

  for (const line of panel.lines) {
    if (line.deviceIds.length === 0) {
      warnings.push({
        id: `line-empty-${line.id}`,
        severity: 'info',
        message: `«${line.name}»: на линии нет приборов — трасса не строится, нагрузка задана вручную.`,
      });
    }
    const ampacity = CABLE_AMPACITY_A[line.cable.sectionMm2] ?? 0;
    if (line.breaker.ratingA > ampacity) {
      warnings.push({
        id: `breaker-cable-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: автомат ${line.breaker.ratingA} А больше допуска кабеля ${line.cable.sectionMm2} мм² (${ampacity} А).`,
      });
    }
    const current = line.loadW / (VOLTAGE_V * COS_PHI);
    if (current > line.breaker.ratingA + 0.01) {
      warnings.push({
        id: `load-breaker-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: ток нагрузки ${current.toFixed(1)} А превышает автомат ${line.breaker.ratingA} А.`,
      });
    }
    if (line.purpose === 'lighting' && line.breaker.curve !== 'B') {
      warnings.push({
        id: `lighting-curve-${line.id}`,
        severity: 'info',
        message: `«${line.name}»: для освещения рекомендуется характеристика B.`,
      });
    }
    if (line.purpose === 'lighting' && line.rcd) {
      warnings.push({
        id: `lighting-rcd-${line.id}`,
        severity: 'info',
        message: `«${line.name}»: УЗО на линии освещения не требуется по нормам, но допустимо.`,
      });
    }
    if (line.purpose === 'wet') {
      const ownRcdOk = line.rcd && line.rcd.sensitivityMa <= 30 && line.rcd.type === 'A';
      const mainRcdOk = supply.mainRcd && supply.mainRcd.sensitivityMa <= 30;
      if (!ownRcdOk && !mainRcdOk) {
        warnings.push({
          id: `wet-rcd-${line.id}`,
          severity: 'error',
          message: `«${line.name}»: влажная зона требует УЗО 30 мА типа A (ПУЭ 7.1.48).`,
        });
      }
    }
    if (line.purpose !== 'lighting' && !line.rcd) {
      const commonRcd = supply.mainRcd && supply.mainRcd.sensitivityMa <= 30;
      if (!commonRcd) {
        warnings.push({
          id: `line-rcd-${line.id}`,
          severity: 'warning',
          message: `«${line.name}»: розеточная линия без УЗО 30 мА (ПУЭ 7.1.79).`,
        });
      }
    }
  }

  if (supply.mainRcd && supply.mainRcd.sensitivityMa === 30 && panel.lines.length > 4) {
    warnings.push({
      id: 'common-rcd-lines',
      severity: 'warning',
      message: `Одно УЗО 30 мА на ${panel.lines.length} линий: при срабатывании отключится весь щит. Для надёжности разделите защиту.`,
    });
  }

  if (supply.mainRcd && supply.mainRcd.sensitivityMa > 300) {
    warnings.push({
      id: 'main-rcd-high',
      severity: 'warning',
      message: `Противопожарное УЗО ${supply.mainRcd.sensitivityMa} мА: по ПУЭ 7.1.84 рекомендуется не более 300 мА.`,
    });
  }

  if (modulesTotal > 72) {
    warnings.push({
      id: 'enclosure-overflow',
      severity: 'error',
      message: `Модулей ${modulesTotal} — больше максимального корпуса на 72 модуля. Уменьшите число линий или объедините их.`,
    });
  } else if (enclosureModules < 12) {
    warnings.push({
      id: 'enclosure-min',
      severity: 'warning',
      message: 'Для щитка нужен корпус минимум на 12 модулей.',
    });
  }

  const actualReserve = enclosureModules > 0 ? freeModules / enclosureModules : 0;
  if (actualReserve < reserveTarget) {
    warnings.push({
      id: 'reserve-low',
      severity: 'info',
      message: `Свободных модулей ${freeModules} (${Math.round(actualReserve * 100)} %) — меньше целевого запаса ${Math.round(reserveTarget * 100)} %.`,
    });
  }

  return warnings;
}

export function buildPanelLayout(panel: ElectricalPanel): PanelLayout {
  const items = buildItems(panel);
  const modulesTotal = items.reduce((sum, item) => sum + item.modules, 0);
  const reserveTarget = reserveTargetFor(panel.strategy);
  const requiredModules = Math.ceil(modulesTotal / (1 - reserveTarget));
  const enclosureModules =
    ENCLOSURE_SERIES.find((size) => size >= requiredModules) ?? 72;
  const freeModules = Math.max(0, enclosureModules - modulesTotal);
  const reservePercent = enclosureModules > 0 ? (freeModules / enclosureModules) * 100 : 0;

  const rows = layoutRows(items, Math.max(enclosureModules, modulesTotal));
  const warnings = collectWarnings(
    panel,
    modulesTotal,
    enclosureModules,
    freeModules,
    reserveTarget
  );

  return {
    items,
    rows,
    railModules: RAIL_MODULES,
    rowsCount: Math.max(1, Math.ceil(enclosureModules / RAIL_MODULES)),
    modulesTotal,
    requiredModules,
    enclosureModules,
    freeModules,
    reservePercent,
    reserveTarget,
    warnings,
  };
}

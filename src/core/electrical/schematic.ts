import type {
  BreakerSpec,
  CableSpec,
  ElectricalPanel,
  GroundingSystem,
  PhaseLabel,
  RcdSpec,
  ReliabilityCategory,
  RoomZone,
} from '../../types';
import {
  LINE_PRESETS,
  inputCurrentA,
  lineCosPhi,
  lineDemandFactor,
  lineDesignCurrentA,
  lineDesignPowerW,
  normalizeCosPhi,
  normalizeDemandFactor,
  panelDesignPowerW,
  panelInstalledPowerW,
  phaseForLine,
} from './norms';
import {
  validatePanel,
  type NormativeFinding,
} from './panelValidation';

export type SchematicInputKind =
  | 'input_breaker'
  | 'meter'
  | 'main_rcd'
  | 'voltage_relay'
  | 'spd';

export interface SchematicInputItem {
  id: string;
  designation: string;
  kind: SchematicInputKind;
  title: string;
  detail: string;
}

export interface SchematicGroup {
  index: number;
  lineId: string;
  name: string;
  purposeLabel: string;
  phase: PhaseLabel | null;
  installedPowerW: number;
  designPowerW: number;
  currentA: number;
  cosPhi: number;
  demandFactor: number;
  breaker: BreakerSpec;
  rcd: RcdSpec | null;
  cable: CableSpec;
  cableLengthMm: number;
  breakerDesignation: string;
  rcdDesignation: string | null;
}

export interface SchematicPhaseLoad {
  phase: PhaseLabel;
  powerW: number;
  groups: number;
}

export interface SchematicSupply {
  voltageLabel: string;
  system: GroundingSystem;
  reliabilityCategory: ReliabilityCategory;
  phases: 1 | 3;
  cosPhi: number;
  demandFactor: number;
  cableBrand: string;
  allocatedPowerW: number;
  installedPowerW: number;
  designPowerW: number;
  designCurrentA: number;
  inputBreaker: BreakerSpec;
  inputCable: CableSpec;
  mainRcd: RcdSpec | null;
  meterEnabled: boolean;
  voltageRelay: boolean;
  surgeProtection: boolean;
}

export interface PanelSchematic {
  panelName: string;
  title: string;
  supply: SchematicSupply;
  inputItems: SchematicInputItem[];
  groups: SchematicGroup[];
  phaseLoads: SchematicPhaseLoad[];
  phaseImbalancePercent: number;
  totalCableLengthMm: number;
  findings: NormativeFinding[];
}

export interface BuildSchematicOptions {
  rooms?: RoomZone[];
  cableLengthsMm?: Map<string, number> | Record<string, number>;
}

function cableLengthFor(
  source: BuildSchematicOptions['cableLengthsMm'],
  lineId: string
): number {
  if (!source) return 0;
  if (source instanceof Map) return source.get(lineId) ?? 0;
  return source[lineId] ?? 0;
}

function rcdDetail(rcd: RcdSpec): string {
  return `${rcd.sensitivityMa} мА · ${rcd.poles}P · тип ${rcd.type}${
    rcd.selective ? ' · S' : ''
  }`;
}

function inputItems(panel: ElectricalPanel): SchematicInputItem[] {
  const supply = panel.supply;
  const items: SchematicInputItem[] = [
    {
      id: 'input-breaker',
      designation: 'QF1',
      kind: 'input_breaker',
      title: 'Вводной автомат',
      detail: `${supply.inputBreaker.ratingA} А · ${supply.inputBreaker.poles}P ${supply.inputBreaker.curve}`,
    },
  ];
  if (supply.meter.enabled) {
    items.push({
      id: 'meter',
      designation: 'PI1',
      kind: 'meter',
      title: 'Счётчик электроэнергии',
      detail: 'Учёт · 6 модулей',
    });
  }
  if (supply.mainRcd) {
    items.push({
      id: 'main-rcd',
      designation: 'QD1',
      kind: 'main_rcd',
      title: 'Противопожарное УЗО',
      detail: rcdDetail(supply.mainRcd),
    });
  }
  if (supply.voltageRelay) {
    items.push({
      id: 'voltage-relay',
      designation: 'KV1',
      kind: 'voltage_relay',
      title: 'Реле контроля напряжения',
      detail: 'Защита от скачков и обрыва нуля',
    });
  }
  if (supply.surgeProtection) {
    items.push({
      id: 'spd',
      designation: 'F1',
      kind: 'spd',
      title: 'УЗИП',
      detail: 'Защита от импульсных перенапряжений',
    });
  }
  return items;
}

export function buildPanelSchematic(
  panel: ElectricalPanel,
  options: BuildSchematicOptions = {}
): PanelSchematic {
  const supply = panel.supply;
  const hasMainRcd = Boolean(supply.mainRcd);
  const installedPowerW = panelInstalledPowerW(panel);
  const designPowerW = panelDesignPowerW(panel);
  const cosPhi = normalizeCosPhi(supply.cosPhi);
  const demandFactor = normalizeDemandFactor(supply.demandFactor);

  let rcdCounter = hasMainRcd ? 1 : 0;
  const groups: SchematicGroup[] = panel.lines.map((line, index) => {
    const rcdDesignation = line.rcd ? `QD${++rcdCounter}` : null;
    return {
      index: index + 1,
      lineId: line.id,
      name: line.name,
      purposeLabel: LINE_PRESETS[line.purpose].label,
      phase: phaseForLine(line, index, supply.phases),
      installedPowerW: line.loadW,
      designPowerW: lineDesignPowerW(line),
      currentA: lineDesignCurrentA(line),
      cosPhi: lineCosPhi(line),
      demandFactor: lineDemandFactor(line),
      breaker: line.breaker,
      rcd: line.rcd,
      cable: line.cable,
      cableLengthMm: cableLengthFor(options.cableLengthsMm, line.id),
      breakerDesignation: `QF${index + 2}`,
      rcdDesignation,
    };
  });

  const phaseLoads: SchematicPhaseLoad[] =
    supply.phases === 3
      ? (['L1', 'L2', 'L3'] as PhaseLabel[]).map((phase) => {
          const phaseGroups = groups.filter((group) => group.phase === phase);
          return {
            phase,
            powerW: phaseGroups.reduce(
              (sum, group) => sum + group.designPowerW,
              0
            ),
            groups: phaseGroups.length,
          };
        })
      : [];

  const maxPhasePower = Math.max(...phaseLoads.map((item) => item.powerW));
  const minPhasePower = Math.min(...phaseLoads.map((item) => item.powerW));
  const phaseImbalancePercent =
    supply.phases === 3 && maxPhasePower > 0
      ? ((maxPhasePower - minPhasePower) / maxPhasePower) * 100
      : 0;

  const findings = validatePanel(panel, {
    rooms: options.rooms,
    cableLengthsMm: options.cableLengthsMm,
  });

  return {
    panelName: panel.name,
    title: 'Схема электрическая принципиальная щита',
    supply: {
      voltageLabel:
        supply.phases === 3 ? '380/220 В, 3 фазы' : '230 В, 1 фаза',
      system: supply.system,
      reliabilityCategory: supply.reliabilityCategory,
      phases: supply.phases,
      cosPhi,
      demandFactor,
      cableBrand: supply.cableBrand,
      allocatedPowerW: supply.allocatedPowerW,
      installedPowerW,
      designPowerW,
      designCurrentA: inputCurrentA(designPowerW, supply.phases, cosPhi),
      inputBreaker: supply.inputBreaker,
      inputCable: supply.inputCable,
      mainRcd: supply.mainRcd,
      meterEnabled: supply.meter.enabled,
      voltageRelay: supply.voltageRelay,
      surgeProtection: supply.surgeProtection,
    },
    inputItems: inputItems(panel),
    groups,
    phaseLoads,
    phaseImbalancePercent,
    totalCableLengthMm: groups.reduce(
      (sum, group) => sum + group.cableLengthMm,
      0
    ),
    findings,
  };
}

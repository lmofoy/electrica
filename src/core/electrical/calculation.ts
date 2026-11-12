import type {
  BreakerSpec,
  CableSpec,
  ElectricalPanel,
  PhaseLabel,
  RcdSpec,
  RoomZone,
} from '../../types';
import {
  LINE_PRESETS,
  PHASE_LABELS,
  RHO_CU_OHM_MM2_PER_M,
  voltageDropLimitPercent,
  voltageDropPercent,
} from './norms';
import { REF, type NormativeFinding } from './panelValidation';
import {
  buildPanelSchematic,
  type SchematicSupply,
} from './schematic';

export type CalculationStatus = 'ok' | 'warning' | 'error';

export interface PanelCalculationRow {
  index: number;
  lineId: string;
  designation: string;
  rcdDesignation: string | null;
  name: string;
  purposeLabel: string;
  roomsLabel: string;
  phase: PhaseLabel | null;
  deviceCount: number;
  installedPowerW: number;
  demandFactor: number;
  cosPhi: number;
  designPowerW: number;
  designCurrentA: number;
  breaker: BreakerSpec;
  rcd: RcdSpec | null;
  cable: CableSpec;
  cableBrand: string;
  cableLengthMm: number;
  voltageDropPercent: number;
  voltageDropLimitPercent: number;
  voltageDropOk: boolean;
  errors: number;
  warnings: number;
  status: CalculationStatus;
}

export interface CalculationPhaseLoad {
  phase: PhaseLabel;
  designPowerW: number;
  currentA: number;
  groups: number;
}

export interface PanelCalculationInput {
  designation: string;
  name: string;
  phaseLabel: string;
  installedPowerW: number;
  demandFactor: number;
  cosPhi: number;
  designPowerW: number;
  designCurrentA: number;
  breaker: BreakerSpec;
  rcd: RcdSpec | null;
  cable: CableSpec;
  cableBrand: string;
  errors: number;
  warnings: number;
  status: CalculationStatus;
}

export interface PanelCalculationTotals {
  rowCount: number;
  deviceCount: number;
  installedPowerW: number;
  designPowerW: number;
  designCurrentA: number;
  cableLengthMm: number;
  errorRows: number;
  warningRows: number;
  voltageDropWarnings: number;
}

export interface PanelCalculation {
  panelName: string;
  title: string;
  supply: SchematicSupply;
  input: PanelCalculationInput;
  rows: PanelCalculationRow[];
  phaseLoads: CalculationPhaseLoad[];
  phaseImbalancePercent: number;
  totals: PanelCalculationTotals;
  findings: NormativeFinding[];
  notes: string[];
  references: string[];
}

export interface BuildCalculationOptions {
  rooms?: RoomZone[];
  cableLengthsMm?: Map<string, number> | Record<string, number>;
}

function num(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

function kw(value: number): string {
  return `${num(value / 1000, 2)} кВт`;
}

function cableLabel(cable: CableSpec): string {
  return `${cable.cores}×${num(cable.sectionMm2, cable.sectionMm2 % 1 === 0 ? 0 : 1)} мм²`;
}

function rcdLabel(rcd: RcdSpec | null): string {
  if (!rcd) return 'нет';
  return `${rcd.sensitivityMa} мА · ${rcd.type}${rcd.selective ? ' S' : ''}`;
}

function breakerLabel(breaker: BreakerSpec): string {
  return `${breaker.ratingA} А · ${breaker.curve} · ${breaker.poles}P`;
}

function statusFromCounts(errors: number, warnings: number): CalculationStatus {
  if (errors > 0) return 'error';
  if (warnings > 0) return 'warning';
  return 'ok';
}

function roomsLabelFor(lineRoomIds: string[], rooms?: RoomZone[]): string {
  if (!rooms || lineRoomIds.length === 0) return '';
  const names = lineRoomIds
    .map((roomId) => rooms.find((room) => room.id === roomId)?.name)
    .filter((name): name is string => Boolean(name));
  return names.join(' · ');
}

function countFindings(
  findings: NormativeFinding[],
  lineId?: string
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (lineId ? finding.lineId !== lineId : finding.lineId) continue;
    if (finding.severity === 'error') errors += 1;
    if (finding.severity === 'warning') warnings += 1;
  }
  return { errors, warnings };
}

function phaseNote(
  phases: 1 | 3,
  phaseLoads: CalculationPhaseLoad[],
  imbalancePercent: number
): string {
  if (phases === 1) {
    return 'Однофазный ввод 230 В: распределение групповых нагрузок по фазам не требуется.';
  }
  const loads = phaseLoads
    .map((load) => `${load.phase} ${kw(load.designPowerW)}`)
    .join(', ');
  return `Фазы: ${loads}; неравномерность ${num(
    imbalancePercent,
    0
  )} % (СП 31-110-2003, не более 15 %).`;
}

function buildNotes(
  supply: SchematicSupply,
  panel: ElectricalPanel,
  phaseLoads: CalculationPhaseLoad[],
  imbalancePercent: number,
  totals: PanelCalculationTotals,
  errors: number,
  warnings: number
): string[] {
  const inputRcd = supply.mainRcd
    ? `QD1 ${rcdLabel(supply.mainRcd)}`
    : 'УЗО на вводе нет';
  const groupRcd = panel.lines.some((line) => line.rcd)
    ? 'на линиях — по расчётной таблице'
    : 'на линиях УЗО нет';
  return [
    `Ввод: ${supply.voltageLabel}, система ${supply.system}, категория надёжности ${supply.reliabilityCategory}; выделено ${kw(
      supply.allocatedPowerW
    )}.`,
    `Мощности: установленная ${kw(supply.installedPowerW)}, расчётная ${kw(
      supply.designPowerW
    )}; Kс ввода ${num(supply.demandFactor, 2)}; cos φ ${num(supply.cosPhi, 2)}.`,
    'Формулы: Pр = Pу·Kс; Iр = Pр / (Uф·cosφ); ΔU = 2·ρ·L·Iр / S; ρ = 0,0175 Ом·мм²/м.',
    `Вводной кабель: ${supply.cableBrand} ${cableLabel(
      supply.inputCable
    )}; QF1 ${breakerLabel(supply.inputBreaker)}; ${inputRcd}.`,
    `Групповые линии: ${supply.cableBrand}; ${groupRcd}; допустимые токи по ПУЭ-7, табл. 1.3.4.`,
    'Минимальные сечения: освещение 1,5 мм²; розетки и силовые группы 2,5 мм² (СП 256.1325800.2016).',
    'УЗО 30 мА типа A — розеточные и влажные группы (ПУЭ-7, п. 7.1.79; ГОСТ Р 50571.4.41).',
    'Потери напряжения: не более 3 % для освещения и 5 % для прочих групп; проверяются по длине трассы.',
    phaseNote(supply.phases, phaseLoads, imbalancePercent),
    `Проверка: ошибок ${errors}, замечаний ${warnings}; линий ${totals.rowCount}, кабель ${num(
      totals.cableLengthMm / 1000,
      1
    )} м. Расчёт справочный: проверьте ТУ и условия прокладки.`,
  ];
}

export const CALCULATION_REFERENCES = [
  REF.ampacity,
  REF.protection,
  REF.breakerRatings,
  REF.sections,
  REF.socketsRcd,
  REF.selectivity,
  REF.phases,
  REF.voltageDrop,
  `ρ меди 0,0175 Ом·мм²/м (${RHO_CU_OHM_MM2_PER_M})`,
] as const;

export function buildPanelCalculation(
  panel: ElectricalPanel,
  options: BuildCalculationOptions = {}
): PanelCalculation {
  const schematic = buildPanelSchematic(panel, {
    rooms: options.rooms,
    cableLengthsMm: options.cableLengthsMm,
  });
  const supply = schematic.supply;

  const rows: PanelCalculationRow[] = schematic.groups.map((group, index) => {
    const line = panel.lines[index];
    const lineFindings = countFindings(schematic.findings, group.lineId);
    const drop = voltageDropPercent(
      group.currentA,
      group.cableLengthMm,
      group.cable.sectionMm2
    );
    const limit = voltageDropLimitPercent(line?.purpose ?? 'other');
    return {
      index: group.index,
      lineId: group.lineId,
      designation: group.breakerDesignation,
      rcdDesignation: group.rcdDesignation,
      name: group.name,
      purposeLabel: line ? LINE_PRESETS[line.purpose].label : group.purposeLabel,
      roomsLabel: roomsLabelFor(line?.roomIds ?? [], options.rooms),
      phase: group.phase,
      deviceCount: line?.deviceIds.length ?? 0,
      installedPowerW: group.installedPowerW,
      demandFactor: group.demandFactor,
      cosPhi: group.cosPhi,
      designPowerW: group.designPowerW,
      designCurrentA: group.currentA,
      breaker: group.breaker,
      rcd: group.rcd,
      cable: group.cable,
      cableBrand: supply.cableBrand,
      cableLengthMm: group.cableLengthMm,
      voltageDropPercent: drop,
      voltageDropLimitPercent: limit,
      voltageDropOk: group.cableLengthMm <= 0 || drop <= limit + 1e-9,
      errors: lineFindings.errors,
      warnings: lineFindings.warnings,
      status: statusFromCounts(lineFindings.errors, lineFindings.warnings),
    };
  });

  const phaseLoads: CalculationPhaseLoad[] =
    supply.phases === 3
      ? PHASE_LABELS.map((phase) => {
          const phaseRows = rows.filter((row) => row.phase === phase);
          return {
            phase,
            designPowerW: phaseRows.reduce(
              (sum, row) => sum + row.designPowerW,
              0
            ),
            currentA: phaseRows.reduce(
              (sum, row) => sum + row.designCurrentA,
              0
            ),
            groups: phaseRows.length,
          };
        })
      : [];

  const inputFindings = countFindings(schematic.findings);
  const input: PanelCalculationInput = {
    designation: 'QF1',
    name: 'Вводной аппарат',
    phaseLabel: supply.phases === 3 ? 'L1–L3' : 'L',
    installedPowerW: supply.installedPowerW,
    demandFactor: supply.demandFactor,
    cosPhi: supply.cosPhi,
    designPowerW: supply.designPowerW,
    designCurrentA: supply.designCurrentA,
    breaker: supply.inputBreaker,
    rcd: supply.mainRcd,
    cable: supply.inputCable,
    cableBrand: supply.cableBrand,
    errors: inputFindings.errors,
    warnings: inputFindings.warnings,
    status: statusFromCounts(inputFindings.errors, inputFindings.warnings),
  };

  const totals: PanelCalculationTotals = {
    rowCount: rows.length,
    deviceCount: panel.lines.reduce(
      (sum, line) => sum + line.deviceIds.length,
      0
    ),
    installedPowerW: supply.installedPowerW,
    designPowerW: supply.designPowerW,
    designCurrentA: supply.designCurrentA,
    cableLengthMm: schematic.totalCableLengthMm,
    errorRows: rows.filter((row) => row.status === 'error').length,
    warningRows: rows.filter((row) => row.status === 'warning').length,
    voltageDropWarnings: rows.filter((row) => !row.voltageDropOk).length,
  };

  const errors = schematic.findings.filter(
    (finding) => finding.severity === 'error'
  ).length;
  const warnings = schematic.findings.filter(
    (finding) => finding.severity === 'warning'
  ).length;

  return {
    panelName: schematic.panelName,
    title: 'Расчёт нагрузок групповых линий и ввода',
    supply,
    input,
    rows,
    phaseLoads,
    phaseImbalancePercent: schematic.phaseImbalancePercent,
    totals,
    findings: schematic.findings,
    notes: buildNotes(
      supply,
      panel,
      phaseLoads,
      schematic.phaseImbalancePercent,
      totals,
      errors,
      warnings
    ),
    references: [...CALCULATION_REFERENCES],
  };
}

export function calculationStatus(
  calculation: PanelCalculation
): CalculationStatus {
  const errors = calculation.findings.filter(
    (finding) => finding.severity === 'error'
  ).length;
  const warnings = calculation.findings.filter(
    (finding) => finding.severity === 'warning'
  ).length;
  return statusFromCounts(errors, warnings);
}

export function calculationStatusText(calculation: PanelCalculation): string {
  const errors = calculation.findings.filter(
    (finding) => finding.severity === 'error'
  ).length;
  const warnings = calculation.findings.filter(
    (finding) => finding.severity === 'warning'
  ).length;
  if (calculation.rows.length === 0) return 'Линии не заданы';
  if (errors > 0) return `Ошибок: ${errors}`;
  if (warnings > 0) return `Замечаний: ${warnings}`;
  return 'Нормы соблюдены';
}

export function calculationCableTotalLabel(
  calculation: PanelCalculation
): string {
  return calculation.totals.cableLengthMm > 0
    ? `${num(calculation.totals.cableLengthMm / 1000, 1)} м`
    : 'не рассчитан';
}

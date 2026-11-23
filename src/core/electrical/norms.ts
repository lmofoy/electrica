import type {
  BreakerSpec,
  BreakingCapacityKa,
  CableSpec,
  CircuitLine,
  ElectricalPanel,
  LinePurpose,
  PhaseLabel,
  RcdSpec,
} from '../../types';

// -------------------------------------------------------------
// Нормативная база (ПУЭ-7, СП 256.1325800.2016, ГОСТ Р 50571).
// Медные кабели 3/5 жил, прокладка в трубе; ввод 1 фаза 230 В
// или 3 фазы 380/220 В.
// -------------------------------------------------------------

// ПУЭ-7, табл. 1.3.4: длительно допустимый ток медных 3-жильных
// кабелей в трубе при температуре воздуха 25 °C.
export const CABLE_AMPACITY_A: Record<number, number> = {
  1.5: 15,
  2.5: 21,
  4: 27,
  6: 34,
  10: 50,
  16: 70,
};

export const CABLE_SECTIONS = [1.5, 2.5, 4, 6, 10, 16] as const;

// Ряд номиналов автоматических выключателей по ГОСТ IEC 60898-1.
export const BREAKER_RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63] as const;

export const RCD_SENSITIVITIES = [10, 30, 100, 300] as const;

// Отключающая способность модульных аппаратов. Для квартирного щита
// в городской сети — 6 кА; 4,5 кА допустимы при малых токах КЗ.
export const BREAKING_CAPACITIES_KA = [4.5, 6, 10] as const;
export const DEFAULT_BREAKING_CAPACITY_KA: BreakingCapacityKa = 6;

export function normalizeBreakingCapacity(value: unknown): BreakingCapacityKa {
  return value === 4.5 || value === 6 || value === 10
    ? value
    : DEFAULT_BREAKING_CAPACITY_KA;
}

export function breakingCapacityLabel(value: BreakingCapacityKa): string {
  return `${String(value).replace('.', ',')} кА`;
}

// Значение по умолчанию для линий: нагрузки в квартире преимущественно
// активные, запас заложен в номиналах автоматов. На вводе по умолчанию
// 0.96; значение можно уточнить в линии и на вводе — расчёт использует поле.
export const COS_PHI = 1;
export const VOLTAGE_V = 230;
// Линейное напряжение трёхфазного ввода по проектной практике РФ.
export const LINE_VOLTAGE_V = 380;
export const CABLE_BRAND = 'ВВГнг(А)-LS';
export const RHO_CU_OHM_MM2_PER_M = 0.0175; // медь, 20 °C

// Практика проектирования: ≤3 % для освещения, ≤5 % для прочих групп.
export const VOLTAGE_DROP_LIMIT_LIGHTING_PERCENT = 3;
export const VOLTAGE_DROP_LIMIT_OTHER_PERCENT = 5;

export function voltageDropLimitPercent(purpose: LinePurpose): number {
  return purpose === 'lighting'
    ? VOLTAGE_DROP_LIMIT_LIGHTING_PERCENT
    : VOLTAGE_DROP_LIMIT_OTHER_PERCENT;
}

// Потери напряжения в однофазной группе: ΔU = 2·ρ·L·I / S.
export function voltageDropPercent(
  currentA: number,
  lengthMm: number,
  sectionMm2: number
): number {
  if (!(lengthMm > 0) || !(sectionMm2 > 0) || !Number.isFinite(currentA)) return 0;
  const resistanceOhm =
    (2 * RHO_CU_OHM_MM2_PER_M * (lengthMm / 1000)) / sectionMm2;
  return (resistanceOhm * currentA * 100) / VOLTAGE_V;
}

// Минимальные сечения групповых сетей: освещение 1,5 мм²,
// розеточные и силовые группы — 2,5 мм² (СП 256.1325800.2016).
export const MIN_SECTION_BY_PURPOSE: Record<LinePurpose, number> = {
  lighting: 1.5,
  sockets: 2.5,
  wet: 2.5,
  kitchen: 2.5,
  hob: 2.5,
  oven: 2.5,
  washing: 2.5,
  ac: 2.5,
  heating: 2.5,
  other: 2.5,
};

export interface LinePreset {
  label: string;
  purpose: LinePurpose;
  loadW: number;
  cableSectionMm2: number;
  breakerRatingA: number;
  curve: 'B' | 'C';
  rcd: { sensitivityMa: number; type: 'A' | 'AC' } | null;
  needsRcd: boolean;
}

export const LINE_PRESETS: Record<LinePurpose, LinePreset> = {
  lighting: {
    label: 'Освещение',
    purpose: 'lighting',
    loadW: 500,
    cableSectionMm2: 1.5,
    breakerRatingA: 10,
    curve: 'B',
    rcd: null,
    needsRcd: false,
  },
  sockets: {
    label: 'Розетки',
    purpose: 'sockets',
    loadW: 2000,
    cableSectionMm2: 2.5,
    breakerRatingA: 16,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
  wet: {
    label: 'Розетки влажной зоны',
    purpose: 'wet',
    loadW: 1500,
    cableSectionMm2: 2.5,
    breakerRatingA: 16,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
  kitchen: {
    label: 'Кухонные розетки',
    purpose: 'kitchen',
    loadW: 3500,
    cableSectionMm2: 2.5,
    breakerRatingA: 16,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
  hob: {
    label: 'Варочная панель',
    purpose: 'hob',
    loadW: 7000,
    cableSectionMm2: 6,
    breakerRatingA: 32,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
  oven: {
    label: 'Духовой шкаф',
    purpose: 'oven',
    loadW: 3500,
    cableSectionMm2: 2.5,
    breakerRatingA: 16,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
  washing: {
    label: 'Стиральная машина',
    purpose: 'washing',
    loadW: 2200,
    cableSectionMm2: 2.5,
    breakerRatingA: 16,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
  ac: {
    label: 'Кондиционер',
    purpose: 'ac',
    loadW: 2500,
    cableSectionMm2: 2.5,
    breakerRatingA: 16,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
  heating: {
    label: 'Электроотопление',
    purpose: 'heating',
    loadW: 3000,
    cableSectionMm2: 2.5,
    breakerRatingA: 16,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
  other: {
    label: 'Прочее',
    purpose: 'other',
    loadW: 1000,
    cableSectionMm2: 2.5,
    breakerRatingA: 16,
    curve: 'C',
    rcd: { sensitivityMa: 30, type: 'A' },
    needsRcd: true,
  },
};

export const LINE_PURPOSES: LinePurpose[] = [
  'lighting',
  'sockets',
  'wet',
  'kitchen',
  'hob',
  'oven',
  'washing',
  'ac',
  'heating',
  'other',
];

export const PHASE_LABELS: readonly PhaseLabel[] = ['L1', 'L2', 'L3'];

// Явно заданная фаза сохраняется, иначе группы распределяются по порядку.
export function phaseForLine(
  line: CircuitLine,
  index: number,
  phases: 1 | 3
): PhaseLabel | null {
  if (phases !== 3) return null;
  return line.phase ?? PHASE_LABELS[index % PHASE_LABELS.length];
}

export function normalizeCosPhi(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : COS_PHI;
}

export function normalizeDemandFactor(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : 1;
}

export function loadCurrentA(loadW: number, cosPhi = COS_PHI): number {
  return loadW / (VOLTAGE_V * normalizeCosPhi(cosPhi));
}

export function lineCosPhi(line: CircuitLine): number {
  return normalizeCosPhi(line.cosPhi);
}

export function lineDemandFactor(line: CircuitLine): number {
  return normalizeDemandFactor(line.demandFactor);
}

export function lineDesignPowerW(line: CircuitLine): number {
  return line.loadW * lineDemandFactor(line);
}

export function lineDesignCurrentA(line: CircuitLine): number {
  return loadCurrentA(lineDesignPowerW(line), lineCosPhi(line));
}

export function inputCurrentA(
  powerW: number,
  phases: 1 | 3,
  cosPhi = COS_PHI
): number {
  const phi = normalizeCosPhi(cosPhi);
  return phases === 3
    ? powerW / (Math.sqrt(3) * LINE_VOLTAGE_V * phi)
    : powerW / (VOLTAGE_V * phi);
}

export function panelInstalledPowerW(panel: ElectricalPanel): number {
  return panel.lines.reduce((sum, line) => sum + line.loadW, 0);
}

export function panelDesignPowerW(panel: ElectricalPanel): number {
  const linePowerW = panel.lines.reduce(
    (sum, line) => sum + lineDesignPowerW(line),
    0
  );
  return linePowerW * normalizeDemandFactor(panel.supply.demandFactor);
}

export function amperageFor(sectionMm2: number): number {
  return CABLE_AMPACITY_A[sectionMm2] ?? 0;
}

// Наименьший номинал автомата ≥ расчётного тока нагрузки
export function breakerForCurrent(currentA: number, maxA = 63): number {
  return BREAKER_RATINGS.find((rating) => rating >= currentA && rating <= maxA) ?? maxA;
}

// Минимальное сечение кабеля, у которого допуск ≥ номинала автомата
export function cableForBreaker(ratingA: number): number {
  for (const section of CABLE_SECTIONS) {
    if (CABLE_AMPACITY_A[section] >= ratingA) return section;
  }
  return 16;
}

// Наибольший номинал из ряда, который допускает кабель данного сечения.
export function maxBreakerForSection(sectionMm2: number): number {
  const ampacity = CABLE_AMPACITY_A[sectionMm2] ?? 0;
  let max = 0;
  for (const rating of BREAKER_RATINGS) {
    if (rating <= ampacity) max = rating;
  }
  return max;
}

// Автомат по кабелю: не ниже расчётного тока, но не выше допуска сечения.
// Если нагрузка не помещается в кабель, возвращается предельный номинал —
// ошибку покажет нормативная проверка и отправит к шагу кабеля.
export function breakerForSection(
  currentA: number,
  sectionMm2: number,
  preferredA = 0
): number {
  const wanted = Math.max(preferredA, breakerForCurrent(currentA, 63));
  const limit = maxBreakerForSection(sectionMm2);
  return limit > 0 ? Math.min(wanted, limit) : wanted;
}

export function makeCable(sectionMm2: number, cores: 3 | 5 = 3): CableSpec {
  return { sectionMm2, cores };
}

export function makeBreaker(ratingA: number, curve: 'B' | 'C'): BreakerSpec {
  return { poles: ratingA > 32 ? 2 : 1, ratingA, curve };
}

export function makeRcd(
  sensitivityMa: number,
  type: 'A' | 'AC',
  ratingA: number,
  selective = false
): RcdSpec {
  return { poles: 2, ratingA, sensitivityMa, type, selective };
}

export interface InputCalculation {
  currentA: number;
  breakerRatingA: number;
  cableSectionMm2: number;
}

export function calculateInput(
  allocatedPowerW: number,
  cosPhi = COS_PHI
): InputCalculation {
  const currentA = loadCurrentA(allocatedPowerW, cosPhi);
  const breakerRatingA = breakerForCurrent(currentA, 63);
  return {
    currentA,
    breakerRatingA,
    cableSectionMm2: cableForBreaker(breakerRatingA),
  };
}

export const POWER_PRESETS_W = [5000, 7000, 10000, 15000];

// Начальная раскладка линии: сечение выбирается по нагрузке, автомат
// вписывается в его допуск. Для уже существующих линий используйте
// applyPresetProtection — там кабель пользователя не меняется.
export function applyPresetToLine(line: CircuitLine): CircuitLine {
  const preset = LINE_PRESETS[line.purpose];
  const currentA = lineDesignCurrentA(line);
  const wantedBreakerA = Math.max(
    preset.breakerRatingA,
    breakerForCurrent(currentA, 63)
  );
  const cableSectionMm2 = Math.max(
    preset.cableSectionMm2,
    cableForBreaker(wantedBreakerA)
  );
  const breakerRatingA = breakerForSection(
    currentA,
    cableSectionMm2,
    preset.breakerRatingA
  );
  return {
    ...line,
    cable: makeCable(cableSectionMm2),
    breaker: makeBreaker(breakerRatingA, preset.curve),
    rcd: preset.needsRcd
      ? makeRcd(preset.rcd!.sensitivityMa, preset.rcd!.type, breakerRatingA)
      : null,
  };
}

// Пресет назначения без права менять кабель: сечение остаётся выбранным
// пользователем, автомат и УЗО подгоняются под его допуск.
export function applyPresetProtection(line: CircuitLine): CircuitLine {
  const preset = LINE_PRESETS[line.purpose];
  const breakerRatingA = breakerForSection(
    lineDesignCurrentA(line),
    line.cable.sectionMm2,
    preset.breakerRatingA
  );
  return {
    ...line,
    breaker: makeBreaker(breakerRatingA, preset.curve),
    rcd: preset.needsRcd
      ? makeRcd(preset.rcd!.sensitivityMa, preset.rcd!.type, breakerRatingA)
      : null,
  };
}


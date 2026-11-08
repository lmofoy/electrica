import type {
  BreakerSpec,
  CableSpec,
  CircuitLine,
  LinePurpose,
  RcdSpec,
} from '../../types';

// -------------------------------------------------------------
// Нормативная база (ПУЭ-7, СП 256.1325800.2016, ГОСТ Р 50571).
// Только 1 фаза 230 В, медные 3-жильные кабели, прокладка в трубе.
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

// Для бытовых расчётов принят cosφ = 1: нагрузки в квартире
// преимущественно активные, а запас заложен в номиналах автоматов.
export const COS_PHI = 1;
export const VOLTAGE_V = 230;

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

export function loadCurrentA(loadW: number): number {
  return loadW / (VOLTAGE_V * COS_PHI);
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

export function makeCable(sectionMm2: number): CableSpec {
  return { sectionMm2, cores: 3 };
}

export function makeBreaker(ratingA: number, curve: 'B' | 'C'): BreakerSpec {
  return { poles: ratingA > 32 ? 2 : 1, ratingA, curve };
}

export function makeRcd(sensitivityMa: number, type: 'A' | 'AC', ratingA: number): RcdSpec {
  return { poles: 2, ratingA, sensitivityMa, type };
}

export interface InputCalculation {
  currentA: number;
  breakerRatingA: number;
  cableSectionMm2: number;
}

export function calculateInput(allocatedPowerW: number): InputCalculation {
  const currentA = loadCurrentA(allocatedPowerW);
  const breakerRatingA = breakerForCurrent(currentA, 63);
  return {
    currentA,
    breakerRatingA,
    cableSectionMm2: cableForBreaker(breakerRatingA),
  };
}

export const POWER_PRESETS_W = [5000, 7000, 10000, 15000];

export function applyPresetToLine(line: CircuitLine): CircuitLine {
  const preset = LINE_PRESETS[line.purpose];
  const currentA = loadCurrentA(line.loadW);
  const breakerRatingA = Math.max(
    preset.breakerRatingA,
    breakerForCurrent(currentA, 63)
  );
  const cableSectionMm2 = Math.max(
    preset.cableSectionMm2,
    cableForBreaker(breakerRatingA)
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


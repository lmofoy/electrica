import type {
  ElectricalPanel,
  FrameMounting,
  FramePosts,
  MountingFrame,
  RoomZone,
} from '../../types';
import { FRAME_POSTS_OPTIONS, FRAME_POST_PITCH_MM, FRAME_SINGLE_WIDTH_MM } from './frames';
import { buildPanelLayout } from './panelLayout';
import { buildPanelSchematic, type SchematicGroup } from './schematic';
import { breakingCapacityLabel } from './norms';
import { REF, type NormativeFinding } from './panelValidation';

// -------------------------------------------------------------
// Спецификация оборудования и ведомость материалов (BOM).
// Ядро агрегирует аппараты по характеристикам и кабель по
// марке/сечению. Ничего не рисует и не хранит состояние.
// -------------------------------------------------------------

export type SpecificationSection = 'equipment' | 'materials';

export type SpecificationStatus = 'ok' | 'warning' | 'error';

export interface SpecificationItem {
  id: string;
  section: SpecificationSection;
  designation: string;
  name: string;
  detail: string;
  type: string;
  unit: string;
  quantity: number;
  note: string;
}

export interface SpecificationEnclosure {
  modules: number;
  rails: number;
  occupied: number;
  free: number;
  mounting: 'flush' | 'surface';
  reservePercent: number;
}

export interface SpecificationTotals {
  equipmentItems: number;
  equipmentUnits: number;
  cableMeters: number;
}

export interface PanelSpecification {
  panelName: string;
  title: string;
  enclosure: SpecificationEnclosure;
  items: SpecificationItem[];
  totals: SpecificationTotals;
  status: SpecificationStatus;
  statusText: string;
  notes: string[];
  references: string[];
}

export interface BuildSpecificationOptions {
  rooms?: RoomZone[];
  cableLengthsMm?: Map<string, number> | Record<string, number>;
  findings?: NormativeFinding[];
  frames?: MountingFrame[];
}

const FRAME_POSTS_WORD: Record<FramePosts, string> = {
  1: '1 место',
  2: '2 места',
  3: '3 места',
  4: '4 места',
};

const FRAME_MOUNTING_OPTIONS: {
  id: FrameMounting;
  label: string;
  type: string;
}[] = [
  { id: 'flush', label: 'скрытая', type: 'встраиваемая' },
  { id: 'surface', label: 'накладная', type: 'накладная' },
];

function num(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

function cableLabel(cores: number, sectionMm2: number): string {
  return `${cores}×${num(sectionMm2, sectionMm2 % 1 === 0 ? 0 : 1)} мм²`;
}

// «QF2, QF3, QF4» → «QF2–QF4», если номера идут подряд.
export function joinDesignations(designations: string[]): string {
  if (designations.length === 0) return '—';
  const parsed = designations.map((designation) => {
    const match = /^(.*?)(\d+)$/.exec(designation);
    return match
      ? { prefix: match[1], number: Number(match[2]), raw: designation }
      : { prefix: designation, number: Number.NaN, raw: designation };
  });
  const first = parsed[0];
  const contiguous = parsed.every(
    (item, index) =>
      item.prefix === first.prefix &&
      Number.isFinite(item.number) &&
      item.number === first.number + index
  );
  if (contiguous) {
    return parsed.length === 1
      ? first.raw
      : `${first.raw}–${parsed[parsed.length - 1].raw}`;
  }
  return designations.join(', ');
}

function cableLengthFor(
  source: BuildSpecificationOptions['cableLengthsMm'],
  lineId: string
): number {
  if (!source) return 0;
  if (source instanceof Map) return source.get(lineId) ?? 0;
  return source[lineId] ?? 0;
}

interface BreakerGroup {
  ratingA: number;
  curve: string;
  poles: number;
  designations: string[];
}

interface RcdGroup {
  ratingA: number;
  sensitivityMa: number;
  type: string;
  poles: number;
  selective: boolean;
  designations: string[];
}

interface RcboGroup {
  ratingA: number;
  curve: string;
  sensitivityMa: number;
  type: string;
  designations: string[];
}

interface CableGroup {
  brand: string;
  cores: number;
  sectionMm2: number;
  lengthMm: number;
}

function aggregateBreakers(
  groups: SchematicGroup[]
): Map<string, BreakerGroup> {
  const result = new Map<string, BreakerGroup>();
  for (const group of groups) {
    if (group.combinedProtection) continue;
    const key = `${group.breaker.ratingA}|${group.breaker.curve}|${group.breaker.poles}`;
    const entry = result.get(key);
    if (entry) {
      entry.designations.push(group.breakerDesignation);
    } else {
      result.set(key, {
        ratingA: group.breaker.ratingA,
        curve: group.breaker.curve,
        poles: group.breaker.poles,
        designations: [group.breakerDesignation],
      });
    }
  }
  return result;
}

function aggregateRcds(groups: SchematicGroup[]): Map<string, RcdGroup> {
  const result = new Map<string, RcdGroup>();
  for (const group of groups) {
    if (!group.rcd || !group.rcdDesignation || group.combinedProtection) continue;
    const rcd = group.rcd;
    const key = `${rcd.ratingA}|${rcd.sensitivityMa}|${rcd.type}|${rcd.poles}|${rcd.selective}`;
    const entry = result.get(key);
    if (entry) {
      entry.designations.push(group.rcdDesignation);
    } else {
      result.set(key, {
        ratingA: rcd.ratingA,
        sensitivityMa: rcd.sensitivityMa,
        type: rcd.type,
        poles: rcd.poles,
        selective: Boolean(rcd.selective),
        designations: [group.rcdDesignation],
      });
    }
  }
  return result;
}

function aggregateRcbos(groups: SchematicGroup[]): Map<string, RcboGroup> {
  const result = new Map<string, RcboGroup>();
  for (const group of groups) {
    if (!group.combinedProtection || !group.rcd) continue;
    const key = `${group.breaker.ratingA}|${group.breaker.curve}|${group.rcd.sensitivityMa}|${group.rcd.type}`;
    const entry = result.get(key);
    if (entry) {
      entry.designations.push(group.breakerDesignation);
    } else {
      result.set(key, {
        ratingA: group.breaker.ratingA,
        curve: group.breaker.curve,
        sensitivityMa: group.rcd.sensitivityMa,
        type: group.rcd.type,
        designations: [group.breakerDesignation],
      });
    }
  }
  return result;
}

function aggregateCables(
  panel: ElectricalPanel,
  brands: string,
  lengths: BuildSpecificationOptions['cableLengthsMm']
): CableGroup[] {
  const result = new Map<string, CableGroup>();
  for (const line of panel.lines) {
    const key = `${brands}|${line.cable.cores}|${line.cable.sectionMm2}`;
    const entry = result.get(key);
    const lengthMm = Math.max(0, cableLengthFor(lengths, line.id));
    if (entry) {
      entry.lengthMm += lengthMm;
    } else {
      result.set(key, {
        brand: brands,
        cores: line.cable.cores,
        sectionMm2: line.cable.sectionMm2,
        lengthMm,
      });
    }
  }
  return [...result.values()].sort(
    (a, b) => b.sectionMm2 - a.sectionMm2 || b.cores - a.cores
  );
}

function statusFromFindings(findings: NormativeFinding[]): {
  status: SpecificationStatus;
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (finding.severity === 'error') errors += 1;
    if (finding.severity === 'warning') warnings += 1;
  }
  return {
    status: errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'ok',
    errors,
    warnings,
  };
}

function statusTextFor(
  lineCount: number,
  errors: number,
  warnings: number
): string {
  if (lineCount === 0) return 'Линии не заданы';
  if (errors > 0) return `Ошибок: ${errors}`;
  if (warnings > 0) return `Замечаний: ${warnings}`;
  return 'Нормы соблюдены';
}

export function buildPanelSpecification(
  panel: ElectricalPanel,
  options: BuildSpecificationOptions = {}
): PanelSpecification {
  const schematic = buildPanelSchematic(panel, {
    rooms: options.rooms,
    cableLengthsMm: options.cableLengthsMm,
  });
  const layout = buildPanelLayout(panel);
  const supply = schematic.supply;
  const capacity = breakingCapacityLabel(supply.breakingCapacityKa);
  const items: SpecificationItem[] = [];

  const equipment = (
    id: string,
    designation: string,
    name: string,
    detail: string,
    type: string,
    quantity: number,
    note = ''
  ): SpecificationItem => ({
    id,
    section: 'equipment',
    designation,
    name,
    detail,
    type,
    unit: 'шт.',
    quantity,
    note,
  });

  items.push(
    equipment(
      'input-breaker',
      'QF1',
      'Выключатель автоматический вводной',
      `${supply.inputBreaker.ratingA} А · характеристика ${supply.inputBreaker.curve} · ${supply.inputBreaker.poles}P · ${capacity}`,
      'модульный',
      1
    )
  );

  if (supply.meterEnabled) {
    items.push(
      equipment(
        'meter',
        'PI1',
        'Счётчик электрической энергии',
        `${supply.phases === 3 ? 'трёхфазный' : 'однофазный'} · модульный`,
        'модульный',
        1
      )
    );
  }

  if (supply.mainRcd) {
    items.push(
      equipment(
        'main-rcd',
        'QD1',
        'УЗО противопожарное',
        `${supply.mainRcd.ratingA} А · ${supply.mainRcd.sensitivityMa} мА · тип ${
          supply.mainRcd.type
        }${supply.mainRcd.selective ? ' S' : ''} · ${supply.mainRcd.poles}P`,
        'модульное',
        1
      )
    );
  }

  if (supply.voltageRelay) {
    items.push(
      equipment(
        'voltage-relay',
        'KV1',
        'Реле контроля напряжения',
        'защита от скачков и обрыва нуля',
        'модульное',
        1
      )
    );
  }

  if (supply.surgeProtection) {
    items.push(
      equipment(
        'spd',
        'F1',
        'УЗИП',
        'защита от импульсных перенапряжений',
        'модульное',
        1
      )
    );
  }

  items.push(
    equipment(
      'enclosure',
      '—',
      'Корпус щита',
      `${layout.enclosureModules} модулей · ${layout.rowsCount} реек · свободно ${layout.freeModules}`,
      panel.mounting === 'flush' ? 'встраиваемый' : 'накладной',
      1
    )
  );

  for (const breaker of aggregateBreakers(schematic.groups).values()) {
    items.push(
      equipment(
        `breaker-${breaker.ratingA}-${breaker.curve}-${breaker.poles}`,
        joinDesignations(breaker.designations),
        'Выключатель автоматический',
        `${breaker.ratingA} А · характеристика ${breaker.curve} · ${breaker.poles}P · ${capacity}`,
        'модульный',
        breaker.designations.length
      )
    );
  }

  for (const rcbo of aggregateRcbos(schematic.groups).values()) {
    items.push(
      equipment(
        `rcbo-${rcbo.ratingA}-${rcbo.curve}-${rcbo.sensitivityMa}-${rcbo.type}`,
        joinDesignations(rcbo.designations),
        'Дифавтомат (АВДТ)',
        `${rcbo.ratingA} А · ${rcbo.curve} · ${rcbo.sensitivityMa} мА · тип ${rcbo.type} · ${capacity} · 1P+N`,
        'модульный',
        rcbo.designations.length
      )
    );
  }

  for (const rcd of aggregateRcds(schematic.groups).values()) {
    items.push(
      equipment(
        `rcd-${rcd.ratingA}-${rcd.sensitivityMa}-${rcd.type}-${rcd.poles}-${rcd.selective}`,
        joinDesignations(rcd.designations),
        'УЗО',
        `${rcd.ratingA} А · ${rcd.sensitivityMa} мА · тип ${rcd.type}${
          rcd.selective ? ' S' : ''
        } · ${rcd.poles}P`,
        'модульное',
        rcd.designations.length
      )
    );
  }

  // Рамки — монтажная часть механизмов; идут перед материалами, после аппаратов.
  // Рамки считаются отдельно по монтажу: скрытая и накладная — разные изделия.
  const frameCounts = new Map<string, number>();
  for (const frame of options.frames ?? []) {
    const key = `${frame.mounting}:${frame.posts}`;
    frameCounts.set(key, (frameCounts.get(key) ?? 0) + 1);
  }
  for (const mounting of FRAME_MOUNTING_OPTIONS) {
    for (const posts of FRAME_POSTS_OPTIONS) {
      const count = frameCounts.get(`${mounting.id}:${posts}`) ?? 0;
      if (count === 0) continue;
      const widthMm = (posts - 1) * FRAME_POST_PITCH_MM + FRAME_SINGLE_WIDTH_MM;
      items.push(
        equipment(
          `frame-${mounting.id}-${posts}`,
          '—',
          `Подрозетник на ${FRAME_POSTS_WORD[posts]} (${mounting.label})`,
          `${widthMm} мм · плата под механизмы`,
          mounting.type,
          count
        )
      );
    }
  }

  items.push({
    id: 'input-cable',
    section: 'materials',
    designation: '—',
    name: 'Кабель вводной',
    detail: cableLabel(supply.inputCable.cores, supply.inputCable.sectionMm2),
    type: supply.cableBrand,
    unit: 'м',
    quantity: 0,
    note: 'длина по месту',
  });

  for (const cable of aggregateCables(
    panel,
    supply.cableBrand,
    options.cableLengthsMm
  )) {
    items.push({
      id: `cable-${cable.sectionMm2}-${cable.cores}`,
      section: 'materials',
      designation: '—',
      name: 'Кабель силовой',
      detail: cableLabel(cable.cores, cable.sectionMm2),
      type: cable.brand,
      unit: 'м',
      quantity:
        cable.lengthMm > 0 ? Math.ceil(cable.lengthMm / 1000 - 1e-9) : 0,
      note:
        cable.lengthMm > 0
          ? 'по длинам трасс с запасом'
          : 'длина не рассчитана',
    });
  }

  const totals: SpecificationTotals = {
    equipmentItems: items.filter((item) => item.section === 'equipment').length,
    equipmentUnits: items
      .filter((item) => item.section === 'equipment')
      .reduce((sum, item) => sum + item.quantity, 0),
    cableMeters: items
      .filter((item) => item.section === 'materials')
      .reduce((sum, item) => sum + item.quantity, 0),
  };

  const findings = options.findings ?? schematic.findings;
  const { status, errors, warnings } = statusFromFindings(findings);
  const statusText = statusTextFor(panel.lines.length, errors, warnings);
  const enclosure: SpecificationEnclosure = {
    modules: layout.enclosureModules,
    rails: layout.rowsCount,
    occupied: layout.modulesTotal,
    free: layout.freeModules,
    mounting: panel.mounting,
    reservePercent: layout.reservePercent,
  };

  const notes = [
    'Спецификация составлена по схеме ЭС-01 и расчётной таблице ЭС-02.',
    `Корпус: ${enclosure.modules} модулей (${enclosure.rails} реек), занято ${enclosure.occupied}, свободно ${enclosure.free}.`,
    `Класс модульных аппаратов по отключающей способности — ${capacity} (Icn, ГОСТ IEC 60898-1). УЗО класса не имеет.`,
    'Кабель групповых линий учтён по длинам трасс с проектным запасом; вводной кабель — по месту.',
    'Тип, марка и производитель аппаратов не заданы: подбираются по характеристикам и ТУ.',
    'Аппараты округлены до целых штук, кабель — до целого метра вверх.',
    'Документ не является коммерческим предложением; цены и артикулы не рассчитываются.',
    panel.lines.some((line) => line.combinedProtection && line.rcd)
      ? 'Дифавтомат объединяет автомат и УЗО в одном аппарате и занимает 2 модуля.'
      : 'Автомат и УЗО каждой линии закупаются отдельными позициями.',
    panel.lines.length > 0
      ? `Проверка по нормам: ошибок ${errors}, замечаний ${warnings}.`
      : 'Проверка по нормам: линии не заданы, состав щита не рассчитан.',
  ];

  return {
    panelName: panel.name,
    title: 'Спецификация оборудования и материалов',
    enclosure,
    items,
    totals,
    status,
    statusText,
    notes,
    references: [
      REF.breakerRatings,
      REF.socketsRcd,
      REF.selectivity,
      REF.sections,
      'СП 256.1325800.2016 (электроустановки жилых зданий)',
    ],
  };
}

export function specificationCableTotalLabel(
  specification: PanelSpecification
): string {
  return specification.totals.cableMeters > 0
    ? `${specification.totals.cableMeters} м`
    : 'не рассчитан';
}

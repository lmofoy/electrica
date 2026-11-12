import type { CircuitLine, ElectricalPanel, PhaseLabel, RoomZone } from '../../types';
import {
  BREAKER_RATINGS,
  CABLE_AMPACITY_A,
  CABLE_SECTIONS,
  MIN_SECTION_BY_PURPOSE,
  inputCurrentA,
  lineDesignCurrentA,
  lineDesignPowerW,
  panelDesignPowerW,
  panelInstalledPowerW,
  phaseForLine,
  voltageDropLimitPercent,
  voltageDropPercent,
} from './norms';

export type NormativeSeverity = 'error' | 'warning' | 'info';

export interface NormativeFinding {
  id: string;
  severity: NormativeSeverity;
  message: string;
  reference: string;
  lineId?: string;
}

export interface PanelValidationContext {
  rooms?: RoomZone[];
  cableLengthsMm?: Map<string, number> | Record<string, number>;
}

export const REF = {
  ampacity: 'ПУЭ-7, табл. 1.3.4',
  protection: 'ПУЭ-7, гл. 1.3',
  breakerRatings: 'ГОСТ IEC 60898-1',
  socketsRcd: 'ПУЭ-7, п. 7.1.79',
  fireRcd: 'ПУЭ-7, п. 7.1.84',
  selectivity: 'ГОСТ Р 50571.4.41 (селективность УЗО)',
  wetZone: 'СП 256.1325800.2016; ГОСТ Р 50571.4.41 (влажные зоны)',
  sections: 'СП 256.1325800.2016 (минимальные сечения)',
  power: 'СП 256.1325800.2016; ТУ на подключение',
  phases: 'СП 31-110-2003 (распределение нагрузок по фазам)',
  voltageDrop: 'Практика проектирования: ≤3 % освещение, ≤5 % прочие',
  cores: 'ПУЭ-7, гл. 2.1 (выбор проводников)',
} as const;

function isWetRoom(room: RoomZone): boolean {
  return room.type === 'bathroom' || room.type === 'toilet';
}

function lineServesWetRoom(line: CircuitLine, rooms?: RoomZone[]): boolean {
  if (!rooms) return false;
  return line.roomIds.some((roomId) => {
    const room = rooms.find((candidate) => candidate.id === roomId);
    return room ? isWetRoom(room) : false;
  });
}

function coversWetZone(rcd: ElectricalPanel['supply']['mainRcd']): boolean {
  return Boolean(rcd && rcd.sensitivityMa <= 30 && rcd.type === 'A');
}

function coversSockets(rcd: ElectricalPanel['supply']['mainRcd']): boolean {
  return Boolean(rcd && rcd.sensitivityMa <= 30);
}

function cableLengthFor(
  context: PanelValidationContext,
  lineId: string
): number {
  const source = context.cableLengthsMm;
  if (!source) return 0;
  if (source instanceof Map) return source.get(lineId) ?? 0;
  return source[lineId] ?? 0;
}

function hasRating(ratingA: number): boolean {
  return (BREAKER_RATINGS as readonly number[]).includes(ratingA);
}

function hasSection(sectionMm2: number): boolean {
  return (CABLE_SECTIONS as readonly number[]).includes(sectionMm2);
}

export function validatePanel(
  panel: ElectricalPanel,
  context: PanelValidationContext = {}
): NormativeFinding[] {
  const findings: NormativeFinding[] = [];
  const supply = panel.supply;
  const push = (finding: NormativeFinding) => findings.push(finding);

  const installedPowerW = panelInstalledPowerW(panel);
  const designPowerW = panelDesignPowerW(panel);
  const designCurrentA = inputCurrentA(
    designPowerW,
    supply.phases,
    supply.cosPhi
  );

  if (panel.lines.length === 0) {
    push({
      id: 'no-lines',
      severity: 'warning',
      message: 'В щитке нет ни одной линии. Добавьте линии или соберите черновик из приборов.',
      reference: REF.sections,
    });
  }

  const inputAmpacity = CABLE_AMPACITY_A[supply.inputCable.sectionMm2] ?? 0;
  if (!hasSection(supply.inputCable.sectionMm2)) {
    push({
      id: 'input-cable-section',
      severity: 'error',
      message: `Сечение вводного кабеля ${supply.inputCable.sectionMm2} мм² отсутствует в ряду стандартных сечений.`,
      reference: REF.protection,
    });
  }
  if (supply.inputBreaker.ratingA > inputAmpacity) {
    push({
      id: 'input-breaker-cable',
      severity: 'error',
      message: `Вводной автомат ${supply.inputBreaker.ratingA} А превышает допуск кабеля ${supply.inputCable.sectionMm2} мм² (${inputAmpacity} А).`,
      reference: REF.ampacity,
    });
  }
  if (!hasRating(supply.inputBreaker.ratingA)) {
    push({
      id: 'input-breaker-rating',
      severity: 'error',
      message: `Номинал вводного автомата ${supply.inputBreaker.ratingA} А отсутствует в ряду по ГОСТ IEC 60898-1.`,
      reference: REF.breakerRatings,
    });
  }
  if (designCurrentA > supply.inputBreaker.ratingA + 0.01) {
    push({
      id: 'input-current',
      severity: 'error',
      message: `Расчётный ток ввода ${designCurrentA.toFixed(1)} А превышает номинал вводного автомата ${supply.inputBreaker.ratingA} А.`,
      reference: REF.protection,
    });
  }
  if (designPowerW > supply.allocatedPowerW) {
    push({
      id: 'total-load',
      severity: 'warning',
      message: `Расчётная мощность ${(designPowerW / 1000).toFixed(1)} кВт превышает выделенную ${(supply.allocatedPowerW / 1000).toFixed(1)} кВт.`,
      reference: REF.power,
    });
  } else if (installedPowerW > supply.allocatedPowerW) {
    push({
      id: 'installed-over-allocated',
      severity: 'info',
      message: `Установленная мощность ${(installedPowerW / 1000).toFixed(1)} кВт выше выделенной, но расчётная ${(designPowerW / 1000).toFixed(1)} кВт — в пределах. Проверьте коэффициент спроса.`,
      reference: REF.power,
    });
  }
  if (supply.mainRcd && supply.mainRcd.ratingA < supply.inputBreaker.ratingA) {
    push({
      id: 'input-rcd-rating',
      severity: 'error',
      message: `Номинал противопожарного УЗО ${supply.mainRcd.ratingA} А ниже номинала вводного автомата ${supply.inputBreaker.ratingA} А.`,
      reference: REF.protection,
    });
  }
  if (supply.mainRcd && supply.mainRcd.sensitivityMa > 300) {
    push({
      id: 'main-rcd-high',
      severity: 'warning',
      message: `Противопожарное УЗО ${supply.mainRcd.sensitivityMa} мА: рекомендуется не более 300 мА.`,
      reference: REF.fireRcd,
    });
  }
  if (supply.mainRcd && supply.mainRcd.sensitivityMa === 30 && panel.lines.length > 4) {
    push({
      id: 'common-rcd-lines',
      severity: 'warning',
      message: `Одно УЗО 30 мА на ${panel.lines.length} линий: при срабатывании отключится весь щит. Для надёжности разделите защиту.`,
      reference: REF.socketsRcd,
    });
  }
  if (supply.phases === 3 && supply.inputCable.cores !== 5) {
    push({
      id: 'input-cores',
      severity: 'error',
      message: `Для трёхфазного ввода нужен 5-жильный кабель, выбран ${supply.inputCable.cores}-жильный.`,
      reference: REF.cores,
    });
  } else if (supply.phases === 1 && supply.inputCable.cores === 5) {
    push({
      id: 'input-cores',
      severity: 'info',
      message: 'Для однофазного ввода достаточно 3 жил; 5-жильный кабель допустим с запасом.',
      reference: REF.cores,
    });
  }

  for (const line of panel.lines) {
    const current = lineDesignCurrentA(line);
    const ampacity = CABLE_AMPACITY_A[line.cable.sectionMm2] ?? 0;
    const wetZone =
      line.purpose === 'wet' || lineServesWetRoom(line, context.rooms);
    const isLighting = line.purpose === 'lighting';

    if (!hasSection(line.cable.sectionMm2)) {
      push({
        id: `cable-section-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: сечение ${line.cable.sectionMm2} мм² отсутствует в ряду стандартных.`,
        reference: REF.protection,
        lineId: line.id,
      });
    }
    if (line.cable.sectionMm2 < MIN_SECTION_BY_PURPOSE[line.purpose]) {
      push({
        id: `min-section-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: сечение ${line.cable.sectionMm2} мм² меньше минимального ${MIN_SECTION_BY_PURPOSE[line.purpose]} мм² для этого назначения.`,
        reference: REF.sections,
        lineId: line.id,
      });
    }
    if (!hasRating(line.breaker.ratingA)) {
      push({
        id: `breaker-rating-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: номинал автомата ${line.breaker.ratingA} А отсутствует в ряду по ГОСТ IEC 60898-1.`,
        reference: REF.breakerRatings,
        lineId: line.id,
      });
    }
    if (line.breaker.ratingA > ampacity) {
      push({
        id: `breaker-cable-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: автомат ${line.breaker.ratingA} А больше допуска кабеля ${line.cable.sectionMm2} мм² (${ampacity} А).`,
        reference: REF.ampacity,
        lineId: line.id,
      });
    }
    if (current > line.breaker.ratingA + 0.01) {
      push({
        id: `load-breaker-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: ток нагрузки ${current.toFixed(1)} А превышает автомат ${line.breaker.ratingA} А.`,
        reference: REF.protection,
        lineId: line.id,
      });
    }
    if (line.rcd && line.rcd.ratingA < line.breaker.ratingA) {
      push({
        id: `rcd-rating-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: номинал УЗО ${line.rcd.ratingA} А ниже номинала автомата ${line.breaker.ratingA} А.`,
        reference: REF.selectivity,
        lineId: line.id,
      });
    }
    if (
      line.rcd &&
      supply.mainRcd &&
      supply.mainRcd.sensitivityMa < line.rcd.sensitivityMa * 3
    ) {
      push({
        id: `rcd-selectivity-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: вводное УЗО ${supply.mainRcd.sensitivityMa} мА неселективно к групповому ${line.rcd.sensitivityMa} мА (нужно не менее ${line.rcd.sensitivityMa * 3} мА).`,
        reference: REF.selectivity,
        lineId: line.id,
      });
    }
    if (wetZone && !coversWetZone(line.rcd) && !coversWetZone(supply.mainRcd)) {
      push({
        id: `wet-rcd-${line.id}`,
        severity: 'error',
        message: `«${line.name}»: влажная зона требует защиты УЗО 30 мА типа A (своё или общее).`,
        reference: REF.wetZone,
        lineId: line.id,
      });
    }
    if (
      !isLighting &&
      !wetZone &&
      !line.rcd &&
      !coversSockets(supply.mainRcd)
    ) {
      push({
        id: `line-rcd-${line.id}`,
        severity: 'warning',
        message: `«${line.name}»: розеточная линия без УЗО 30 мА.`,
        reference: REF.socketsRcd,
        lineId: line.id,
      });
    }
    if (isLighting && !wetZone && line.rcd) {
      push({
        id: `lighting-rcd-${line.id}`,
        severity: 'info',
        message: `«${line.name}»: УЗО на линии освещения не требуется, но допустимо.`,
        reference: REF.socketsRcd,
        lineId: line.id,
      });
    }
    if (isLighting && line.breaker.curve !== 'B') {
      push({
        id: `lighting-curve-${line.id}`,
        severity: 'info',
        message: `«${line.name}»: для освещения рекомендуется характеристика B.`,
        reference: REF.breakerRatings,
        lineId: line.id,
      });
    }

    const drop = voltageDropPercent(
      current,
      cableLengthFor(context, line.id),
      line.cable.sectionMm2
    );
    const dropLimit = voltageDropLimitPercent(line.purpose);
    if (drop > dropLimit) {
      push({
        id: `voltage-drop-${line.id}`,
        severity: 'warning',
        message: `«${line.name}»: потеря напряжения ${drop.toFixed(1)} % при длине ${(cableLengthFor(context, line.id) / 1000).toFixed(1)} м — больше ${dropLimit} %.`,
        reference: REF.voltageDrop,
        lineId: line.id,
      });
    }
  }

  if (supply.phases === 3 && panel.lines.length > 0) {
    const loads: Record<PhaseLabel, number> = { L1: 0, L2: 0, L3: 0 };
    panel.lines.forEach((line, index) => {
      const phase = phaseForLine(line, index, supply.phases);
      if (phase) loads[phase] += lineDesignPowerW(line);
    });
    const values = [loads.L1, loads.L2, loads.L3];
    const max = Math.max(...values);
    const min = Math.min(...values);
    const imbalance = max > 0 ? ((max - min) / max) * 100 : 0;
    if (imbalance > 15) {
      push({
        id: 'phase-imbalance',
        severity: 'warning',
        message: `Неравномерность нагрузок по фазам ${imbalance.toFixed(0)} %: L1 ${(loads.L1 / 1000).toFixed(1)}, L2 ${(loads.L2 / 1000).toFixed(1)}, L3 ${(loads.L3 / 1000).toFixed(1)} кВт. Рекомендуется не более 15 %.`,
        reference: REF.phases,
      });
    }
  }

  return findings;
}

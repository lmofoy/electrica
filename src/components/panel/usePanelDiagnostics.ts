import { useMemo } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { buildPanelLayout } from '../../core/electrical/panelLayout';
import { buildAutoLayout } from '../../core/geometry/autoLayout';
import { buildPanelCalculation } from '../../core/electrical/calculation';
import { buildPanelSchematic } from '../../core/electrical/schematic';
import { buildPanelSpecification } from '../../core/electrical/specification';
import { collectUnassignedDevices, collectDevicesWithFreeSlots } from '../../core/electrical/lineAssignment';
import { collectLineCompositionWarnings } from '../../core/electrical/lineOps';
import { deviceSlotLabel } from '../../core/electrical/devices';
import { computeLineRoutes } from '../../core/electrical/routing';
import type { NormativeFinding } from '../../core/electrical/panelValidation';
import type { PanelStep } from '../../types';

export type CheckGroup = 'norms' | 'lines' | 'routes' | 'panel';

export interface PanelCheckItem {
  id: string;
  group: CheckGroup;
  step: PanelStep;
  severity: 'error' | 'warning' | 'info';
  message: string;
  reference?: string;
  lineId?: string;
  deviceId?: string;
  slot?: number;
}

export const CHECK_GROUP_LABELS: Record<CheckGroup, string> = {
  norms: 'Нормы',
  lines: 'Состав линий',
  routes: 'Трассы',
  panel: 'Щиток',
};

const CABLE_FINDING_PREFIXES = [
  'cable-section-',
  'min-section-',
  'cable-load-',
  'voltage-drop-',
];

// Нормативные находки по кабелю показываем на шаге «Кабель и трасса»,
// остальные (автоматы, УЗО, селективность) — на шаге «Защита».
export function findingStep(id: string): PanelStep {
  return CABLE_FINDING_PREFIXES.some((prefix) => id.startsWith(prefix))
    ? 'cable'
    : 'protection';
}

export function findingsForStep(
  findings: NormativeFinding[] | undefined,
  step: PanelStep
): NormativeFinding[] {
  if (!findings) return [];
  return findings.filter((finding) => findingStep(finding.id) === step);
}

// Единый расчёт проверок щитка: все шаги «Трассировки» показывают одни и те же данные.
export function usePanelDiagnostics() {
  const {
    panel,
    rooms,
    devices,
    nodes,
    walls,
    openings,
    freePartitions,
    frames,
    settings,
    boundaryMode,
  } = useProjectStore();

  const layout = useMemo(
    () => (panel ? buildPanelLayout(panel, { rooms }) : null),
    [panel, rooms]
  );
  const autoLayout = useMemo(
    () =>
      boundaryMode === 'auto'
        ? buildAutoLayout(
            rooms,
            freePartitions,
            openings,
            settings.defaultWallThicknessMm
          )
        : null,
    [boundaryMode, rooms, freePartitions, openings, settings.defaultWallThicknessMm]
  );
  const routes = useMemo(
    () =>
      computeLineRoutes({
        panel,
        devices,
        rooms,
        partitions: freePartitions,
        nodes,
        walls,
        settings,
      }),
    [panel, devices, rooms, freePartitions, nodes, walls, settings]
  );
  const totalCableMm = useMemo(
    () =>
      [...routes.values()].reduce(
        (sum, route) => sum + (route.cableLengthMm || 0),
        0
      ),
    [routes]
  );
  const unassignedDevices = useMemo(
    () => collectUnassignedDevices(devices, panel),
    [devices, panel]
  );
  const devicesWithFreeSlots = useMemo(
    () => collectDevicesWithFreeSlots(devices, panel),
    [devices, panel]
  );
  const compositionWarnings = useMemo(
    () => (panel ? collectLineCompositionWarnings(panel, devices) : []),
    [panel, devices]
  );
  const cableLengthsMm = useMemo(() => {
    const map = new Map<string, number>();
    for (const [lineId, route] of routes) map.set(lineId, route.cableLengthMm);
    return map;
  }, [routes]);
  const schematic = useMemo(
    () => (panel ? buildPanelSchematic(panel, { rooms, cableLengthsMm }) : null),
    [panel, rooms, cableLengthsMm]
  );
  const calculation = useMemo(
    () =>
      panel ? buildPanelCalculation(panel, { rooms, cableLengthsMm }) : null,
    [panel, rooms, cableLengthsMm]
  );
  const specification = useMemo(
    () =>
      panel
        ? buildPanelSpecification(panel, {
            rooms,
            cableLengthsMm,
            findings: schematic?.findings,
            frames,
          })
        : null,
    [panel, rooms, cableLengthsMm, schematic, frames]
  );

  const checks = useMemo<PanelCheckItem[]>(() => {
    if (!panel || !layout) return [];
    const sampleNames = unassignedDevices
      .slice(0, 3)
      .map((device) => device.name)
      .join(', ');

    const routingWarnings: PanelCheckItem[] = [];
    const seenWarnings = new Set<string>();
    for (const [lineId, route] of routes) {
      if (!route.warning || seenWarnings.has(route.warning)) continue;
      seenWarnings.add(route.warning);
      routingWarnings.push({
        id: `route-warning-${lineId}`,
        group: 'routes',
        step: 'cable',
        severity: 'info',
        message: route.warning,
        lineId,
      });
    }

    const missingTrace: PanelCheckItem[] = panel.lines
      .filter(
        (line) =>
          line.trace === 'none' && !line.manualRoute && line.deviceIds.length > 0
      )
      .map((line) => ({
        id: `route-missing-${line.id}`,
        group: 'routes',
        step: 'cable',
        severity: 'warning',
        message: `«${line.name}»: трасса не проложена — кабель не учтён в длинах и ведомости.`,
        lineId: line.id,
      }));

    const emptyLines: PanelCheckItem[] = panel.lines
      .filter((line) => line.deviceIds.length === 0)
      .map((line) => ({
        id: `line-empty-${line.id}`,
        group: 'lines',
        step: 'devices',
        severity: 'warning',
        message: `«${line.name}»: в линии нет приборов — добавьте их в составе.`,
        lineId: line.id,
      }));

    const freeSlotChecks: PanelCheckItem[] = devicesWithFreeSlots.map(
      ({ device, slots }) => {
        const labels = slots
          .map((slot) => deviceSlotLabel(device, slot))
          .join(', ');
        return {
          id: `free-slots-${device.id}`,
          group: 'lines',
          step: 'devices',
          severity: 'warning',
          message: `«${device.name}»: ${
            slots.length === 1 ? `${labels} не назначена` : `${labels} не назначены`
          } ни в одну линию — клавиша без кабеля не попадёт в трассу.`,
          deviceId: device.id,
          slot: slots[0],
        };
      }
    );

    return [
      ...layout.warnings.map((warning) => ({
        ...warning,
        group: 'panel' as const,
        step: 'protection' as const,
      })),
      ...(schematic?.findings ?? []).map((finding) => ({
        id: finding.id,
        group: 'norms' as const,
        step: findingStep(finding.id),
        severity: finding.severity,
        message: finding.message,
        reference: finding.reference,
        lineId: finding.lineId,
      })),
      ...compositionWarnings.map((warning) => ({
        id: warning.id,
        group: 'lines' as const,
        step: (warning.id.startsWith('wet-device-rcd-')
          ? 'protection'
          : 'devices') as PanelStep,
        severity: warning.severity,
        message: warning.message,
        lineId: warning.lineId,
        deviceId: warning.deviceId,
        slot: warning.slot,
      })),
      ...(unassignedDevices.length
        ? [
            {
              id: 'unassigned-devices',
              group: 'lines' as const,
              step: 'devices' as const,
              severity: 'warning' as const,
              message: `Вне линий: ${unassignedDevices.length} приб. (${sampleNames}${
                unassignedDevices.length > 3 ? '…' : ''
              }). Они не попадут в трассы — пересоберите линии из приборов.`,
            },
          ]
        : []),
      ...emptyLines,
      ...freeSlotChecks,
      ...missingTrace,
      ...routingWarnings,
    ];
  }, [
    panel,
    layout,
    schematic,
    compositionWarnings,
    unassignedDevices,
    devicesWithFreeSlots,
    routes,
  ]);

  const errors = checks.filter((check) => check.severity === 'error').length;
  const warnings = checks.filter((check) => check.severity === 'warning').length;

  const lineChecks = useMemo(() => {
    const map = new Map<string, PanelCheckItem[]>();
    for (const check of checks) {
      if (!check.lineId) continue;
      const list = map.get(check.lineId) ?? [];
      list.push(check);
      map.set(check.lineId, list);
    }
    return map;
  }, [checks]);

  const checksByStep = useMemo(() => {
    const result: Record<PanelStep, { errors: number; warnings: number; total: number }> = {
      devices: { errors: 0, warnings: 0, total: 0 },
      cable: { errors: 0, warnings: 0, total: 0 },
      protection: { errors: 0, warnings: 0, total: 0 },
    };
    for (const check of checks) {
      const bucket = result[check.step];
      bucket.total += 1;
      if (check.severity === 'error') bucket.errors += 1;
      else if (check.severity === 'warning') bucket.warnings += 1;
    }
    return result;
  }, [checks]);

  return {
    panel,
    layout,
    autoLayout,
    routes,
    totalCableMm,
    unassignedDevices,
    cableLengthsMm,
    schematic,
    calculation,
    specification,
    frames,
    lineChecks,
    checks,
    checksByStep,
    errors,
    warnings,
  };
}

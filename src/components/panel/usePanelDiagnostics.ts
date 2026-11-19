import { useMemo } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { buildPanelLayout } from '../../core/electrical/panelLayout';
import { buildAutoLayout } from '../../core/geometry/autoLayout';
import { buildPanelCalculation } from '../../core/electrical/calculation';
import { buildPanelSchematic } from '../../core/electrical/schematic';
import { buildPanelSpecification } from '../../core/electrical/specification';
import { collectUnassignedDevices } from '../../core/electrical/lineAssignment';
import { collectLineCompositionWarnings } from '../../core/electrical/lineOps';
import { computeLineRoutes } from '../../core/electrical/routing';

export type CheckGroup = 'norms' | 'lines' | 'routes' | 'panel';

export interface PanelCheckItem {
  id: string;
  group: CheckGroup;
  severity: 'error' | 'warning' | 'info';
  message: string;
  reference?: string;
  lineId?: string;
}

export const CHECK_GROUP_LABELS: Record<CheckGroup, string> = {
  norms: 'Нормы',
  lines: 'Линии',
  routes: 'Трассы',
  panel: 'Щиток',
};

// Единый расчёт проверок щитка: вкладка «Щиток» и шаг «Проверка»
// показывают одни и те же данные.
export function usePanelDiagnostics() {
  const {
    panel,
    rooms,
    devices,
    nodes,
    walls,
    openings,
    freePartitions,
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
          })
        : null,
    [panel, rooms, cableLengthsMm, schematic]
  );

  const checks = useMemo<PanelCheckItem[]>(() => {
    if (!panel || !layout) return [];
    const sampleNames = unassignedDevices
      .slice(0, 3)
      .map((device) => device.name)
      .join(', ');
    const routingWarnings = [
      ...new Set(
        [...routes.values()]
          .map((route) => route.warning)
          .filter((warning): warning is string => warning !== null)
      ),
    ].map((message, index) => ({
      id: `route-warning-${index}`,
      group: 'routes' as const,
      severity: 'info' as const,
      message,
    }));

    return [
      ...layout.warnings.map((warning) => ({
        ...warning,
        group: 'panel' as const,
      })),
      ...(schematic?.findings ?? []).map((finding) => ({
        ...finding,
        group: 'lines' as const,
      })),
      ...compositionWarnings.map((warning) => ({
        ...warning,
        group: 'lines' as const,
      })),
      ...(unassignedDevices.length
        ? [
            {
              id: 'unassigned-devices',
              group: 'lines' as const,
              severity: 'warning' as const,
              message: `Вне линий: ${unassignedDevices.length} приб. (${sampleNames}${
                unassignedDevices.length > 3 ? '…' : ''
              }). Они не попадут в трассы — пересоберите линии из приборов.`,
            },
          ]
        : []),
      ...routingWarnings,
    ];
  }, [panel, layout, schematic, compositionWarnings, unassignedDevices, routes]);

  const errors = checks.filter((check) => check.severity === 'error').length;
  const warnings = checks.filter((check) => check.severity === 'warning').length;

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
    checks,
    errors,
    warnings,
  };
}

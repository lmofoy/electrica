import React from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { usePanelDiagnostics } from '../panel/usePanelDiagnostics';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { ProjectStep } from '../../types';

const STEP_HINTS: Record<ProjectStep, string> = {
  plan: 'План: комнаты, проёмы, перегородки и электрика',
  lines: 'Трассировка: линии, трассы, кабели и защита',
  docs: 'Документы: листы A3 по проекту',
};

export const StatusBar: React.FC = () => {
  const { activeStep, rooms, devices, freePartitions } = useProjectStore();
  const { errors, warnings, checks } = usePanelDiagnostics();

  const roomIdsWithDevices = new Set<string>();
  const partitionIdsWithDevices = new Set<string>();
  for (const device of devices) {
    if (device.anchor.kind === 'room_edge' || device.anchor.kind === 'room_point') {
      roomIdsWithDevices.add(device.anchor.roomId);
    } else if (device.anchor.kind === 'partition') {
      partitionIdsWithDevices.add(device.anchor.partitionId);
    }
  }
  for (const partition of freePartitions) {
    if (partitionIdsWithDevices.has(partition.id)) {
      roomIdsWithDevices.add(partition.roomId);
    }
  }
  const readyRooms = rooms.filter((room) => roomIdsWithDevices.has(room.id)).length;

  return (
    <footer className="shrink-0 h-7 bg-slate-950 border-t border-slate-800 px-3 flex items-center gap-3 text-[10px] font-mono text-slate-400 select-none z-30">
      <span className="truncate">{STEP_HINTS[activeStep]}</span>

      <div className="ml-auto flex items-center gap-3 shrink-0">
        {rooms.length > 0 && (
          <span title="Комнаты, в которых уже есть хотя бы один прибор">
            Приборы в комнатах: <strong className="text-slate-200">{readyRooms}/{rooms.length}</strong>
          </span>
        )}
        <span className="text-slate-700">|</span>
        <button
          onClick={() => {
            const state = useProjectStore.getState();
            const firstProblem =
              checks.find((check) => check.severity === 'error') ?? checks[0];
            state.setPanelStep(firstProblem?.step ?? 'devices');
            state.setActiveStep('lines');
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                document
                  .getElementById('panel-checks')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              )
            );
          }}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition hover:bg-slate-800 ${
            errors > 0
              ? 'text-rose-300'
              : warnings > 0
                ? 'text-amber-300'
                : 'text-emerald-300'
          }`}
          title="Показать замечания и ошибки в панели «Трассировка»"
        >
          {errors > 0 || warnings > 0 ? (
            <AlertTriangle size={11} />
          ) : (
            <ShieldCheck size={11} />
          )}
          {errors > 0
            ? `${errors} ош.`
            : warnings > 0
              ? `${warnings} зам.`
              : 'Проверка: ОК'}
        </button>
      </div>
    </footer>
  );
};

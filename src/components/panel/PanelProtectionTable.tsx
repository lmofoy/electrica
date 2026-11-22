import React from 'react';
import type { CircuitLine, ElectricalPanel, RcdSpec } from '../../types';
import {
  BREAKER_RATINGS,
  CABLE_AMPACITY_A,
  makeBreaker,
  makeRcd,
  maxBreakerForSection,
} from '../../core/electrical/norms';
import { lineCurrentA } from '../../core/electrical/panel';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { PanelCheckItem } from './usePanelDiagnostics';

interface PanelProtectionTableProps {
  panel: ElectricalPanel;
  highlightedLineId: string | null;
  lineChecks: Map<string, PanelCheckItem[]>;
  onHighlight: (id: string | null) => void;
  onUpdate: (id: string, updates: Partial<CircuitLine>) => void;
  onOpenCable: (lineId: string) => void;
}

const CHECK_TEXT: Record<PanelCheckItem['severity'], string> = {
  error: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300',
};

const stripLinePrefix = (message: string) => message.replace(/^«[^»]+»:\s*/, '');

function rcdValue(line: CircuitLine): string {
  if (!line.rcd) return 'off';
  return `${line.rcd.sensitivityMa}-${line.rcd.type}`;
}

function applyRcdValue(line: CircuitLine, value: string): RcdSpec | null {
  if (value === 'off') return null;
  const [sensitivity, type] = value.split('-');
  return makeRcd(Number(sensitivity), type as 'A' | 'AC', line.breaker.ratingA);
}

export const PanelProtectionTable: React.FC<PanelProtectionTableProps> = ({
  panel,
  highlightedLineId,
  lineChecks,
  onHighlight,
  onUpdate,
  onOpenCable,
}) => {
  const lineColors = buildLineColorMap(panel);

  if (panel.lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-center">
        <p className="text-xs text-slate-400 mb-1">Линий пока нет.</p>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Сначала соберите линии из приборов на шаге 1 — здесь появятся их автоматы и
          УЗО.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {panel.lines.map((line, index) => {
        const current = lineCurrentA(line);
        const ampacity = CABLE_AMPACITY_A[line.cable.sectionMm2] ?? 0;
        const maxRating = maxBreakerForSection(line.cable.sectionMm2);
        const allowedRatings = BREAKER_RATINGS.filter(
          (rating) => maxRating === 0 || rating <= maxRating
        );
        const ratingOptions = (allowedRatings as readonly number[]).includes(
          line.breaker.ratingA
        )
          ? allowedRatings
          : [...allowedRatings, line.breaker.ratingA].sort((a, b) => a - b);
        const checks = (lineChecks.get(line.id) ?? []).filter(
          (check) => check.step === 'protection'
        );
        const hasError = checks.some((check) => check.severity === 'error');
        const breakerError = checks.some(
          (check) =>
            check.severity === 'error' &&
            (check.id.startsWith('breaker-') || check.id.startsWith('load-breaker-'))
        );
        const rcdError = checks.some(
          (check) => check.severity === 'error' && check.id.includes('rcd')
        );
        const lineColor = lineColors.get(line.id) ?? '#38bdf8';
        const active = line.id === highlightedLineId;

        return (
          <div
            key={line.id}
            className={`rounded-lg border px-2 py-1.5 transition ${
              hasError
                ? 'bg-rose-500/5 border-rose-500/30'
                : 'bg-slate-950/60 border-slate-800/80'
            }`}
            style={
              active
                ? {
                    borderColor: lineColor,
                    backgroundColor: `${lineColor}1f`,
                    boxShadow: `0 0 0 1px ${lineColor}66`,
                  }
                : undefined
            }
          >
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onHighlight(active ? null : line.id)}
                className="shrink-0 rounded-full p-0.5 transition"
                title={active ? 'Снять подсветку' : 'Подсветить линию на плане'}
              >
                <span
                  className="block w-2.5 h-2.5 rounded-full"
                  style={{
                    backgroundColor: lineColor,
                    boxShadow: active ? `0 0 6px ${lineColor}` : undefined,
                  }}
                />
              </button>
              <span
                className="shrink-0 rounded border border-slate-700 px-1 py-0.5 font-mono text-[9px] text-slate-400"
                title="Код группы — тот же номер на плане и в документах"
              >
                гр. {line.code ?? index + 2}
              </span>
              <span className="flex-1 min-w-0 truncate text-[11px] font-semibold text-white">
                {line.name}
              </span>
              <span
                className="shrink-0 font-mono text-[10px] text-slate-500"
                title="Расчётный ток линии при её нагрузке"
              >
                I {current.toFixed(1)} А
              </span>
            </div>

            <div className="mt-1 grid grid-cols-2 gap-1">
              <div className="min-w-0">
                <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                  Автомат
                </span>
                <select
                  value={line.breaker.ratingA}
                  onChange={(e) =>
                    onUpdate(line.id, {
                      breaker: makeBreaker(
                        Number(e.target.value),
                        line.breaker.curve
                      ),
                    })
                  }
                  className={`w-full bg-slate-900 border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-sky-500 ${
                    breakerError
                      ? 'border-rose-700/70 text-rose-300'
                      : 'border-slate-700 text-slate-200'
                  }`}
                  title={
                    maxRating > 0
                      ? `Автомат ограничен допуском кабеля ${line.cable.sectionMm2} мм² — до ${maxRating} А`
                      : 'Номинал автомата — не ниже тока нагрузки и не выше допуска кабеля'
                  }
                >
                  {ratingOptions.map((rating) => (
                    <option key={rating} value={rating}>
                      {rating} А · {line.breaker.curve}
                      {maxRating > 0 && rating > maxRating
                        ? ' — выше допуска кабеля'
                        : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-0">
                <span className="block text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">
                  УЗО
                </span>
                <select
                  value={rcdValue(line)}
                  onChange={(e) =>
                    onUpdate(line.id, { rcd: applyRcdValue(line, e.target.value) })
                  }
                  className={`w-full bg-slate-900 border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-sky-500 ${
                    rcdError
                      ? 'border-rose-700/70 text-rose-300'
                      : line.purpose === 'lighting' && !line.rcd
                        ? 'border-slate-700 text-slate-400'
                        : line.rcd
                          ? 'border-emerald-700/60 text-emerald-300'
                          : 'border-amber-700/60 text-amber-300'
                  }`}
                >
                  <option value="off">Без УЗО</option>
                  <option value="10-A">10 мА · A</option>
                  <option value="30-A">30 мА · A</option>
                  <option value="30-AC">30 мА · AC</option>
                  <option value="100-A">100 мА · A</option>
                  <option value="300-A">300 мА · A</option>
                </select>
              </div>
            </div>

            <div className="mt-1 flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
              <span title="Допуск кабеля и наибольший автомат, который он защищает">
                кабель {line.cable.sectionMm2} мм² · допуск {ampacity} А
                {maxRating > 0 ? ` · автомат до ${maxRating} А` : ''}
              </span>
              {hasError && <AlertTriangle size={10} className="text-rose-400 shrink-0" />}
              <button
                onClick={() => onOpenCable(line.id)}
                className="ml-auto flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[9px] transition hover:border-sky-500/60 hover:text-sky-300"
                title="Изменить кабель и трассу линии на шаге 2"
              >
                Кабель
                <ArrowRight size={9} />
              </button>
            </div>

            {checks.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {checks.map((check) => (
                  <p
                    key={check.id}
                    className={`text-[9px] leading-snug ${CHECK_TEXT[check.severity]}`}
                    title={check.reference}
                  >
                    {stripLinePrefix(check.message)}
                  </p>
                ))}
                {(breakerError || checks.some((check) => check.id.startsWith('load-breaker-'))) && (
                  <p className="text-[9px] leading-snug text-slate-400">
                    Кабель первичен: автомат не выше его допуска. Если ток линии не
                    помещается — увеличьте сечение на шаге 2.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

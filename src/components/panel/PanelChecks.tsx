import React from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import {
  CHECK_GROUP_LABELS,
  usePanelDiagnostics,
  type CheckGroup,
  type PanelCheckItem,
} from './usePanelDiagnostics';
import { AlertTriangle, CheckCircle2, Eye, Info, XCircle } from 'lucide-react';

const GROUP_ORDER: CheckGroup[] = ['norms', 'lines', 'routes', 'panel'];

const SEVERITY_STYLE = {
  error: {
    icon: <XCircle size={12} />,
    className: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  },
  warning: {
    icon: <AlertTriangle size={12} />,
    className: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  },
  info: {
    icon: <Info size={12} />,
    className: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  },
} as const;

export const PanelChecks: React.FC = () => {
  const { checks, errors, warnings } = usePanelDiagnostics();
  const setHighlightedLine = useProjectStore((state) => state.setHighlightedLine);
  const setPanelStep = useProjectStore((state) => state.setPanelStep);
  const setWarningFocus = useProjectStore((state) => state.setWarningFocus);

  const showCheck = (item: PanelCheckItem) => {
    if (item.lineId) setHighlightedLine(item.lineId);
    setWarningFocus(
      item.deviceId ? { deviceId: item.deviceId, slot: item.slot } : null
    );
    setPanelStep(item.step);
    requestAnimationFrame(() => {
      document
        .getElementById(`panel-step-${item.step}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <section
      id="panel-checks"
      className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5 scroll-mt-2"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-white">Замечания и ошибки</div>
        <div className="flex items-center gap-2 text-[9px] font-mono">
          <span className={errors > 0 ? 'text-rose-300' : 'text-slate-500'}>
            {errors} ош.
          </span>
          <span className={warnings > 0 ? 'text-amber-300' : 'text-slate-500'}>
            {warnings} зам.
          </span>
        </div>
      </div>

      {checks.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-300">
          <CheckCircle2 size={14} />
          <span className="text-[10px] font-semibold">
            Ошибок не найдено. Линии, трассы и щиток соответствуют выбранным правилам.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {GROUP_ORDER.map((group) => {
            const items = checks.filter((check) => check.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    {CHECK_GROUP_LABELS[group]}
                  </span>
                  <span className="text-[9px] font-mono text-slate-500">{items.length}</span>
                </div>
                {items.map((item) => {
                  const style = SEVERITY_STYLE[item.severity];
                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-1.5 ${style.className}`}
                    >
                      <div className="flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0">{style.icon}</span>
                        <span className="text-[9px] leading-snug">
                          {item.message}
                          {item.reference && (
                            <span className="block mt-0.5 text-[8px] opacity-60">
                              {item.reference}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="mt-1 flex justify-end">
                        <button
                          onClick={() => showCheck(item)}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/15 text-[9px] font-semibold hover:bg-white/10 transition"
                          title="Открыть нужный шаг и подсветить линию на плане"
                        >
                          <Eye size={10} />
                          Показать
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-[9px] text-slate-500 leading-snug">
        Расчёт носит справочный характер. Перед монтажом проверьте вводные данные
        (ТУ, тип кабеля, условия прокладки) с проектировщиком.
      </p>
    </section>
  );
};

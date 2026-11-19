import React from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import {
  CHECK_GROUP_LABELS,
  usePanelDiagnostics,
  type CheckGroup,
} from '../panel/usePanelDiagnostics';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  ShieldCheck,
  Eye,
  CircuitBoard,
  ArrowRight,
} from 'lucide-react';

const GROUP_ORDER: CheckGroup[] = ['norms', 'lines', 'routes', 'panel'];

const SEVERITY_STYLE = {
  error: { icon: <XCircle size={13} />, className: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
  warning: { icon: <AlertTriangle size={13} />, className: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  info: { icon: <Info size={13} />, className: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
} as const;

export const CheckPanel: React.FC = () => {
  const { setActiveStep, setLinesTab, setHighlightedLine } = useProjectStore();
  const { panel, checks, errors, warnings } = usePanelDiagnostics();

  return (
    <aside className="w-full md:w-80 shrink-0 bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col h-[40%] md:h-full min-h-0 text-slate-200 select-none">
      <div className="p-4 border-b border-slate-800 bg-slate-950/60">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-sky-400 shrink-0" />
          <h2 className="text-sm font-bold text-white">Проверка проекта</h2>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[10px] font-mono">
          <span className="text-rose-300">{errors} ошибок</span>
          <span className="text-amber-300">{warnings} замечаний</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!panel ? (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-400 leading-snug">
              Проверка появится, когда вы разместите щиток на плане и соберёте линии.
            </p>
            <button
              onClick={() => setActiveStep('devices')}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-semibold transition"
            >
              <CircuitBoard size={13} />
              Перейти к приборам
              <ArrowRight size={13} />
            </button>
          </div>
        ) : checks.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-300">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
            <span className="text-[11px] font-semibold leading-snug">
              Ошибок не найдено. Все линии, трассы и щиток соответствуют выбранным правилам.
            </span>
          </div>
        ) : (
          GROUP_ORDER.map((group) => {
            const items = checks.filter((check) => check.group === group);
            if (items.length === 0) return null;
            return (
              <section key={group} className="space-y-1">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {CHECK_GROUP_LABELS[group]}
                  </h3>
                  <span className="text-[9px] font-mono text-slate-500">{items.length}</span>
                </div>
                {items.map((item) => {
                  const style = SEVERITY_STYLE[item.severity];
                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-2 ${style.className}`}
                    >
                      <div className="flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0">{style.icon}</span>
                        <span className="text-[10px] leading-snug">{item.message}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[8px] opacity-60 leading-tight">
                          {item.reference ?? ''}
                        </span>
                        <button
                          onClick={() => {
                            if (item.lineId) setHighlightedLine(item.lineId);
                            setActiveStep('lines');
                            setLinesTab(group === 'panel' ? 'panel' : 'lines');
                          }}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/15 text-[9px] font-semibold hover:bg-white/10 transition shrink-0"
                          title="Показать место на плане"
                        >
                          <Eye size={10} />
                          Показать
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })
        )}

        <p className="text-[9px] text-slate-500 leading-snug">
          Расчёт носит справочный характер. Перед монтажом проверьте вводные данные
          (ТУ, тип кабеля, условия прокладки) с проектировщиком.
        </p>
      </div>
    </aside>
  );
};

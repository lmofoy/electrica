import React from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { X, AlertCircle, Info, CheckCircle2 } from 'lucide-react';

export const ToastProvider: React.FC = () => {
  const { toasts, removeToast } = useProjectStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl border 
            min-w-[320px] animate-in fade-in slide-in-from-top-4 duration-300
            ${toast.type === 'error' ? 'bg-red-950 border-red-500/50 text-red-200' : ''}
            ${toast.type === 'info' ? 'bg-slate-900 border-slate-700 text-slate-200' : ''}
            ${toast.type === 'success' ? 'bg-emerald-950 border-emerald-500/50 text-emerald-200' : ''}
          `}
        >
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-red-400" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400" />}
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          
          <span className="flex-1 text-sm font-medium">{toast.message}</span>
          
          <button
            onClick={() => removeToast(toast.id)}
            className="p-1 hover:bg-white/10 rounded-md transition-colors"
          >
            <X className="w-4 h-4 opacity-70" />
          </button>
        </div>
      ))}
    </div>
  );
};

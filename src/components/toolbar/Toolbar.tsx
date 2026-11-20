import React, { useRef } from 'react';
import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  Settings,
  Save,
  Upload,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  getProjectSnapshot,
  isProjectSnapshot,
  useProjectStore,
} from '../../store/useProjectStore';
import { DEVICE_CATALOG } from '../../core/electrical/devices';
import type { ProjectStep } from '../../types';

interface ToolbarProps {
  onOpenSettings: () => void;
}

const STEPS: { id: ProjectStep; label: string }[] = [
  { id: 'plan', label: 'План' },
  { id: 'lines', label: 'Трассировка' },
  { id: 'docs', label: 'Документы' },
];

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenSettings }) => {
  const {
    activeStep,
    activeTool,
    activeDeviceType,
    settings,
    zoom,
    setActiveStep,
    setZoom,
    setStagePos,
    resetProject,
    addToast,
    toggleDimensions,
  } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const stepSubtitle = (() => {
    switch (activeStep) {
      case 'plan':
        if (activeTool === 'place_device') {
          return `План · прибор: ${DEVICE_CATALOG[activeDeviceType].label}`;
        }
        if (activeTool === 'place_panel') return 'План · размещение щитка';
        if (activeTool === 'select') return 'План · комнаты, проёмы и электрика';
        return 'План · разметка и электрика';
      case 'lines':
        return 'Трассировка · линии, кабели и защита';
      case 'docs':
        return 'Документы · листы A3';
    }
  })();

  const handleUndo = () => {
    useProjectStore.temporal.getState().undo();
  };

  const handleRedo = () => {
    useProjectStore.temporal.getState().redo();
  };

  const handleExport = () => {
    const snapshot = getProjectSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `electrica-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    addToast('Проект сохранён в файл.', 'success');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isProjectSnapshot(parsed)) {
        addToast('Файл не похож на проект Electrica.', 'error');
        return;
      }
      useProjectStore.getState().loadProject(parsed);
      addToast('Проект загружен из файла.', 'success');
    } catch {
      addToast('Не удалось прочитать JSON-файл.', 'error');
    }
  };

  const handleCenterView = () => {
    const viewport = document.querySelector('main');
    if (!viewport) return;
    const state = useProjectStore.getState();
    const points = [
      ...(state.apartment?.vertices ?? []),
      ...state.rooms.flatMap((room) => room.vertices),
      ...(state.panel?.lines.flatMap((line) => line.waypoints ?? []) ?? []),
    ];
    if (points.length === 0) {
      setZoom(0.12);
      setStagePos({ x: 120, y: 120 });
      return;
    }
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = viewport.clientWidth, height = viewport.clientHeight;
    const scale = Math.max(0.02, Math.min(1.5,
      Math.max(1, width - 100) / Math.max(1, maxX - minX),
      Math.max(1, height - 100) / Math.max(1, maxY - minY)));
    setZoom(scale);
    setStagePos({ x: width / 2 - (minX + maxX) / 2 * scale,
      y: height / 2 - (minY + maxY) / 2 * scale });
  };

  return (
    <header className="shrink-0 bg-slate-900 border-b border-slate-800 px-3 py-2 flex flex-wrap items-center gap-3 text-slate-200 select-none z-40">
      {/* Логотип и текущий шаг */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky-600 text-white font-bold shadow-lg shadow-sky-900/40">
          ⚡
        </div>
        <div className="min-w-0">
          <h1 className="font-bold text-sm tracking-wide text-white leading-tight">ELECTRICA</h1>
          <p className="text-[10px] text-slate-400 font-mono uppercase tracking-tighter truncate max-w-[240px]">
            {stepSubtitle}
          </p>
        </div>
      </div>

      {/* Степпер проекта */}
      <nav
        className="flex items-center gap-1 bg-slate-950/80 p-0.5 rounded-xl border border-slate-800"
        aria-label="Шаги проекта"
      >
        {STEPS.map((step, index) => {
          const active = activeStep === step.id;
          return (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                active
                  ? 'bg-sky-500 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title={`Шаг ${index + 1}: ${step.label}`}
            >
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center text-[9px] leading-none ${
                  active ? 'border-white/70 text-white' : 'border-slate-600 text-slate-500'
                }`}
              >
                {index + 1}
              </span>
              {step.label}
            </button>
          );
        })}
      </nav>

      {/* История, масштаб и файл */}
      <div className="flex flex-wrap items-center gap-1.5 ml-auto">
        <div className="flex items-center bg-slate-950/70 rounded-lg p-0.5 border border-slate-800">
          <button
            onClick={handleUndo}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
            title="Отменить (Ctrl+Z)"
          >
            <Undo2 size={15} />
          </button>
          <button
            onClick={handleRedo}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
            title="Повторить (Ctrl+Y)"
          >
            <Redo2 size={15} />
          </button>
        </div>

        <div className="flex items-center bg-slate-950/70 rounded-lg p-0.5 border border-slate-800 text-xs">
          <button
            onClick={() => setZoom((z) => Math.max(z / 1.2, 0.02))}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
            title="Уменьшить"
          >
            <ZoomOut size={15} />
          </button>
          <span className="px-1.5 font-mono text-[11px] text-slate-300 tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(z * 1.2, 1.5))}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
            title="Увеличить"
          >
            <ZoomIn size={15} />
          </button>
          <button
            onClick={handleCenterView}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
            title="Центрировать вид"
          >
            <Maximize2 size={15} />
          </button>
        </div>

        <button
          onClick={toggleDimensions}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition ${
            settings.showDimensions
              ? 'text-sky-400 bg-sky-500/10 border border-sky-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
          }`}
          title={settings.showDimensions ? 'Скрыть размеры' : 'Показать размеры'}
        >
          {settings.showDimensions ? <Eye size={14} /> : <EyeOff size={14} />}
          <span className="hidden lg:inline">Размеры</span>
        </button>

        <button
          onClick={handleExport}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          title="Сохранить проект в файл (JSON)"
        >
          <Save size={15} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          title="Загрузить проект из файла (JSON)"
        >
          <Upload size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          className="hidden"
        />

        <button
          onClick={onOpenSettings}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg border border-slate-800 transition"
          title="Настройки стен и проекта"
        >
          <Settings size={16} />
        </button>

        <button
          onClick={() => {
            if (confirm('Очистить проект и начать заново?')) {
              resetProject();
            }
          }}
          className="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg border border-slate-800 transition"
          title="Очистить проект"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </header>
  );
};

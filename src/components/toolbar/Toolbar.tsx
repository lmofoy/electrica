import React from 'react';
import {
  MousePointer,
  Hand,
  PenTool,
  Scissors,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  Settings,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { RoomType } from '../../types';

interface ToolbarProps {
  onOpenSettings: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenSettings }) => {
  const {
    activeTool,
    activeRoomType,
    zoom,
    setActiveTool,
    setActiveRoomType,
    setZoom,
    setStagePos,
    resetProject,
  } = useProjectStore();

  const handleUndo = () => {
    (useProjectStore.temporal.getState() as any).undo?.();
  };

  const handleRedo = () => {
    (useProjectStore.temporal.getState() as any).redo?.();
  };

  const handleCenterView = () => {
    setZoom(0.15);
    setStagePos({ x: 100, y: 100 });
  };

  const roomTypes: { type: RoomType; label: string; color: string }[] = [
    { type: 'living', label: 'Гостиная', color: '#3b82f6' },
    { type: 'bedroom', label: 'Спальня', color: '#a855f7' },
    { type: 'kitchen', label: 'Кухня', color: '#ea580c' },
    { type: 'bathroom', label: 'Ванная', color: '#06b6d4' },
    { type: 'toilet', label: 'Санузел', color: '#14b8a6' },
    { type: 'corridor', label: 'Коридор', color: '#6b7280' },
    { type: 'balcony', label: 'Балкон', color: '#22c55e' },
  ];

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between text-slate-200 select-none z-40">
      {/* Логотип */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky-600 text-white font-bold shadow-lg shadow-sky-900/40">
          ⚡
        </div>
        <div>
          <h1 className="font-bold text-sm tracking-wide text-white leading-tight">ELECTRICA</h1>
          <p className="text-[10px] text-slate-400 font-mono">CAD 230V • Шаг 1: Контур</p>
        </div>
      </div>

      {/* Основные инструменты */}
      <div className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTool('select')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTool === 'select'
              ? 'bg-sky-500 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Выбор и перемещение (V)"
        >
          <MousePointer size={15} />
          <span>Выбор</span>
        </button>

        <button
          onClick={() => setActiveTool('pan')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTool === 'pan'
              ? 'bg-sky-500 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Панорама / Рука (H)"
        >
          <Hand size={15} />
          <span>Рука</span>
        </button>

        <div className="w-px h-5 bg-slate-800 mx-1" />

        <button
          onClick={() => setActiveTool('draw_room')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTool === 'draw_room'
              ? 'bg-emerald-500 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Нарисовать произвольный контур комнаты (P)"
        >
          <PenTool size={15} />
          <span>Контур стен</span>
        </button>

        <button
          onClick={() => setActiveTool('draw_shaft')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTool === 'draw_shaft'
              ? 'bg-rose-500 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Вырезать вентиляционную шахту или колонну"
        >
          <Scissors size={15} />
          <span>Вырезать шахту</span>
        </button>
      </div>

      {/* Выбор типа рисуемой комнаты */}
      {activeTool === 'draw_room' && (
        <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-800 animate-fadeIn">
          <span className="text-[11px] text-slate-400">Зона:</span>
          <select
            value={activeRoomType}
            onChange={(e) => setActiveRoomType(e.target.value as RoomType)}
            className="bg-slate-800 text-xs text-white rounded px-2 py-1 border border-slate-700 focus:outline-none focus:border-sky-500"
          >
            {roomTypes.map((rt) => (
              <option key={rt.type} value={rt.type}>
                {rt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* История и Масштаб */}
      <div className="flex items-center gap-2">
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
          <span className="px-2 font-mono text-[11px] text-slate-300">
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
          onClick={onOpenSettings}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg border border-slate-800 transition"
          title="Параметры проекта (запас кабеля, высоты)"
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
          title="Очистить всё"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </header>
  );
};

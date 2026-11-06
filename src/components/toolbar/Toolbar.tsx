import React from 'react';
import {
  MousePointer,
  Hand,
  PenTool,
  Scissors,
  Home,
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
    apartment,
    activeTool,
    activeRoomType,
    zoom,
    setActiveTool,
    setActiveRoomType,
    setZoom,
    setStagePos,
    resetProject,
    startApartmentDrawing,
    startRoomDrawing,
  } = useProjectStore();

  const handleUndo = () => {
    (useProjectStore.temporal.getState() as any).undo?.();
  };

  const handleRedo = () => {
    (useProjectStore.temporal.getState() as any).redo?.();
  };

  const handleCenterView = () => {
    setZoom(0.12);
    setStagePos({ x: 120, y: 120 });
  };

  const roomTypes: { type: RoomType; label: string }[] = [
    { type: 'living', label: 'Гостиная' },
    { type: 'bedroom', label: 'Спальня' },
    { type: 'kitchen', label: 'Кухня' },
    { type: 'bathroom', label: 'Ванная' },
    { type: 'toilet', label: 'Санузел' },
    { type: 'corridor', label: 'Коридор' },
    { type: 'balcony', label: 'Балкон' },
    { type: 'storage', label: 'Гардеробная' },
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
          <p className="text-[10px] text-slate-400 font-mono">
            {apartment ? 'Рабочая область: Квартира' : 'Создание контура квартиры'}
          </p>
        </div>
      </div>

      {/* Основные инструменты */}
      <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTool('select')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTool === 'select'
              ? 'bg-sky-500 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Выбор элементов (V)"
        >
          <MousePointer size={14} />
          <span>Выбор</span>
        </button>

        <button
          onClick={() => setActiveTool('pan')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTool === 'pan'
              ? 'bg-sky-500 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
          title="Панорама / Рука (H) или клик на колесико мыши"
        >
          <Hand size={14} />
          <span>Рука</span>
        </button>

        <div className="w-px h-5 bg-slate-800 mx-1" />

        {/* Инструмент: Контур квартиры */}
        <button
          onClick={startApartmentDrawing}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTool === 'draw_apartment'
              ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-950/40'
              : 'text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20'
          }`}
          title="Очертить внешний габарит помещения"
        >
          <Home size={14} />
          <span>Контур квартиры</span>
        </button>

        {/* Инструмент: Комната внутри квартиры */}
        <button
          onClick={() => {
            if (!apartment) {
              alert('Сначала начертите внешний контур квартиры!');
              return;
            }
            startRoomDrawing();
          }}
          disabled={!apartment && activeTool !== 'draw_room'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTool === 'draw_room'
              ? 'bg-sky-500 text-white shadow'
              : apartment
              ? 'text-slate-300 hover:text-white hover:bg-slate-800'
              : 'text-slate-600 cursor-not-allowed'
          }`}
          title={apartment ? 'Нарисовать комнату внутри квартиры' : 'Сначала задайте контур квартиры'}
        >
          <PenTool size={14} />
          <span>+ Комната</span>
        </button>

        {/* Инструмент: Вырезать шахту */}
        <button
          onClick={() => {
            if (!apartment) {
              alert('Сначала начертите контур квартиры!');
              return;
            }
            setActiveTool('draw_shaft');
          }}
          disabled={!apartment}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTool === 'draw_shaft'
              ? 'bg-rose-500 text-white shadow'
              : apartment
              ? 'text-slate-400 hover:text-white hover:bg-slate-800'
              : 'text-slate-600 cursor-not-allowed'
          }`}
          title="Вырезать вентшахту или несущую колонну"
        >
          <Scissors size={14} />
          <span>Вырезать шахту</span>
        </button>
      </div>

      {/* Выбор зоны при черчении комнаты */}
      {activeTool === 'draw_room' && (
        <div className="flex items-center gap-1.5 bg-slate-950/90 px-3 py-1 rounded-xl border border-slate-800 animate-fadeIn">
          <span className="text-[11px] text-slate-400">Тип комнаты:</span>
          <select
            value={activeRoomType}
            onChange={(e) => setActiveRoomType(e.target.value as RoomType)}
            className="bg-slate-800 text-xs text-white rounded px-2 py-1 border border-slate-700 focus:outline-none focus:border-sky-500 font-medium"
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

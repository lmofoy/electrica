import React, { useRef } from 'react';
import {
  MousePointer,
  Hand,
  PenTool,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  Settings,
  Plus,
  Minus,
  Check,
  Lock,
  Eye,
  EyeOff,
  DoorOpen,
  Square,
  Split,
  Save,
  Upload,
  Plug,
  Plug2,
  Droplets,
  ToggleLeft,
  SlidersHorizontal,
  Lightbulb,
  Repeat2,
  Layers,
  CircuitBoard,
} from 'lucide-react';
import {
  getProjectSnapshot,
  isProjectSnapshot,
  useProjectStore,
} from '../../store/useProjectStore';
import { DEVICE_CATALOG, DEVICE_TYPES } from '../../core/electrical/devices';
import type { DeviceType, RoomType } from '../../types';

interface ToolbarProps {
  onOpenSettings: () => void;
}

const DEVICE_ICONS: Record<DeviceType, React.ReactNode> = {
  socket_single: <Plug size={13} />,
  socket_double: <Plug2 size={13} />,
  socket_wet: <Droplets size={13} />,
  switch_1k: <ToggleLeft size={13} />,
  switch_2k: <SlidersHorizontal size={13} />,
  light_ceiling: <Lightbulb size={13} />,
};

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenSettings }) => {
  const {
    apartment,
    panel,
    activeView,
    setActiveView,
    activeTool,
    activeRoomType,
    activeOpeningType,
    activeDeviceType,
    deviceShared,
    designMode,
    zoom,
    setActiveTool,
    setActiveRoomType,
    setActiveOpeningType,
    setActiveDeviceType,
    setDeviceShared,
    setDesignMode,
    setZoom,
    setStagePos,
    resetProject,
    startApartmentDrawing,
    startRoomDrawing,
    drawingStage,
    boundaryMode,
    boundaryLocked,
    activeBoundaryTool,
    setBoundaryTool,
    setDrawingStage,
    lockBoundary,
    addToast,
    settings,
    toggleDimensions,
  } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUndo = () => {
    (useProjectStore.temporal.getState() as any).undo?.();
  };

  const handleRedo = () => {
    (useProjectStore.temporal.getState() as any).redo?.();
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
          <p className="text-[10px] text-slate-400 font-mono uppercase tracking-tighter">
            {activeView === 'panel'
              ? 'Щиток • схема и модули'
              : designMode === 'electrical'
                ? activeTool === 'place_device'
                  ? `Электрика • ${DEVICE_CATALOG[activeDeviceType].label}`
                  : activeTool === 'place_panel'
                    ? 'Электрика • размещение щитка'
                    : 'Электрика • выберите прибор'
                : boundaryMode === 'auto'
                  ? 'Комнаты • стены автоматически'
                  : drawingStage === 'boundary'
                    ? boundaryLocked
                      ? 'Контур заблокирован'
                      : 'Этап 1: Контур квартиры'
                    : 'Этап 2: Разметка комнат'}
          </p>
        </div>

        {activeView === 'plan' && (
          <div className="ml-2 flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setDesignMode('architecture')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                designMode === 'architecture'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Построение комнат, стен и проёмов"
            >
              <Layers size={12} />
              Архитектура
            </button>
            <button
              onClick={() => setDesignMode('electrical')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                designMode === 'electrical'
                  ? 'bg-sky-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Расстановка розеток, выключателей и света"
            >
              <Plug size={12} />
              Электрика
            </button>
          </div>
        )}

        <div className="ml-2 flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveView('plan')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
              activeView === 'plan'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Вернуться к плану"
          >
            План
          </button>
          <button
            onClick={() => setActiveView('panel')}
            disabled={!panel}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
              activeView === 'panel'
                ? 'bg-sky-500 text-white'
                : panel
                  ? 'text-sky-300 hover:text-white'
                  : 'text-slate-600 cursor-not-allowed'
            }`}
            title={panel ? 'Открыть схему щитка' : 'Сначала разместите щиток на плане'}
          >
            <CircuitBoard size={12} />
            Щиток
          </button>
        </div>
      </div>

      {/* Основные инструменты */}
      <div
        className={`items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800 ${
          activeView === 'panel' ? 'hidden' : 'flex'
        }`}
      >
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
          title="Панорама / Рука (H)"
        >
          <Hand size={14} />
          <span>Рука</span>
        </button>

        <div className="w-px h-5 bg-slate-800 mx-1" />

        {designMode === 'architecture' && (
          <>
        {/* АВТО-РЕЖИМ: комнаты как источник истины */}
        {boundaryMode === 'auto' && (
          <>
            <button
              onClick={() => startRoomDrawing()}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_room'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-950/40'
                  : 'text-sky-400 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20'
              }`}
              title="Нарисовать комнату по чистовому контуру"
            >
              <PenTool size={14} />
              <span>+ Комната</span>
            </button>

            <button
              onClick={() => setActiveTool('draw_shaft')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_shaft'
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-950/40'
                  : 'text-rose-400 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20'
              }`}
              title="Вырезать шахту из одной или нескольких комнат"
            >
              <Minus size={14} />
              <span>Шахта</span>
            </button>

            <button
              onClick={() => setActiveTool('draw_opening')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_opening'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-950/40'
                  : 'text-sky-400 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20'
              }`}
              title="Добавить дверь или окно"
            >
              <DoorOpen size={14} />
              <span>Дверь/Окно</span>
            </button>

            <button
              onClick={() => setActiveTool('draw_partition')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_partition'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-950/40'
                  : 'text-sky-400 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20'
              }`}
              title="Внутренняя перегородка, не делящая комнату"
            >
              <Split size={14} />
              <span>Перегородка</span>
            </button>
          </>
        )}

        {/* ЭТАП 1: КОНТУР КВАРТИРЫ */}
        {boundaryMode === 'manual' && drawingStage === 'boundary' && (
          <>
            <button
              onClick={() => {
                setBoundaryTool('add');
                startApartmentDrawing();
              }}
              disabled={boundaryLocked}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_apartment' && activeBoundaryTool === 'add'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-950/40'
                  : boundaryLocked 
                  ? 'text-slate-600 cursor-not-allowed opacity-50'
                  : 'text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20'
              }`}
              title="Добавить область к контуру квартиры"
            >
              <Plus size={14} />
              <span>Добавить контур</span>
            </button>

            <button
              onClick={() => {
                setBoundaryTool('subtract');
                startApartmentDrawing();
              }}
              disabled={boundaryLocked || !apartment}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_apartment' && activeBoundaryTool === 'subtract'
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-950/40'
                  : boundaryLocked || !apartment
                  ? 'text-slate-600 cursor-not-allowed opacity-50'
                  : 'text-rose-400 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20'
              }`}
              title="Вычесть область из контура (Шахта/Колонна)"
            >
              <Minus size={14} />
              <span>Шахта / Вычитание</span>
            </button>

            <div className="w-px h-5 bg-slate-800 mx-1" />

            <button
              onClick={() => {
                if (!apartment) {
                  addToast('Сначала нарисуйте хотя бы один контур!', 'error');
                  return;
                }
                lockBoundary();
                addToast('Контур квартиры зафиксирован. Теперь разметьте комнаты.', 'success');
              }}
              disabled={boundaryLocked}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition bg-emerald-600 text-white shadow-lg shadow-emerald-900/40 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Check size={14} />
              <span>Закончить контур</span>
            </button>
          </>
        )}

        {/* ЭТАП 2: РАЗМЕТКА КОМНАТ */}
        {boundaryMode === 'manual' && drawingStage === 'rooms' && (
          <>
            <button
              onClick={() => startRoomDrawing()}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_room'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-950/40'
                  : 'text-sky-400 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20'
              }`}
              title="Нарисовать комнату внутри квартиры"
            >
              <PenTool size={14} />
              <span>+ Комната</span>
            </button>

            <button
              onClick={() => setActiveTool('draw_opening')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_opening'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-950/40'
                  : 'text-sky-400 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20'
              }`}
              title="Добавить дверь или окно"
            >
              <DoorOpen size={14} />
              <span>Дверь/Окно</span>
            </button>

            <button
              onClick={() => setActiveTool('draw_partition')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_partition'
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-950/40'
                  : 'text-sky-400 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20'
              }`}
              title="Нарисовать внутреннюю перегородку"
            >
              <Split size={14} />
              <span>Перегородка</span>
            </button>

            <button
              onClick={() => {
                if (confirm('Вернуться к редактированию контура? Это может сбросить привязки комнат.')) {
                  setDrawingStage('boundary');
                  setActiveTool('select');
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Редактировать контур квартиры"
            >
              <Lock size={14} className="opacity-50" />
              <span>Редактировать контур</span>
            </button>
          </>
        )}
          </>
        )}

        {designMode === 'electrical' && (
          <>
            <div className="flex items-center gap-1">
              {DEVICE_TYPES.map((type) => {
                const catalog = DEVICE_CATALOG[type];
                const isActive = activeTool === 'place_device' && activeDeviceType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setActiveDeviceType(type)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                      isActive
                        ? 'bg-sky-500 text-white shadow-lg shadow-sky-950/40'
                        : 'text-sky-300 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20'
                    }`}
                    title={`${catalog.label} · H ${catalog.defaultHeightMm} мм`}
                  >
                    {DEVICE_ICONS[type]}
                    <span>{catalog.shortLabel}</span>
                  </button>
                );
              })}
            </div>

            <div className="w-px h-5 bg-slate-800 mx-1" />

            <button
              onClick={() => setDeviceShared(!deviceShared)}
              disabled={DEVICE_CATALOG[activeDeviceType].mounting === 'ceiling'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                deviceShared
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                  : 'text-slate-400 border-slate-700 hover:text-white hover:bg-slate-800'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title="Сквозной прибор: один и тот же прибор принадлежит двум смежным комнатам"
            >
              <Repeat2 size={13} />
              Сквозная
            </button>

            <div className="w-px h-5 bg-slate-800 mx-1" />

            <button
              onClick={() => {
                if (panel) {
                  setActiveView('panel');
                  return;
                }
                setDesignMode('electrical');
                setActiveTool('place_panel');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                activeTool === 'place_panel'
                  ? 'bg-sky-500 text-white border-sky-400 shadow-lg shadow-sky-950/40'
                  : 'text-sky-300 bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/20'
              }`}
              title={
                panel
                  ? 'Открыть схему щитка'
                  : 'Разместить электрощиток на стене'
              }
            >
              <CircuitBoard size={13} />
              Щиток
            </button>
          </>
        )}
      </div>

      {activeView === 'panel' && (
        <div className="text-[11px] text-slate-500 font-mono">
          Схема открыта · «План» вернёт к чертежу
        </div>
      )}

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

      {/* Выбор типа проема */}
      {activeTool === 'draw_opening' && (
        <div className="flex items-center gap-1.5 bg-slate-950/90 px-3 py-1 rounded-xl border border-slate-800 animate-fadeIn">
          <span className="text-[11px] text-slate-400">Тип проёма:</span>
          <button
            onClick={() => setActiveOpeningType('door')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition ${
              activeOpeningType === 'door'
                ? 'bg-sky-500 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <DoorOpen size={13} />
            Дверь
          </button>
          <button
            onClick={() => setActiveOpeningType('window')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition ${
              activeOpeningType === 'window'
                ? 'bg-sky-500 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Square size={13} />
            Окно
          </button>
        </div>
      )}

      {/* История и Масштаб */}
      <div className="flex items-center gap-2">
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
          onClick={toggleDimensions}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            settings.showDimensions
              ? 'text-sky-400 bg-sky-500/10 border border-sky-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
          }`}
          title={settings.showDimensions ? 'Скрыть размеры' : 'Показать размеры'}
        >
          {settings.showDimensions ? <Eye size={14} /> : <EyeOff size={14} />}
          <span>Размеры</span>
        </button>

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

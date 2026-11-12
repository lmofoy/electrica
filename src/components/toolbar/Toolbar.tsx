import React, { useRef, useState } from 'react';
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
  Repeat2,
  Layers,
  CircuitBoard,
  ChevronDown,
  X,
} from 'lucide-react';
import {
  getProjectSnapshot,
  isProjectSnapshot,
  useProjectStore,
} from '../../store/useProjectStore';
import {
  DEVICE_CATALOG,
  DEVICE_CATALOG_TREE,
  deviceCatalogPath,
  type DeviceCatalogSectionId,
} from '../../core/electrical/devices';
import {
  loadDeviceUiPreferences,
  rememberRecentDevice,
  saveDeviceUiPreferences,
  toggleFavoriteDevice,
  type DeviceUiPreferences,
} from '../../core/electrical/devicePreferences';
import {
  DeviceCatalogMenu,
  DeviceSectionIcon,
  DeviceTypeIcon,
} from './DeviceCatalogMenu';
import type { DeviceType, RoomType } from '../../types';

interface ToolbarProps {
  onOpenSettings: () => void;
}

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
    setDrawingStage,
    lockBoundary,
    addToast,
    settings,
    toggleDimensions,
  } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sectionAnchors = useRef<
    Partial<Record<DeviceCatalogSectionId, HTMLDivElement | null>>
  >({});
  const [devicePreferences, setDevicePreferences] = useState<DeviceUiPreferences>(
    () => loadDeviceUiPreferences()
  );
  const [catalogMenu, setCatalogMenu] = useState<{
    section: DeviceCatalogSectionId;
    anchorEl: HTMLElement;
  } | null>(null);

  const updateDevicePreferences = (
    update: (current: DeviceUiPreferences) => DeviceUiPreferences
  ) => {
    setDevicePreferences((current) => {
      const next = update(current);
      saveDeviceUiPreferences(next);
      return next;
    });
  };

  const selectDeviceType = (type: DeviceType) => {
    setActiveDeviceType(type);
    updateDevicePreferences((current) => rememberRecentDevice(type, current));
    setCatalogMenu(null);
  };

  const toggleFavorite = (type: DeviceType) => {
    updateDevicePreferences((current) => toggleFavoriteDevice(type, current));
  };

  const openCatalogMenu = (section: DeviceCatalogSectionId) => {
    const anchorEl = sectionAnchors.current[section];
    if (!anchorEl) return;
    setCatalogMenu({ section, anchorEl });
  };

  const toggleCatalogMenu = (section: DeviceCatalogSectionId) => {
    setCatalogMenu((current) => {
      if (current?.section === section) return null;
      const anchorEl = sectionAnchors.current[section];
      return anchorEl ? { section, anchorEl } : null;
    });
  };

  const handleDeviceSectionClick = (section: DeviceCatalogSectionId) => {
    const view = DEVICE_CATALOG_TREE.find(
      (candidate) => candidate.section.id === section
    );
    const leaves = view?.subsections.flatMap((subsection) => subsection.leaves) ?? [];
    if (leaves.length === 0) {
      openCatalogMenu(section);
      return;
    }
    const recent = devicePreferences.recentDeviceTypes.find((type) =>
      leaves.some((leaf) => leaf.type === type)
    );
    selectDeviceType(recent ?? leaves[0].type);
  };

  const activeSectionId =
    designMode === 'electrical' && activeTool === 'place_device'
      ? DEVICE_CATALOG[activeDeviceType].section
      : null;
  const activeDevicePath =
    designMode === 'electrical' && activeTool === 'place_device'
      ? deviceCatalogPath(activeDeviceType)
      : null;

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
    <>
    <header className="shrink-0 max-h-[40vh] overflow-y-auto bg-slate-900 border-b border-slate-800 px-3 py-2 flex flex-wrap items-center gap-2 justify-between text-slate-200 select-none z-40">
      {/* Логотип */}
      <div className="flex flex-wrap items-center gap-3">
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
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
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
              onClick={() => startApartmentDrawing()}
              disabled={boundaryLocked}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTool === 'draw_apartment'
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
            <div className="flex flex-wrap items-center gap-1">
              {DEVICE_CATALOG_TREE.map(({ section, count }) => {
                const isActive = activeSectionId === section.id;
                return (
                  <div
                    key={section.id}
                    ref={(element) => {
                      sectionAnchors.current[section.id] = element;
                    }}
                    className={`flex items-stretch rounded-lg border transition ${
                      isActive
                        ? 'border-sky-400 bg-sky-500 text-white shadow-lg shadow-sky-950/40'
                        : count === 0
                          ? 'border-slate-700 bg-slate-900/60 text-slate-500'
                          : 'border-sky-500/20 bg-sky-500/10 text-sky-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleDeviceSectionClick(section.id)}
                      className="flex items-center gap-1 rounded-l-lg px-2.5 py-1.5 text-[11px] font-semibold transition hover:bg-white/5"
                      title={
                        count === 0
                          ? `${section.hint}. Раздел пока пуст — откройте каталог.`
                          : `${section.hint}. Клик — последний элемент, стрелка — выбрать.`
                      }
                    >
                      <DeviceSectionIcon section={section.id} size={13} />
                      <span>{section.label}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCatalogMenu(section.id)}
                      className={`rounded-r-lg border-l px-1 py-1.5 transition ${
                        isActive
                          ? 'border-white/20 hover:bg-white/10'
                          : count === 0
                            ? 'border-slate-700 hover:bg-white/5'
                            : 'border-sky-500/20 hover:bg-white/5'
                      }`}
                      title="Открыть каталог раздела"
                      aria-label={`Открыть каталог: ${section.label}`}
                    >
                      <ChevronDown size={11} />
                    </button>
                  </div>
                );
              })}
            </div>

            {activeDevicePath && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-950/50 px-2 py-1 text-[10px] text-sky-100">
                <DeviceTypeIcon
                  type={activeDeviceType}
                  size={13}
                  className="text-sky-300"
                />
                <button
                  type="button"
                  onClick={() => toggleCatalogMenu(activeDevicePath.section.id)}
                  className="flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-sky-500/10"
                  title="Изменить активный элемент"
                >
                  <span className="text-sky-400">
                    {activeDevicePath.section.label}
                  </span>
                  <span className="text-sky-700">→</span>
                  <span className="text-sky-300">{activeDevicePath.subsection}</span>
                  <span className="text-sky-700">→</span>
                  <span className="font-semibold text-white">
                    {activeDevicePath.leaf.entry.shortLabel}
                  </span>
                  {activeDevicePath.leaf.entry.badge &&
                    activeDevicePath.leaf.entry.badge !==
                      activeDevicePath.leaf.entry.ipRating && (
                      <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1 py-0.5 text-[9px] font-semibold text-sky-200">
                        {activeDevicePath.leaf.entry.badge}
                      </span>
                    )}
                </button>
                <span className="font-mono text-[9px] text-sky-300/70">
                  {activeDevicePath.leaf.entry.mounting === 'ceiling'
                    ? 'Потолок'
                    : `H ${activeDevicePath.leaf.entry.defaultHeightMm}`}
                </span>
                {activeDevicePath.leaf.entry.defaultPowerWatts > 0 && (
                  <span className="font-mono text-[9px] text-sky-300/70">
                    {activeDevicePath.leaf.entry.defaultPowerWatts} Вт
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setDeviceShared(!deviceShared)}
                  disabled={activeDevicePath.leaf.entry.mounting === 'ceiling'}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
                    deviceShared
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-sky-300/70 hover:bg-sky-500/10 hover:text-sky-200'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                  title="Сквозной прибор: один и тот же прибор принадлежит двум смежным комнатам"
                >
                  <Repeat2 size={11} />
                  Сквозная
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTool('select')}
                  className="rounded p-0.5 text-sky-400/70 transition hover:bg-sky-500/10 hover:text-white"
                  title="Выйти из режима размещения (Esc)"
                  aria-label="Выйти из режима размещения"
                >
                  <X size={12} />
                </button>
              </div>
            )}

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
          Щиток открыт справа · «План» закроет схему
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
      <div className="flex flex-wrap items-center gap-2">
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

    {catalogMenu && (
      <DeviceCatalogMenu
        key={catalogMenu.section}
        anchorEl={catalogMenu.anchorEl}
        initialSection={catalogMenu.section}
        activeDeviceType={activeDeviceType}
        preferences={devicePreferences}
        onSelect={selectDeviceType}
        onToggleFavorite={toggleFavorite}
        onClose={() => setCatalogMenu(null)}
      />
    )}
    </>
  );
};

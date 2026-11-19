import React, { useRef, useState } from 'react';
import {
  MousePointer,
  Hand,
  PenTool,
  DoorOpen,
  Square,
  Split,
  Check,
  Lock,
  Plus,
  Repeat2,
  X,
  CircuitBoard,
  Cable,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
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

const ROOM_TYPES: { type: RoomType; label: string }[] = [
  { type: 'living', label: 'Гостиная' },
  { type: 'bedroom', label: 'Спальня' },
  { type: 'kitchen', label: 'Кухня' },
  { type: 'bathroom', label: 'Ванная' },
  { type: 'toilet', label: 'Санузел' },
  { type: 'corridor', label: 'Коридор' },
  { type: 'balcony', label: 'Балкон' },
  { type: 'storage', label: 'Гардеробная' },
];

const toolClass = (active: boolean, accent = false) =>
  `flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg border text-[11px] font-medium text-left transition ${
    active
      ? 'bg-sky-500 text-white border-sky-400 shadow'
      : accent
        ? 'text-sky-300 bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/20'
        : 'text-slate-400 border-transparent hover:text-white hover:bg-slate-800'
  }`;

export const StepRail: React.FC = () => {
  const {
    activeStep,
    linesTab,
    activeTool,
    activeRoomType,
    activeOpeningType,
    activeDeviceType,
    deviceShared,
    panel,
    boundaryMode,
    drawingStage,
    boundaryLocked,
    setActiveTool,
    setActiveRoomType,
    setActiveOpeningType,
    setActiveDeviceType,
    setDeviceShared,
    setLinesTab,
    startApartmentDrawing,
    startRoomDrawing,
    setDrawingStage,
    lockBoundary,
    addToast,
  } = useProjectStore();

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
      const anchorEl = sectionAnchors.current[section];
      if (anchorEl) setCatalogMenu({ section, anchorEl });
      return;
    }
    const recent = devicePreferences.recentDeviceTypes.find((type) =>
      leaves.some((leaf) => leaf.type === type)
    );
    selectDeviceType(recent ?? leaves[0].type);
  };

  const activeSectionId =
    activeStep === 'devices' && activeTool === 'place_device'
      ? DEVICE_CATALOG[activeDeviceType].section
      : null;
  const activeDevicePath =
    activeStep === 'devices' && activeTool === 'place_device'
      ? deviceCatalogPath(activeDeviceType)
      : null;

  const showPlanTools = activeStep === 'plan';
  const showCommonTools =
    activeStep === 'plan' || activeStep === 'devices' || activeStep === 'lines';

  return (
    <>
      <aside className="w-[136px] md:w-[152px] shrink-0 bg-slate-950/70 border-r border-slate-800 p-2 flex flex-col gap-2 overflow-y-auto text-slate-200 select-none z-30">
        {showCommonTools && (
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => setActiveTool('select')}
              className={toolClass(activeTool === 'select')}
              title="Выбор элементов (V)"
            >
              <MousePointer size={14} />
              Выбор
            </button>
            <button
              onClick={() => setActiveTool('pan')}
              className={toolClass(activeTool === 'pan')}
              title="Панорама / Рука (H)"
            >
              <Hand size={14} />
              Рука
            </button>
          </div>
        )}

        {showPlanTools && (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1">
              Планировка
            </div>
            <div className="flex flex-col gap-0.5">
              {boundaryMode === 'manual' && drawingStage === 'boundary' ? (
                <>
                  <button
                    onClick={() => startApartmentDrawing()}
                    disabled={boundaryLocked}
                    className={toolClass(activeTool === 'draw_apartment', true)}
                    title="Добавить область к контуру квартиры"
                  >
                    <Plus size={14} />
                    Добавить контур
                  </button>
                  <button
                    onClick={() => {
                      if (!useProjectStore.getState().apartment) {
                        addToast('Сначала нарисуйте хотя бы один контур!', 'error');
                        return;
                      }
                      lockBoundary();
                      addToast(
                        'Контур квартиры зафиксирован. Теперь разметьте комнаты.',
                        'success'
                      );
                    }}
                    disabled={boundaryLocked}
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    <Check size={14} />
                    Закончить контур
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => startRoomDrawing()}
                    className={toolClass(activeTool === 'draw_room', true)}
                    title="Нарисовать комнату"
                  >
                    <PenTool size={14} />
                    Комната
                  </button>
                  <button
                    onClick={() => {
                      setActiveOpeningType('door');
                      setActiveTool('draw_opening');
                    }}
                    className={toolClass(
                      activeTool === 'draw_opening' && activeOpeningType === 'door',
                      true
                    )}
                    title="Добавить дверь"
                  >
                    <DoorOpen size={14} />
                    Дверь
                  </button>
                  <button
                    onClick={() => {
                      setActiveOpeningType('window');
                      setActiveTool('draw_opening');
                    }}
                    className={toolClass(
                      activeTool === 'draw_opening' && activeOpeningType === 'window',
                      true
                    )}
                    title="Добавить окно"
                  >
                    <Square size={14} />
                    Окно
                  </button>
                  <button
                    onClick={() => setActiveTool('draw_partition')}
                    className={toolClass(activeTool === 'draw_partition', true)}
                    title="Внутренняя перегородка"
                  >
                    <Split size={14} />
                    Перегородка
                  </button>
                  {boundaryMode === 'manual' && (
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            'Вернуться к редактированию контура? Это может сбросить привязки комнат.'
                          )
                        ) {
                          setDrawingStage('boundary');
                          setActiveTool('select');
                        }
                      }}
                      className={toolClass(false)}
                      title="Редактировать контур квартиры"
                    >
                      <Lock size={14} className="opacity-60" />
                      Контур
                    </button>
                  )}
                </>
              )}
            </div>

            {activeTool === 'draw_room' && (
              <label className="flex flex-col gap-1 px-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-500">
                  Тип комнаты
                </span>
                <select
                  value={activeRoomType}
                  onChange={(e) => setActiveRoomType(e.target.value as RoomType)}
                  className="w-full bg-slate-900 text-[11px] text-white rounded-lg px-1.5 py-1 border border-slate-700 focus:outline-none focus:border-sky-500"
                >
                  {ROOM_TYPES.map((room) => (
                    <option key={room.type} value={room.type}>
                      {room.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

          </>
        )}

        {activeStep === 'devices' && (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1">
              Каталог
            </div>
            <div className="flex flex-col gap-0.5">
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
                        ? 'border-sky-400 bg-sky-500 text-white'
                        : count === 0
                          ? 'border-transparent text-slate-500'
                          : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleDeviceSectionClick(section.id)}
                      className="flex flex-1 min-w-0 items-center gap-1.5 rounded-l-lg px-2 py-1.5 text-[11px] font-medium text-left"
                      title={
                        count === 0
                          ? `${section.hint}. Раздел пока пуст — откройте каталог.`
                          : `${section.hint}. Клик — последний элемент, стрелка — выбрать.`
                      }
                    >
                      <DeviceSectionIcon section={section.id} size={13} />
                      <span className="truncate">{section.label}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCatalogMenu(section.id)}
                      className={`rounded-r-lg border-l px-1 transition ${
                        isActive
                          ? 'border-white/20 hover:bg-white/10'
                          : 'border-slate-800 hover:bg-slate-700'
                      }`}
                      title="Открыть каталог раздела"
                      aria-label={`Открыть каталог: ${section.label}`}
                    >
                      <span className="text-[9px]">▾</span>
                    </button>
                  </div>
                );
              })}
            </div>

            {activeDevicePath && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-950/50 p-1.5 text-[10px] text-sky-100">
                <div className="flex items-center gap-1">
                  <DeviceTypeIcon
                    type={activeDeviceType}
                    size={12}
                    className="text-sky-300 shrink-0"
                  />
                  <span className="font-semibold truncate">
                    {activeDevicePath.leaf.entry.shortLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTool('select')}
                    className="ml-auto rounded p-0.5 text-sky-400/70 hover:bg-sky-500/10 hover:text-white"
                    title="Выйти из режима размещения (Esc)"
                    aria-label="Выйти из режима размещения"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="mt-1 font-mono text-[9px] text-sky-300/70">
                  {activeDevicePath.leaf.entry.mounting === 'ceiling'
                    ? 'Потолок'
                    : `H ${activeDevicePath.leaf.entry.defaultHeightMm}`}
                  {activeDevicePath.leaf.entry.defaultPowerWatts > 0
                    ? ` · ${activeDevicePath.leaf.entry.defaultPowerWatts} Вт`
                    : ''}
                </div>
                <button
                  type="button"
                  onClick={() => setDeviceShared(!deviceShared)}
                  disabled={activeDevicePath.leaf.entry.mounting === 'ceiling'}
                  className={`mt-1 flex w-full items-center justify-center gap-1 rounded px-1 py-1 text-[10px] font-semibold transition ${
                    deviceShared
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-sky-300/70 hover:bg-sky-500/10 hover:text-sky-200'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                  title="Сквозной прибор принадлежит двум смежным комнатам"
                >
                  <Repeat2 size={11} />
                  Сквозная
                </button>
              </div>
            )}

            <div className="border-t border-slate-800 pt-2">
              <button
                onClick={() => setActiveTool('place_panel')}
                className={toolClass(activeTool === 'place_panel', !panel)}
                title={
                  panel
                    ? 'Переместить щиток на другую стену'
                    : 'Разместить электрощиток на стене'
                }
              >
                <CircuitBoard size={14} />
                Щиток
              </button>
              <p className="px-1 pt-1 text-[9px] leading-snug text-slate-500">
                {panel
                  ? 'На плане · состав щитка — на шаге «Линии»'
                  : 'Поставьте щиток на стену'}
              </p>
            </div>
          </>
        )}

        {activeStep === 'lines' && (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1">
              Щиток и линии
            </div>
            <button
              onClick={() => setLinesTab('lines')}
              className={toolClass(linesTab === 'lines')}
            >
              <Cable size={14} />
              Линии
            </button>
            <button
              onClick={() => setLinesTab('panel')}
              className={toolClass(linesTab === 'panel')}
            >
              <CircuitBoard size={14} />
              Щиток
            </button>
            <p className="px-1 text-[9px] leading-snug text-slate-500">
              Состав линий и щитка — сбоку. Трассы открываются из строки линии.
            </p>
          </>
        )}

        {activeStep === 'check' && (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1">
              Проверка
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-200 text-[11px] font-semibold">
              <ShieldCheck size={14} />
              Замечания
            </div>
            <p className="px-1 text-[9px] leading-snug text-slate-500">
              Нормы, линии, трассы и щиток — одним списком. Нажмите «Показать», чтобы найти объект
              на плане.
            </p>
          </>
        )}

        {activeStep === 'docs' && (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1">
              Документы
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-200 text-[11px] font-semibold">
              <ClipboardList size={14} />
              Листы A3
            </div>
            <p className="px-1 text-[9px] leading-snug text-slate-500">
              Схема, расчёт, спецификация и компоновка открываются поверх плана.
            </p>
          </>
        )}
      </aside>

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

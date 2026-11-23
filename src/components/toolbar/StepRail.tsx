import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  ClipboardList,
  ListChecks,
  ShieldCheck,
  SquareDashed,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import {
  DEVICE_CATALOG,
  DEVICE_CATALOG_TREE,
  deviceCatalogPath,
  isMechanismType,
  type DeviceCatalogLeaf,
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
import type { DeviceType, PanelStep, RoomType } from '../../types';

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

function sectionLeaves(section: DeviceCatalogSectionId): DeviceCatalogLeaf[] {
  return (
    DEVICE_CATALOG_TREE.find((view) => view.section.id === section)?.subsections.flatMap(
      (subsection) => subsection.leaves
    ) ?? []
  );
}

function computePopoverPlacement(anchorEl: HTMLElement, width: number, height: number) {
  const rect = anchorEl.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.right + 6),
    Math.max(8, window.innerWidth - width - 8)
  );
  const top = Math.max(8, Math.min(rect.top, window.innerHeight - height - 8));
  return { left, top };
}

interface OpeningPickerMenuProps {
  anchorEl: HTMLElement;
  onPick: (kind: 'door' | 'window' | 'partition') => void;
  onClose: () => void;
}

const OpeningPickerMenu: React.FC<OpeningPickerMenuProps> = ({
  anchorEl,
  onPick,
  onClose,
}) => {
  const [placement, setPlacement] = useState(() =>
    computePopoverPlacement(anchorEl, 176, 158)
  );

  const updatePlacement = useCallback(() => {
    setPlacement(computePopoverPlacement(anchorEl, 176, 158));
  }, [anchorEl]);

  useEffect(() => {
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [updatePlacement, onClose]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[75]" onClick={onClose} />
      <div
        className="fixed z-[80] w-44 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-1 text-slate-200 shadow-2xl shadow-black/70"
        style={{ left: placement.left, top: placement.top }}
        role="menu"
        aria-label="Проёмы и перегородки"
      >
        <button
          type="button"
          onClick={() => onPick('door')}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <DoorOpen size={13} className="text-sky-400" />
          Дверь
        </button>
        <button
          type="button"
          onClick={() => onPick('window')}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <Square size={13} className="text-sky-400" />
          Окно
        </button>
        <div className="my-1 border-t border-slate-800" />
        <button
          type="button"
          onClick={() => onPick('partition')}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <Split size={13} className="text-emerald-400" />
          Перегородка
        </button>
      </div>
    </>,
    document.body
  );
};

export const StepRail: React.FC = () => {
  const {
    activeStep,
    panelStep,
    activeTool,
    activeRoomType,
    activeOpeningType,
    activeDeviceType,
    activeFramePosts,
    activeFrameMounting,
    activeFrameSeatTypes,
    activeFrameHeightMm,
    deviceShared,
    panel,
    boundaryMode,
    drawingStage,
    boundaryLocked,
    setActiveTool,
    setActiveRoomType,
    setActiveOpeningType,
    setActiveDeviceType,
    setActiveFramePosts,
    setActiveFrameMounting,
    setActiveFrameSeatType,
    setActiveFrameHeight,
    startFramePlacement,
    setDeviceShared,
    setPanelStep,
    setActiveStep,
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
    mode: 'catalog' | 'frame';
  } | null>(null);
  const frameAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [openingsMenu, setOpeningsMenu] = useState<{
    anchorEl: HTMLElement;
  } | null>(null);
  const openingsAnchorRef = useRef<HTMLDivElement | null>(null);

  const openPanelStep = (step: PanelStep) => {
    setActiveStep('lines');
    setPanelStep(step);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .getElementById(`panel-step-${step}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      )
    );
  };

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

  const isMechanismSection = (section: DeviceCatalogSectionId) => {
    const leaves = sectionLeaves(section);
    return leaves.length > 0 && leaves.every((leaf) => isMechanismType(leaf.type));
  };

  const frameSeatSummary = activeFrameSeatTypes
    .slice(0, activeFramePosts)
    .map((type) =>
      type ? DEVICE_CATALOG[type].shortLabel : 'заглушка'
    )
    .join(' · ');

  const openFrameMenu = (anchorEl: HTMLElement, section?: DeviceCatalogSectionId) => {
    const seatType = activeFrameSeatTypes.find((type) => type !== null) ?? null;
    setCatalogMenu({
      section:
        section ?? (seatType ? DEVICE_CATALOG[seatType].section : 'sockets'),
      anchorEl,
      mode: 'frame',
    });
  };

  const toggleCatalogMenu = (section: DeviceCatalogSectionId) => {
    setCatalogMenu((current) => {
      if (current?.section === section) return null;
      const anchorEl = sectionAnchors.current[section];
      if (!anchorEl) return null;
      return {
        section,
        anchorEl,
        mode: isMechanismSection(section) ? 'frame' : 'catalog',
      };
    });
  };

  const handleDeviceSectionClick = (section: DeviceCatalogSectionId) => {
    // Механизмы (розетки/выключатели) ставятся только внутрь рамки,
    // поэтому такие разделы открывают меню рамки.
    if (isMechanismSection(section)) {
      const anchorEl = sectionAnchors.current[section];
      if (anchorEl) openFrameMenu(anchorEl, section);
      return;
    }
    const view = DEVICE_CATALOG_TREE.find(
      (candidate) => candidate.section.id === section
    );
    const leaves = view?.subsections.flatMap((subsection) => subsection.leaves) ?? [];
    if (leaves.length === 0) {
      const anchorEl = sectionAnchors.current[section];
      if (anchorEl) setCatalogMenu({ section, anchorEl, mode: 'catalog' });
      return;
    }
    const recent = devicePreferences.recentDeviceTypes.find((type) =>
      leaves.some((leaf) => leaf.type === type)
    );
    selectDeviceType(recent ?? leaves[0].type);
  };

  const activeSectionId =
    activeTool === 'place_device' ? DEVICE_CATALOG[activeDeviceType].section : null;
  const activeDevicePath =
    activeTool === 'place_device' ? deviceCatalogPath(activeDeviceType) : null;
  const frameToolActive = activeTool === 'place_frame';
  // Механизм стоит только в рамке: прямую постановку из панели не показываем.
  const showActiveDeviceCard =
    activeDevicePath !== null && !frameToolActive && !isMechanismType(activeDeviceType);

  const showCommonTools = activeStep === 'plan' || activeStep === 'lines';

  const pickOpening = (kind: 'door' | 'window' | 'partition') => {
    if (kind === 'partition') {
      setActiveTool('draw_partition');
    } else {
      setActiveOpeningType(kind);
      setActiveTool('draw_opening');
    }
    setOpeningsMenu(null);
  };

  const toggleOpeningsMenu = () => {
    const anchorEl = openingsAnchorRef.current;
    if (!anchorEl) return;
    setOpeningsMenu((current) => (current ? null : { anchorEl }));
  };

  const openingToolActive =
    activeTool === 'draw_opening' || activeTool === 'draw_partition';
  const openingLabel =
    activeTool === 'draw_partition'
      ? 'Перегородка'
      : activeTool === 'draw_opening'
        ? activeOpeningType === 'window'
          ? 'Окно'
          : 'Дверь'
        : 'Проёмы';
  const OpeningIcon =
    activeTool === 'draw_partition' ? Split : activeTool === 'draw_opening' && activeOpeningType === 'window' ? Square : DoorOpen;

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

        {activeStep === 'plan' && (
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

                  <div
                    ref={openingsAnchorRef}
                    className={`flex items-stretch rounded-lg border transition ${
                      openingToolActive
                        ? 'border-sky-400 bg-sky-500 text-white shadow'
                        : 'border-transparent text-sky-300 bg-sky-500/10 hover:bg-sky-500/20'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={toggleOpeningsMenu}
                      className={`flex flex-1 min-w-0 items-center gap-1.5 rounded-l-lg px-2 py-1.5 text-[11px] font-medium text-left ${
                        openingToolActive ? 'text-white' : 'text-sky-300'
                      }`}
                      title="Двери, окна и перегородки — выпадающий список"
                      aria-haspopup="menu"
                      aria-expanded={openingsMenu !== null}
                    >
                      <OpeningIcon size={14} />
                      <span className="truncate">{openingLabel}</span>
                    </button>
                    <button
                      type="button"
                      onClick={toggleOpeningsMenu}
                      className={`rounded-r-lg border-l px-1 transition ${
                        openingToolActive
                          ? 'border-white/20 hover:bg-white/10'
                          : 'border-sky-500/20 hover:bg-sky-500/20'
                      }`}
                      title="Выбрать: дверь, окно или перегородка"
                      aria-label="Проёмы и перегородки"
                    >
                      <span className="text-[9px]">▾</span>
                    </button>
                  </div>
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

        {activeStep === 'plan' && (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1">
              Электрика
            </div>
            <div className="flex flex-col gap-0.5">

              {frameToolActive ? (
                <div className="flex items-stretch rounded-lg border border-sky-400 bg-sky-500 text-white shadow">
                  <button
                    ref={frameAnchorRef}
                    type="button"
                    onClick={() => {
                      if (frameAnchorRef.current) openFrameMenu(frameAnchorRef.current);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-l-lg px-2 py-1.5 text-left text-[11px] font-medium"
                    title="Открыть меню подрозетника: места и механизмы"
                  >
                    <SquareDashed size={13} className="shrink-0" />
                    <span className="truncate">Подрозетник</span>
                    <span className="ml-auto shrink-0 rounded bg-white/20 px-1 font-mono text-[9px]">
                      {activeFramePosts}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool('select')}
                    className="rounded-r-lg border-l border-white/20 px-1 text-white/70 hover:bg-white/10 hover:text-white"
                    title="Выйти из режима подрозетника (Esc)"
                    aria-label="Выйти из режима размещения подрозетника"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  ref={frameAnchorRef}
                  type="button"
                  onClick={() => {
                    if (frameAnchorRef.current) openFrameMenu(frameAnchorRef.current);
                  }}
                  className={toolClass(false, true)}
                  title="Подрозетник: места, механизмы и их параметры"
                >
                  <SquareDashed size={13} />
                  Подрозетник
                </button>
              )}

              {frameToolActive && (
                <p className="px-1 text-[9px] leading-snug text-sky-300/80">
                  {activeFrameMounting === 'flush' ? 'Скрытая' : 'Накладная'} ·{' '}
                  {frameSeatSummary}. Клик по стене ставит блок целиком.
                </p>
              )}

              {!frameToolActive &&
                DEVICE_CATALOG_TREE.map(({ section }) => {
                  const leaves = sectionLeaves(section.id);
                  const mechanismOnly =
                    leaves.length > 0 && leaves.every((leaf) => isMechanismType(leaf.type));
                  // Розетки и выключатели живут внутри подрозетника:
                  // отдельные разделы в панели не нужны.
                  if (mechanismOnly) return null;
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
                          : leaves.length === 0
                            ? 'border-transparent text-slate-500'
                            : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleDeviceSectionClick(section.id)}
                        className="flex flex-1 min-w-0 items-center gap-1.5 rounded-l-lg px-2 py-1.5 text-[11px] font-medium text-left"
                        title={
                          leaves.length === 0
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

            {showActiveDeviceCard && (
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
                  ? 'На плане · состав щитка — на шаге «Трассировка»'
                  : 'Поставьте щиток на стену'}
              </p>
            </div>
          </>
        )}

        {activeStep === 'lines' && (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1">
              Трассировка
            </div>
            <button
              onClick={() => openPanelStep('devices')}
              className={toolClass(panelStep === 'devices')}
            >
              <ListChecks size={14} />
              Приборы
            </button>
            <button
              onClick={() => openPanelStep('cable')}
              className={toolClass(panelStep === 'cable')}
            >
              <Cable size={14} />
              Кабель
            </button>
            <button
              onClick={() => openPanelStep('protection')}
              className={toolClass(panelStep === 'protection')}
            >
              <ShieldCheck size={14} />
              Защита
            </button>
            <p className="px-1 text-[9px] leading-snug text-slate-500">
              Состав, кабели и защита — сбоку. Шаги 1–3 раскрываются в панели.
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

      {openingsMenu && (
        <OpeningPickerMenu
          anchorEl={openingsMenu.anchorEl}
          onPick={pickOpening}
          onClose={() => setOpeningsMenu(null)}
        />
      )}

      {catalogMenu && (
        <DeviceCatalogMenu
          key={`${catalogMenu.mode}-${catalogMenu.section}`}
          anchorEl={catalogMenu.anchorEl}
          initialSection={catalogMenu.section}
          activeDeviceType={
            catalogMenu.mode === 'frame'
              ? activeFrameSeatTypes.find((type) => type !== null) ?? activeDeviceType
              : activeDeviceType
          }
          preferences={devicePreferences}
          onSelect={selectDeviceType}
          onToggleFavorite={toggleFavorite}
          onClose={() => setCatalogMenu(null)}
          frameMode={
            catalogMenu.mode === 'frame'
              ? {
                  posts: activeFramePosts,
                  mounting: activeFrameMounting,
                  seatTypes: activeFrameSeatTypes,
                  heightMm: activeFrameHeightMm,
                  onPostsChange: setActiveFramePosts,
                  onMountingChange: setActiveFrameMounting,
                  onSeatTypeChange: setActiveFrameSeatType,
                  onHeightChange: setActiveFrameHeight,
                  onPlace: () => {
                    startFramePlacement();
                    setCatalogMenu(null);
                  },
                }
              : undefined
          }
        />
      )}
    </>
  );
};

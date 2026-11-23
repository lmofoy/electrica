import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftRight,
  Box,
  Cable,
  Check,
  CircleDashed,
  CircleDot,
  Clock,
  Lamp,
  LampCeiling,
  LampWallUp,
  Lightbulb,
  Minus,
  Plug,
  Radar,
  Rows3,
  ScanEye,
  Search,
  Shuffle,
  SlidersHorizontal,
  SquareDashed,
  Star,
  Sun,
  ToggleLeft,
  X,
  Zap,
} from 'lucide-react';
import type { DeviceType, FrameMounting, FramePosts } from '../../types';
import {
  DEVICE_CATALOG,
  DEVICE_CATALOG_TREE,
  DEVICE_SECTIONS,
  isMechanismType,
  searchDeviceCatalog,
  type DeviceCatalogEntry,
  type DeviceCatalogLeaf,
  type DeviceCatalogSectionId,
  type DeviceCatalogSectionView,
  type DeviceGlyphKind,
} from '../../core/electrical/devices';
import { FRAME_POSTS_OPTIONS, framePlateWidthMm } from '../../core/electrical/frames';
import { LINE_PRESETS } from '../../core/electrical/norms';
import type { DeviceUiPreferences } from '../../core/electrical/devicePreferences';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

const GLYPH_ICONS: Record<DeviceGlyphKind, IconComponent> = {
  socket: Plug,
  switch_key: ToggleLeft,
  switch_pass: ArrowLeftRight,
  switch_cross: Shuffle,
  switch_dimmer: SlidersHorizontal,
  switch_motion: Radar,
  switch_presence: ScanEye,
  switch_provision: CircleDashed,
  light_ceiling: Lightbulb,
  light_surface: LampCeiling,
  light_recessed: CircleDot,
  light_sconce: Lamp,
  light_wall_wet: LampWallUp,
  light_track: Rows3,
  light_strip: Minus,
  light_outdoor: Sun,
  light_provision: CircleDashed,
};

const SECTION_ICONS: Record<DeviceCatalogSectionId, IconComponent> = {
  sockets: Plug,
  switches: ToggleLeft,
  lighting: Lightbulb,
  power: Zap,
  lowvoltage: Cable,
  other: Box,
};

const CONNECTION_LABELS: Record<DeviceCatalogEntry['connection'], string> = {
  socket: 'Розетка',
  terminal: 'Клеммник',
  direct: 'Прямое подключение',
  provision: 'Закладная',
};

const MOUNTING_LABELS: Record<DeviceCatalogEntry['mounting'], string> = {
  wall: 'Стена',
  ceiling: 'Потолок',
};

export function DeviceTypeIcon({
  type,
  size = 14,
  className,
}: {
  type: DeviceType;
  size?: number;
  className?: string;
}) {
  const Icon = GLYPH_ICONS[DEVICE_CATALOG[type].glyph];
  return <Icon size={size} className={className} />;
}

export function DeviceSectionIcon({
  section,
  size = 14,
  className,
}: {
  section: DeviceCatalogSectionId;
  size?: number;
  className?: string;
}) {
  const Icon = SECTION_ICONS[section];
  return <Icon size={size} className={className} />;
}

function sectionView(sectionId: DeviceCatalogSectionId): DeviceCatalogSectionView {
  return (
    DEVICE_CATALOG_TREE.find((view) => view.section.id === sectionId) ??
    DEVICE_CATALOG_TREE[0]
  );
}

function subsectionFor(
  view: DeviceCatalogSectionView,
  type: DeviceType | null
): string | null {
  if (!type) return view.subsections[0]?.id ?? null;
  const containing = view.subsections.find((subsection) =>
    subsection.leaves.some((leaf) => leaf.type === type)
  );
  return containing?.id ?? view.subsections[0]?.id ?? null;
}

function previewFor(
  view: DeviceCatalogSectionView,
  subsectionId: string | null,
  preferred: DeviceType | null
): DeviceType | null {
  const subsection = view.subsections.find((candidate) => candidate.id === subsectionId);
  const leaves = subsection?.leaves ?? view.subsections.flatMap((candidate) => candidate.leaves);
  return (
    leaves.find((leaf) => leaf.type === preferred)?.type ??
    leaves[0]?.type ??
    null
  );
}

function sectionLabel(sectionId: DeviceCatalogSectionId): string {
  return DEVICE_SECTIONS.find((section) => section.id === sectionId)?.label ?? sectionId;
}

function lineLabel(entry: DeviceCatalogEntry): string {
  return entry.suggestedPurpose
    ? LINE_PRESETS[entry.suggestedPurpose].label
    : 'Не силовая';
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-[11px] text-slate-200">{value}</dd>
    </div>
  );
}

function BadgeChip({ entry }: { entry: DeviceCatalogEntry }) {
  // IP-бейдж не дублируем: он уже выводится отдельной строкой характеристик.
  if (!entry.badge || entry.badge === entry.ipRating) return null;
  return (
    <span className="shrink-0 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[9px] font-semibold text-slate-400">
      {entry.badge}
    </span>
  );
}

function QuickChip({
  type,
  onSelect,
}: {
  type: DeviceType;
  onSelect: (type: DeviceType) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(type)}
      className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300 transition hover:border-sky-500/60 hover:text-white"
    >
      <DeviceTypeIcon type={type} size={10} />
      {DEVICE_CATALOG[type].shortLabel}
    </button>
  );
}

export interface FrameCatalogConfig {
  posts: FramePosts;
  mounting: FrameMounting;
  seatTypes: (DeviceType | null)[];
  heightMm: number;
  onPostsChange: (posts: FramePosts) => void;
  onMountingChange: (mounting: FrameMounting) => void;
  onSeatTypeChange: (seatIndex: number, type: DeviceType | null) => void;
  onHeightChange: (heightMm: number) => void;
  onPlace: () => void;
}

const MOUNTING_OPTIONS: { id: FrameMounting; label: string; hint: string }[] = [
  { id: 'flush', label: 'Скрытая', hint: 'Подрозетник утоплен в стену, механизмы заподлицо' },
  { id: 'surface', label: 'Накладная', hint: 'Подрозетник стоит поверх отделки, для бетона и кирпича' },
];

const FrameHeightInput = ({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (heightMm: number) => void;
}) => {
  // Черновик живёт до commit; внешнее значение приходит через key и перемонтирует поле.
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(String(value));
  };
  return (
    <input
      type="number"
      step={10}
      min={0}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }}
      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-sky-500"
      aria-label="Высота блока от пола, мм"
    />
  );
};

export interface DeviceCatalogMenuProps {
  anchorEl: HTMLElement;
  initialSection: DeviceCatalogSectionId;
  activeDeviceType: DeviceType;
  preferences: DeviceUiPreferences;
  onSelect: (type: DeviceType) => void;
  onToggleFavorite: (type: DeviceType) => void;
  onClose: () => void;
  // Режим рамки: слева — число мест, в центре — механизмы, справа — паспорт.
  frameMode?: FrameCatalogConfig;
}

function computePlacement(anchorEl: HTMLElement) {
  const rect = anchorEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(880, Math.max(320, viewportWidth - 24));
  const left = Math.min(
    Math.max(12, rect.left),
    Math.max(12, viewportWidth - width - 12)
  );
  const spaceBelow = viewportHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const placeBelow = spaceBelow >= 360 || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(240, Math.min(640, placeBelow ? spaceBelow : spaceAbove));
  const top = placeBelow
    ? rect.bottom + 8
    : Math.max(12, rect.top - maxHeight - 8);
  return { left, top, width, maxHeight };
}

export function DeviceCatalogMenu({
  anchorEl,
  initialSection,
  activeDeviceType,
  preferences,
  onSelect,
  onToggleFavorite,
  onClose,
  frameMode,
}: DeviceCatalogMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isFrameMode = frameMode !== undefined;
  const frameViews = useMemo(
    () =>
      DEVICE_CATALOG_TREE.filter((view) =>
        view.subsections.some((subsection) =>
          subsection.leaves.some((leaf) => isMechanismType(leaf.type))
        )
      ),
    []
  );
  const sectionViews = isFrameMode ? frameViews : DEVICE_CATALOG_TREE;
  const safeInitialSection = sectionViews.some(
    (view) => view.section.id === initialSection
  )
    ? initialSection
    : sectionViews[0]?.section.id ?? initialSection;
  const initialView = sectionView(safeInitialSection);
  const [sectionId, setSectionId] = useState<DeviceCatalogSectionId>(safeInitialSection);
  const [subsectionId, setSubsectionId] = useState<string | null>(() =>
    subsectionFor(initialView, activeDeviceType)
  );
  const [previewType, setPreviewType] = useState<DeviceType | null>(() =>
    previewFor(initialView, subsectionFor(initialView, activeDeviceType), activeDeviceType)
  );
  const [query, setQuery] = useState('');
  const [seatIndex, setSeatIndex] = useState(0);
  const [placement, setPlacement] = useState(() => computePlacement(anchorEl));

  const updatePlacement = useCallback(() => {
    setPlacement(computePlacement(anchorEl));
  }, [anchorEl]);

  useEffect(() => {
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [updatePlacement]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || anchorEl.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [anchorEl, onClose]);

  const view = useMemo(() => sectionView(sectionId), [sectionId]);
  const activeSubsection =
    view.subsections.find((subsection) => subsection.id === subsectionId) ??
    view.subsections[0] ??
    null;
  const sectionLeaves = useMemo(
    () => view.subsections.flatMap((subsection) => subsection.leaves),
    [view]
  );
  const frameLeaves = useMemo(
    () =>
      view.subsections.flatMap((subsection) =>
        subsection.leaves.filter((leaf) => isMechanismType(leaf.type))
      ),
    [view]
  );
  const results = useMemo(() => {
    const found = searchDeviceCatalog(query);
    return isFrameMode
      ? found.filter((leaf) => isMechanismType(leaf.type))
      : found;
  }, [query, isFrameMode]);
  const previewLeaf: DeviceCatalogLeaf | null = useMemo(() => {
    if (query.trim()) return results[0] ?? null;
    const source = isFrameMode
      ? frameLeaves
      : activeSubsection?.leaves ?? sectionLeaves;
    return (
      source.find((leaf) => leaf.type === previewType) ??
      source.find((leaf) => leaf.type === activeDeviceType) ??
      source[0] ??
      null
    );
  }, [
    query,
    results,
    isFrameMode,
    frameLeaves,
    activeSubsection,
    sectionLeaves,
    previewType,
    activeDeviceType,
  ]);

  const recentTypes = preferences.recentDeviceTypes.filter(
    (type) =>
      DEVICE_CATALOG[type] && (!isFrameMode || isMechanismType(type))
  );
  const favoriteTypes = preferences.favoriteDeviceTypes.filter(
    (type) =>
      DEVICE_CATALOG[type] && (!isFrameMode || isMechanismType(type))
  );

  // Выбранное место нового блока: механизм попадает именно в него.
  const activeSeat = frameMode ? Math.min(seatIndex, frameMode.posts - 1) : 0;
  const seatTypes = frameMode ? frameMode.seatTypes.slice(0, frameMode.posts) : [];
  const seatType = seatTypes[activeSeat] ?? null;
  const seatLeaf: DeviceCatalogLeaf | null = seatType
    ? { type: seatType, entry: DEVICE_CATALOG[seatType] }
    : null;
  const filledSeats = seatTypes.filter((type) => type !== null).length;
  const passportLeaf = isFrameMode ? seatLeaf : previewLeaf;
  const blockLabel = frameMode
    ? `Поставить подрозетник · ${frameMode.posts} ${
        frameMode.posts === 1 ? 'место' : 'места'
      } · ${frameMode.mounting === 'flush' ? 'скрытая' : 'накладная'}`
    : '';
  const isFavorite =
    passportLeaf !== null && favoriteTypes.includes(passportLeaf.type);

  const assignSeat = (type: DeviceType | null) => {
    if (!frameMode) return;
    frameMode.onSeatTypeChange(activeSeat, type);
    if (type) setSectionId(DEVICE_CATALOG[type].section);
    setQuery('');
  };

  const goToNextFreeSeat = () => {
    if (!frameMode) return;
    const next = seatTypes.findIndex((type) => type === null);
    if (next >= 0) setSeatIndex(next);
  };

  const renderLeafRow = (leaf: DeviceCatalogLeaf) => {
    const isActive = isFrameMode
      ? leaf.type === seatType
      : leaf.type === activeDeviceType;
    const isPreview = !isFrameMode && leaf.type === previewLeaf?.type;
    return (
      <button
        key={leaf.type}
        type="button"
        onMouseEnter={() => {
          if (!isFrameMode) setPreviewType(leaf.type);
        }}
        onFocus={() => {
          if (!isFrameMode) setPreviewType(leaf.type);
        }}
        onClick={() =>
          isFrameMode ? assignSeat(leaf.type) : onSelect(leaf.type)
        }
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
          isPreview ? 'bg-slate-800/90' : 'hover:bg-slate-900'
        }`}
        title={
          isFrameMode
            ? `${leaf.entry.label} → место ${activeSeat + 1}`
            : leaf.entry.label
        }
      >
        <DeviceTypeIcon type={leaf.type} size={14} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-xs font-semibold text-white">
              {leaf.entry.shortLabel}
            </span>
            <BadgeChip entry={leaf.entry} />
          </span>
          <span className="block truncate text-[10px] text-slate-500">
            {leaf.entry.ipRating}
            {leaf.entry.mounting === 'ceiling'
              ? ''
              : ` · H ${leaf.entry.defaultHeightMm} мм`}
          </span>
        </span>
        {leaf.entry.defaultPowerWatts > 0 && (
          <span className="shrink-0 font-mono text-[9px] text-slate-600">
            {leaf.entry.defaultPowerWatts} Вт
          </span>
        )}
        {isActive && <Check size={12} className="shrink-0 text-sky-400" />}
      </button>
    );
  };

  const handleSectionSelect = (nextSectionId: DeviceCatalogSectionId) => {
    const nextView = sectionView(nextSectionId);
    const nextSubsectionId = subsectionFor(nextView, activeDeviceType);
    setSectionId(nextSectionId);
    setSubsectionId(nextSubsectionId);
    setPreviewType(previewFor(nextView, nextSubsectionId, activeDeviceType));
    setQuery('');
  };

  // В режиме рамки чипы сразу ставят механизм в выбранное место.
  const previewFrameType = (type: DeviceType) => assignSeat(type);

  const handleSubsectionSelect = (nextSubsectionId: string) => {
    setSubsectionId(nextSubsectionId);
    const nextSubsection = view.subsections.find(
      (subsection) => subsection.id === nextSubsectionId
    );
    setPreviewType(nextSubsection?.leaves[0]?.type ?? null);
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      if (isFrameMode) previewFrameType(results[0].type);
      else onSelect(results[0].type);
    }
  };

  const compact = placement.width < 720;
  const gridTemplateColumns = compact
    ? '1fr'
    : '200px 260px minmax(250px, 1fr)';

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[80] flex flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-200 shadow-2xl shadow-black/70"
      style={{
        left: placement.left,
        top: placement.top,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
      role="dialog"
      aria-label={isFrameMode ? 'Каталог механизмов для подрозетника' : 'Каталог электрических элементов'}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-800 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {sectionViews.map(({ section, count }) => {
            const isActive = section.id === sectionId;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => handleSectionSelect(section.id)}
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                  isActive
                    ? 'bg-sky-500 text-white shadow'
                    : count === 0
                      ? 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
                title={section.hint}
              >
                <DeviceSectionIcon section={section.id} size={12} />
                {section.label}
                {count > 0 && (
                  <span
                    className={`font-mono text-[9px] ${
                      isActive ? 'text-sky-100' : 'text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-500 transition hover:bg-slate-800 hover:text-white"
          title="Закрыть (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      <div className="shrink-0 border-b border-slate-800 px-2.5 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5">
          <Search size={13} className="shrink-0 text-slate-500" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={
              isFrameMode
                ? 'Найти механизм: розетка, влажная, выключатель…'
                : 'Найти элемент: розетка, влажная, люстра…'
            }
            className="min-w-0 flex-1 bg-transparent text-xs text-white placeholder:text-slate-600 focus:outline-none"
            aria-label="Поиск по каталогу"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-white"
              title="Очистить поиск"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {!query && (recentTypes.length > 0 || favoriteTypes.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-500">
            {recentTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <Clock size={11} />
                <span>Недавние:</span>
                {recentTypes.map((type) => (
                  <QuickChip
                    key={`recent-${type}`}
                    type={type}
                    onSelect={isFrameMode ? previewFrameType : onSelect}
                  />
                ))}
              </div>
            )}
            {favoriteTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <Star size={11} />
                <span>Избранное:</span>
                {favoriteTypes.map((type) => (
                  <QuickChip
                    key={`favorite-${type}`}
                    type={type}
                    onSelect={isFrameMode ? previewFrameType : onSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {query.trim() ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length > 0 ? (
            results.map((leaf) => (
              <button
                key={leaf.type}
                type="button"
                onClick={() =>
                  isFrameMode ? previewFrameType(leaf.type) : onSelect(leaf.type)
                }
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-slate-900"
              >
                <DeviceTypeIcon type={leaf.type} size={15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-white">
                    {leaf.entry.label}
                  </span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {sectionLabel(leaf.entry.section)} → {leaf.entry.subsection} ·{' '}
                    {leaf.entry.ipRating}
                  </span>
                </span>
                <BadgeChip entry={leaf.entry} />
                {leaf.type === (isFrameMode ? seatType : activeDeviceType) && (
                  <Check size={12} className="shrink-0 text-sky-400" />
                )}
              </button>
            ))
          ) : (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 px-6 text-center">
              <span className="text-xs text-slate-400">Ничего не найдено</span>
              <span className="text-[10px] text-slate-600">
                Попробуйте «розетка», «влажная», «свет» или «IP44».
              </span>
            </div>
          )}
        </div>
      ) : view.count === 0 ? (
        <div className="flex min-h-52 flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-600">
            <DeviceSectionIcon section={view.section.id} size={24} />
          </div>
          <div className="text-sm font-semibold text-slate-300">{view.section.label}</div>
          <div className="max-w-xs text-[11px] leading-relaxed text-slate-500">
            {view.section.hint}. Раздел подготовлен, наполнение появится на следующем
            этапе.
          </div>
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 overflow-hidden"
          style={{ gridTemplateColumns }}
        >
          <div
            className={`min-h-0 overflow-y-auto border-slate-800 p-1.5 ${
              compact ? 'border-b' : 'border-r'
            }`}
          >
            {frameMode ? (
              <div className="flex flex-col gap-2">
                <div>
                  <div className="px-1 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    Монтаж блока
                  </div>
                  <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-slate-700 bg-slate-900 p-0.5">
                    {MOUNTING_OPTIONS.map((option) => {
                      const isActive = frameMode.mounting === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => frameMode.onMountingChange(option.id)}
                          title={option.hint}
                          className={`rounded-md py-1.5 text-[11px] font-semibold transition ${
                            isActive
                              ? 'bg-sky-500 text-white shadow'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="px-1 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    Мест в подрозетнике
                  </div>
                  <div className="grid grid-cols-4 gap-0.5">
                    {FRAME_POSTS_OPTIONS.map((posts) => {
                      const isActive = frameMode.posts === posts;
                      return (
                        <button
                          key={posts}
                          type="button"
                          onClick={() => frameMode.onPostsChange(posts)}
                          className={`rounded py-1 text-[11px] font-mono font-semibold transition ${
                            isActive
                              ? 'bg-sky-500 text-white'
                              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                          }`}
                          title={`Подрозетник на ${posts} ${posts === 1 ? 'место' : 'места'} · ${framePlateWidthMm(posts)} мм`}
                        >
                          {posts}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="px-1 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    Места блока
                  </div>
                  {Array.from({ length: frameMode.posts }, (_, seat) => {
                    const type = frameMode.seatTypes[seat] ?? null;
                    const isActive = seat === activeSeat;
                    return (
                      <button
                        key={seat}
                        type="button"
                        onClick={() => setSeatIndex(seat)}
                        className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition ${
                          isActive
                            ? 'bg-slate-800 ring-1 ring-sky-500'
                            : 'hover:bg-slate-900'
                        }`}
                        title={`Место ${seat + 1}: выбрать механизм`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[9px] ${
                            isActive
                              ? 'bg-sky-500 text-white'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {seat + 1}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-[11px] ${
                            type ? 'text-slate-200' : 'italic text-slate-500'
                          }`}
                        >
                          {type ? DEVICE_CATALOG[type].shortLabel : 'Заглушка'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <label className="block px-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    Высота блока, мм
                  </span>
                  <span className="mt-1 block">
                    <FrameHeightInput
                      key={`frame-height-${frameMode.heightMm}`}
                      value={frameMode.heightMm}
                      onCommit={frameMode.onHeightChange}
                    />
                  </span>
                </label>

                <div className="px-1 text-[9px] leading-snug text-slate-600">
                  {framePlateWidthMm(frameMode.posts)} мм по стене · одна высота на все
                  места
                </div>
              </div>
            ) : (
              view.subsections.map((subsection) => {
                const isActive = subsection.id === activeSubsection?.id;
                return (
                  <button
                    key={subsection.id}
                    type="button"
                    onClick={() => handleSubsectionSelect(subsection.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-[11px] transition ${
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    <span className="truncate">{subsection.label}</span>
                    <span className="font-mono text-[9px] text-slate-600">
                      {subsection.leaves.length}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div
            className={`min-h-0 overflow-y-auto border-slate-800 p-1.5 ${
              compact ? 'border-b' : 'border-r'
            }`}
          >
            {frameMode ? (
              <>
                <div className="mb-1">
                  <div className="px-2 pt-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    Место {activeSeat + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() => assignSeat(null)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
                      seatType === null ? 'bg-slate-800/90' : 'hover:bg-slate-900'
                    }`}
                    title="Оставить место пустым — закроется заглушкой"
                  >
                    <SquareDashed size={14} className="text-slate-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-white">
                        Заглушка
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        Пустое место без механизма
                      </span>
                    </span>
                    {seatType === null && (
                      <Check size={12} className="shrink-0 text-sky-400" />
                    )}
                  </button>
                </div>
                {view.subsections.map((subsection) => {
                  const leaves = subsection.leaves.filter((leaf) =>
                    isMechanismType(leaf.type)
                  );
                  if (leaves.length === 0) return null;
                  return (
                    <div key={subsection.id} className="mb-1">
                      <div className="px-2 pt-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                        {subsection.label}
                      </div>
                      {leaves.map(renderLeafRow)}
                    </div>
                  );
                })}
              </>
            ) : (
              activeSubsection?.leaves.map(renderLeafRow)
            )}
          </div>

          <div className="min-h-0 overflow-y-auto p-3">
            {frameMode && !passportLeaf ? (
              <div className="flex h-full flex-col gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-500">
                    <SquareDashed size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-tight text-white">
                      Место {activeSeat + 1} — заглушка
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {frameMode.mounting === 'flush' ? 'Скрытая' : 'Накладная'} ·
                      высота {frameMode.heightMm} мм
                    </div>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Выберите розетку или выключатель в средней колонке — механизм
                  встанет на это место. Место без механизма закроется заглушкой.
                </p>
                <div className="rounded-md border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-[10px] text-slate-400">
                  Заполнено {filledSeats} из {frameMode.posts}. Каждый компонент
                  можно выделить и посмотреть его параметры.
                </div>
                <button
                  type="button"
                  onClick={frameMode.onPlace}
                  disabled={filledSeats === 0}
                  className="mt-auto flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-950/40 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                >
                  <Check size={13} />
                  {filledSeats === 0 ? 'Выберите механизмы для мест' : blockLabel}
                </button>
              </div>
            ) : passportLeaf ? (
              <div className="flex h-full flex-col gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-300">
                    <DeviceTypeIcon type={passportLeaf.type} size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-tight text-white">
                      {passportLeaf.entry.label}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-slate-500">
                      <span className="truncate">
                        {sectionLabel(passportLeaf.entry.section)} →{' '}
                        {passportLeaf.entry.subsection}
                      </span>
                      <BadgeChip entry={passportLeaf.entry} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(passportLeaf.type)}
                    className={`rounded-md p-1 transition ${
                      isFavorite
                        ? 'text-amber-400 hover:bg-amber-500/10'
                        : 'text-slate-600 hover:bg-slate-800 hover:text-slate-300'
                    }`}
                    title={
                      isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'
                    }
                  >
                    <Star
                      size={14}
                      className={isFavorite ? 'fill-amber-400' : undefined}
                    />
                  </button>
                </div>

                <p className="text-[11px] leading-relaxed text-slate-400">
                  {passportLeaf.entry.description}
                </p>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <SpecRow
                    label="Монтаж"
                    value={MOUNTING_LABELS[passportLeaf.entry.mounting]}
                  />
                  <SpecRow
                    label="Высота"
                    value={
                      passportLeaf.entry.mounting === 'ceiling'
                        ? 'Потолок'
                        : `${passportLeaf.entry.defaultHeightMm} мм`
                    }
                  />
                  <SpecRow
                    label="Мощность"
                    value={
                      passportLeaf.entry.defaultPowerWatts > 0
                        ? `${passportLeaf.entry.defaultPowerWatts} Вт`
                        : '—'
                    }
                  />
                  <SpecRow label="IP" value={passportLeaf.entry.ipRating} />
                  <SpecRow
                    label="Подключение"
                    value={CONNECTION_LABELS[passportLeaf.entry.connection]}
                  />
                  <SpecRow label="Линия" value={lineLabel(passportLeaf.entry)} />
                </dl>

                {passportLeaf.entry.requiresDedicatedLine && (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-300">
                    Рекомендуется отдельная линия.
                  </div>
                )}

                <div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">
                    Нормы
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {passportLeaf.entry.normRefs.map((reference) => (
                      <span
                        key={reference}
                        className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] text-slate-400"
                      >
                        {reference}
                      </span>
                    ))}
                  </div>
                </div>

                {frameMode && (
                  <div className="rounded-md border border-sky-500/20 bg-sky-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-sky-300">
                    Стоит на месте {activeSeat + 1} из {frameMode.posts}. Высота блока
                    общая: {frameMode.heightMm} мм.
                  </div>
                )}

                <div className="mt-auto flex flex-col gap-1.5">
                  {frameMode && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => assignSeat(null)}
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
                      >
                        Освободить место
                      </button>
                      <button
                        type="button"
                        onClick={goToNextFreeSeat}
                        disabled={filledSeats >= frameMode.posts}
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600"
                      >
                        Следующее свободное
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      frameMode ? frameMode.onPlace() : onSelect(passportLeaf.type)
                    }
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-950/40 transition hover:bg-sky-400"
                  >
                    <Check size={13} />
                    {frameMode
                      ? blockLabel
                      : passportLeaf.type === activeDeviceType
                        ? 'Продолжить установку'
                        : 'Выбрать элемент'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
                Выберите элемент слева.
              </div>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

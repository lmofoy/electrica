import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  calculateNetAreaM2,
  distance,
  isPointInPolygon,
  pointToSegmentDistance,
  projectPointOnSegment,
} from '../core/geometry/math';
import type {
  Point2D,
  Node2D,
  Wall,
  Opening,
  OpeningType,
  FreePartition,
  ApartmentBoundary,
  RoomZone,
  RoomType,
  ProjectSettings,
  ProjectSnapshot,
  CADTool,
  DynamicInputState,
  SnapResult,
  DrawingStage,
  BoundaryMode,
  ToastMessage,
  DesignMode,
  Selection,
  DeviceType,
  DeviceAnchor,
  ElectricalDevice,
  ElectricalPanel,
  CircuitLine,
  ManualRoute,
  LinePurpose,
  PanelStrategy,
  PanelSupply,
  ProjectStep,
  PanelStep,
  PlanSheetSpec,
  FrameAnchor,
  FrameMounting,
  FramePosts,
  MountingFrame,
} from '../types';
import {
  calculateRoomsOverlapAreaM2,
  clipRoomToApartment,
  splitRoomByPartition,
  unionApartmentBoundary,
} from '../core/geometry/csg';
import { calculateCoveredAreaM2, extractGraphFromPlan } from '../core/geometry/wallsGraph';
import {
  buildAutoLayout,
  isAutoLayoutConnected,
  validateNewRoom,
  validatePartitionPlacement,
  type AutoLayout,
} from '../core/geometry/autoLayout';
import {
  DEVICE_CATALOG,
  isMechanismType,
  normalizeDeviceNote,
  resolveDevice,
} from '../core/electrical/devices';
import {
  clampFrameOffset,
  frameSeatAnchor,
  resolveFramePose,
  sanitizeElectrical,
} from '../core/electrical/frames';
import {
  applyStrategy,
  createEmptyPanel,
  createLine,
  recalculateSupply,
  sanitizePanel,
  type PanelWallAnchor,
} from '../core/electrical/panel';
import { applyPresetProtection } from '../core/electrical/norms';
import { buildPanelLayout } from '../core/electrical/panelLayout';
import { prunePanelRefs } from '../core/electrical/lineAssignment';
import {
  insertManualRouteNode,
  moveManualRouteAnchors,
  moveManualRouteNode,
  removeManualRouteNode,
  removeManualRouteSegment,
  reorderManualRouteStops,
  type ManualRouteAnchorMove,
} from '../core/electrical/manualRoute';
import {
  materializeRouteForLine,
  type LineRouteInput,
} from '../core/electrical/routing';
import {
  ROUTE_LINK_EPS_MM,
  insertJunctionIntoRoute,
  linkManualRoute,
  routeJunctionPlacementError,
  type RouteLinkAxis,
  type RouteLinkEndpoint,
} from '../core/electrical/routeLink';
import {
  appendUnassignedDevices as appendUnassignedDevicesOp,
  assignDevices,
  createLineFromDevices,
  mergeLines,
  nextColorIndex,
  nextLineCode,
  normalizeLineAssignments,
  splitLine,
  unassignDevices,
} from '../core/electrical/lineOps';
import {
  autoPlanSheetName,
  prunePlanSheets,
  sanitizePlanSheet,
} from '../core/electrical/planSheets';
import { collectRoomElements } from '../core/model/roomElements';
import { validateProjectSnapshot } from '../core/model/projectValidation';

let idCounter = 0;
function makeEntityId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function keepLineHighlight(
  panel: ElectricalPanel | null,
  highlightedLineId: string | null
): string | null {
  if (!highlightedLineId) return null;
  return panel?.lines.some((line) => line.id === highlightedLineId)
    ? highlightedLineId
    : null;
}

function withDinOrder(
  panel: ElectricalPanel,
  order: string[] | undefined
): ElectricalPanel {
  const next = { ...panel };
  if (order && order.length > 0) next.dinOrder = order;
  else delete next.dinOrder;
  return next;
}

// Рамка жила на удаляемой стене/перегородке — убираем её и механизмы в ней.
function framesAfterHostRemoval(
  frames: MountingFrame[],
  devices: ElectricalDevice[],
  isAlive: (frame: MountingFrame) => boolean
): { frames: MountingFrame[]; devices: ElectricalDevice[] } {
  const removed = new Set(frames.filter((frame) => !isAlive(frame)).map((frame) => frame.id));
  if (removed.size === 0) return { frames, devices };
  return {
    frames: frames.filter((frame) => !removed.has(frame.id)),
    devices: devices.filter((device) => !device.frameId || !removed.has(device.frameId)),
  };
}

// 100 мм²: отсекаем погрешность вычислений, но ловим реальное наложение
const ROOM_OVERLAP_TOLERANCE_M2 = 0.0001;

interface ProjectState {
  // Графовая модель данных (Nodes + Walls + Rooms)
  nodes: Record<string, Node2D>;
  walls: Wall[];
  openings: Opening[];
  freePartitions: FreePartition[];
  devices: ElectricalDevice[];
  frames: MountingFrame[];
  panel: ElectricalPanel | null;
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  selection: Selection | null;

  // Шаг проекта и шаг правой панели трассировки
  activeStep: ProjectStep;
  panelStep: PanelStep;
  highlightedLineId: string | null;
  // Линия, в которую назначаются приборы кликами на плане (UI-режим)
  lineAssignLineId: string | null;
  // Состав щитка на входе в режим назначения: Esc откатывает сессию целиком
  lineAssignStartPanel: ElectricalPanel | null;
  // Линия, у которой редактируется ручная трасса на плане (UI-режим)
  routeEditLineId: string | null;

  // Настройки
  settings: ProjectSettings;

  // Режим работы и активный электроприбор
  designMode: DesignMode;
  activeDeviceType: DeviceType;
  deviceShared: boolean;
  activeFramePosts: FramePosts;
  // Конфигурация нового блока: монтаж, состав мест и одна высота на весь блок.
  // Пустое место (null) закрывается заглушкой и не создаёт прибор.
  activeFrameMounting: FrameMounting;
  activeFrameSeatTypes: (DeviceType | null)[];
  activeFrameHeightMm: number;

  // Холст и навигация
  activeTool: CADTool;
  activeRoomType: RoomType;
  zoom: number;
  stagePos: Point2D;
  gridSnap: boolean;
  gridStepMm: number;

  // Черчение и привязки
  draftVertices: Point2D[];
  cursorPosMm: Point2D;
  dynamicInput: DynamicInputState;
  activeSnap: SnapResult;

  // UX Workflow
  boundaryMode: BoundaryMode;
  drawingStage: DrawingStage;
  boundaryLocked: boolean;
  activeOpeningType: OpeningType;
  toasts: ToastMessage[];
  isCoverageValid: boolean;
  coveragePercent: number;

  // Actions
  setSettings: (settings: Partial<ProjectSettings>) => void;
  setActiveTool: (tool: CADTool) => void;
  setDrawingStage: (stage: DrawingStage) => void;
  setActiveOpeningType: (type: OpeningType) => void;
  lockBoundary: () => void;
  addToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  removeToast: (id: string) => void;
  setActiveRoomType: (type: RoomType) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setStagePos: (pos: Point2D | ((prev: Point2D) => Point2D)) => void;
  setCursorPosMm: (pos: Point2D) => void;
  setGridSnap: (enabled: boolean) => void;
  setSelection: (selection: Selection | null) => void;
  setActiveSnap: (snap: SnapResult) => void;
  toggleDimensions: () => void;
  checkCoverage: () => void;

  // Режим работы
  setActiveDeviceType: (type: DeviceType) => void;
  setDeviceShared: (shared: boolean) => void;

  // Черчение...
  startApartmentDrawing: () => void;
  startRoomDrawing: (type?: RoomType) => void;
  addDraftVertex: (vertex: Point2D) => void;
  popDraftVertex: () => void;
  finishDraft: () => void;
  cancelDraft: () => void;

  // Динамический ввод
  openDynamicInput: (step: 'length' | 'angle') => void;
  closeDynamicInput: () => void;
  setLockedLength: (len: number | null) => void;
  setLockedAngle: (deg: number | null) => void;
  setDynamicInputValues: (values: Partial<DynamicInputState>) => void;

  // Управление элементами
  setApartment: (apartment: ApartmentBoundary | null) => void;
  deleteApartment: () => void;
  updateRoom: (id: string, updates: Partial<RoomZone>) => void;
  deleteRoom: (id: string) => void;
  deleteOpening: (id: string) => void;
  deletePartition: (id: string) => void;
  addDevice: (type: DeviceType, anchor: DeviceAnchor, shared: boolean) => void;
  setDeviceNote: (id: string, note: string) => void;
  deleteDevice: (id: string) => void;
  moveDevice: (id: string, anchor: DeviceAnchor) => boolean;

  // Рамки и места механизмов
  setActiveFramePosts: (posts: FramePosts) => void;
  setActiveFrameMounting: (mounting: FrameMounting) => void;
  setActiveFrameSeatType: (seatIndex: number, type: DeviceType | null) => void;
  setActiveFrameHeight: (heightMm: number) => void;
  startFramePlacement: () => void;
  addFrame: (anchor: FrameAnchor) => string | null;
  moveFrame: (id: string, anchor: FrameAnchor) => boolean;
  setFramePosts: (id: string, posts: FramePosts) => void;
  setFrameMounting: (id: string, mounting: FrameMounting) => void;
  setFrameHeight: (id: string, heightMm: number) => void;
  setFrameSeatType: (id: string, seatIndex: number, type: DeviceType | null) => void;
  deleteFrame: (id: string) => void;

  // Щиток
  setActiveStep: (step: ProjectStep) => void;
  setPanelStep: (step: PanelStep) => void;
  setHighlightedLine: (id: string | null) => void;
  placePanel: (anchor: PanelWallAnchor) => void;
  deletePanel: () => void;
  updatePanel: (updates: Partial<Omit<ElectricalPanel, 'id' | 'lines' | 'supply'>>) => void;
  updatePanelSupply: (updates: Partial<PanelSupply>) => void;
  setPanelStrategy: (strategy: PanelStrategy) => void;
  appendUnassignedDevices: () => void;
  createManualPanelLine: () => string | undefined;
  updatePanelLine: (id: string, updates: Partial<CircuitLine>) => void;
  deletePanelLine: (id: string) => void;
  clearPanelLines: () => void;
  movePanelDinItem: (itemId: string, targetIndex: number) => void;
  resetPanelDinOrder: () => void;
  savePlanSheet: (sheet: PlanSheetSpec) => void;
  deletePlanSheet: (id: string) => void;
  setLineAssignLine: (id: string | null) => void;
  cancelLineAssignment: () => void;
  assignDevicesToLine: (lineId: string, deviceIds: string[]) => void;
  unassignDevicesFromLines: (deviceIds: string[]) => void;
  createPanelLineFromDevices: (
    deviceIds: string[],
    purpose: LinePurpose
  ) => string | null;
  splitPanelLine: (
    lineId: string,
    deviceIds: string[],
    newPurpose?: LinePurpose
  ) => string | null;
  mergePanelLines: (lineIds: string[]) => string | null;
  setRouteEditLine: (id: string | null) => void;
  moveLineRouteNode: (
    lineId: string,
    nodeIndex: number,
    point: Point2D
  ) => number | null;
  insertLineRouteNode: (
    lineId: string,
    pathIndex: number,
    segmentIndex: number,
    point: Point2D,
    maxDistanceMm?: number
  ) => void;
  removeLineRouteNode: (lineId: string, nodeIndex: number) => boolean;
  removeLineRouteSegment: (
    lineId: string,
    pathIndex: number,
    segmentIndex: number
  ) => boolean;
  reorderLineRouteStops: (
    lineId: string,
    branchIndex: number,
    fromIndex: number,
    toIndex: number
  ) => boolean;
  addLineRouteJunction: (
    lineId: string,
    point: Point2D
  ) => { ok: true } | { ok: false; error: string };
  linkLineRoute: (
    lineId: string,
    from: RouteLinkEndpoint,
    to: RouteLinkEndpoint,
    axisFirst: RouteLinkAxis
  ) => { ok: true } | { ok: false; error: string };
  setLineManualRoute: (lineId: string, manualRoute: ManualRoute | undefined) => void;
  resetLineRoute: (lineId: string) => void;
  addLineWaypoint: (lineId: string, point: Point2D) => void;
  moveLineWaypoint: (lineId: string, index: number, point: Point2D) => void;
  removeLineWaypoint: (lineId: string, index: number) => void;
  clearLineWaypoints: (lineId: string) => void;

  resetProject: () => void;
  loadProject: (snapshot: ProjectSnapshot) => void;
}

function lineRouteInput(state: ProjectState): LineRouteInput {
  return {
    panel: state.panel,
    devices: state.devices,
    rooms: state.rooms,
    partitions: state.freePartitions,
    nodes: state.nodes,
    walls: state.walls,
    settings: state.settings,
  };
}

function withLineManualRoute(
  panel: ElectricalPanel,
  lineId: string,
  manualRoute: ManualRoute | undefined
): ElectricalPanel {
  return {
    ...panel,
    lines: panel.lines.map((line) =>
      line.id === lineId ? { ...line, manualRoute, waypoints: undefined } : line
    ),
  };
}

function sameAnchor(a: DeviceAnchor | FrameAnchor, b: DeviceAnchor | FrameAnchor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'room_point' && b.kind === 'room_point') {
    return a.roomId === b.roomId && a.x === b.x && a.y === b.y;
  }
  if (a.kind === 'room_edge' && b.kind === 'room_edge') {
    return (
      a.roomId === b.roomId &&
      a.edgeIndex === b.edgeIndex &&
      a.offsetMm === b.offsetMm
    );
  }
  if (a.kind === 'partition' && b.kind === 'partition') {
    return (
      a.partitionId === b.partitionId &&
      a.offsetMm === b.offsetMm &&
      a.side === b.side
    );
  }
  return false;
}

/** Переподключает ручные трассы линий к переехавшим приборам. */
function reconnectManualRoutes(
  panel: ElectricalPanel | null,
  moves: ManualRouteAnchorMove[]
): { panel: ElectricalPanel | null; failed: string[] } {
  if (!panel || moves.length === 0) return { panel, failed: [] };
  const failed: string[] = [];
  let changed = false;
  const lines = panel.lines.map((line) => {
    const route = line.manualRoute;
    if (!route) return line;
    const applicable = moves.filter(
      (move) =>
        move.kind === 'device' &&
        route.anchors.some(
          (anchor) => anchor.kind === 'device' && anchor.deviceId === move.deviceId
        )
    );
    if (applicable.length === 0) return line;
    const result = moveManualRouteAnchors(route, applicable);
    if (!result.ok) {
      failed.push(line.name);
      return line;
    }
    changed = true;
    return { ...line, manualRoute: result.route, waypoints: undefined };
  });
  return {
    panel: changed ? { ...panel, lines } : panel,
    failed,
  };
}

const DEFAULT_SETTINGS: ProjectSettings = {
  defaultWallThicknessMm: 120,    // Межкомнатные стены 120 мм
  exteriorWallThicknessMm: 250,   // Наружные стены 250 мм
  ceilingHeightMm: 2700,
  floorLevelMm: 0,
  cableMarginPercent: 15,
  defaultRouting: 'ceiling',
  showDimensions: true,
};

const DEFAULT_DYNAMIC_INPUT: DynamicInputState = {
  isOpen: false,
  step: 'none',
  lockedLength: null,
  lockedAngle: null,
  currentLengthInput: '',
  currentAngleInput: '',
};

const DEFAULT_SNAP: SnapResult = {
  point: { x: 0, y: 0 },
  isSnapped: false,
  snapType: 'none',
  guideLines: [],
};

// Состав мест нового блока: по умолчанию одно пустое место (заглушка).
function seatTypesForPosts(posts: FramePosts): (DeviceType | null)[] {
  return Array.from({ length: posts }, () => null);
}

const DEFAULT_FRAME_HEIGHT_MM = 300;

const DEFAULT_FRAME_BLOCK = {
  activeFramePosts: 1 as FramePosts,
  activeFrameMounting: 'flush' as FrameMounting,
  activeFrameSeatTypes: seatTypesForPosts(1),
  activeFrameHeightMm: DEFAULT_FRAME_HEIGHT_MM,
};

const ROOM_TYPE_NAMES: Record<RoomType, string> = {
  living: 'Гостиная',
  bedroom: 'Спальня',
  kitchen: 'Кухня',
  bathroom: 'Ванная',
  toilet: 'Санузел',
  corridor: 'Коридор',
  balcony: 'Балкон',
  storage: 'Гардеробная',
  custom: 'Помещение',
};

const VIBRANT_ROOM_COLORS = [
  '#3b82f6',
  '#a855f7',
  '#f97316',
  '#06b6d4',
  '#10b981',
  '#ec4899',
  '#eab308',
  '#84cc16',
  '#6366f1',
  '#14b8a6',
];

interface AutoProjectState {
  rooms: RoomZone[];
  freePartitions: FreePartition[];
  openings: Opening[];
  apartment: ApartmentBoundary | null;
  nodes: Record<string, Node2D>;
  walls: Wall[];
}

function computeAutoProjectState(
  rooms: RoomZone[],
  freePartitions: FreePartition[],
  openings: Opening[],
  thickness: number
): { state: AutoProjectState; removedOpenings: number; layout: AutoLayout } {
  const layout = buildAutoLayout(rooms, freePartitions, openings, thickness);
  return {
    state: {
      rooms,
      freePartitions,
      openings: layout.openings,
      apartment: layout.apartment,
      nodes: layout.nodes,
      walls: layout.walls,
    },
    removedOpenings: openings.length - layout.openings.length,
    layout,
  };
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => ({
      nodes: {},
      walls: [],
      openings: [],
      freePartitions: [],
      devices: [],
      frames: [],
      panel: null,
      apartment: null,
      rooms: [],
      selection: null,

      activeStep: 'plan',
      panelStep: 'devices',
      highlightedLineId: null,
      lineAssignLineId: null,
      lineAssignStartPanel: null,
      routeEditLineId: null,

      settings: DEFAULT_SETTINGS,

      designMode: 'architecture',
      activeDeviceType: 'socket_single',
      deviceShared: false,
      ...DEFAULT_FRAME_BLOCK,

      activeTool: 'select',
      activeRoomType: 'living',
      zoom: 0.12,
      stagePos: { x: 120, y: 120 },
      gridSnap: true,
      gridStepMm: 100,

      draftVertices: [],
      cursorPosMm: { x: 0, y: 0 },
      dynamicInput: DEFAULT_DYNAMIC_INPUT,
      activeSnap: DEFAULT_SNAP,

      // UX Workflow
      boundaryMode: 'auto',
      drawingStage: 'rooms',
      boundaryLocked: false,
      activeOpeningType: 'door',
      toasts: [],
      isCoverageValid: true,
      coveragePercent: 0,

      setSettings: (updates) => {
        const state = get();
        const nextSettings = { ...state.settings, ...updates };
        if (![nextSettings.defaultWallThicknessMm, nextSettings.exteriorWallThicknessMm, nextSettings.ceilingHeightMm]
          .every((value) => Number.isFinite(value) && value > 0)
          || !Number.isFinite(nextSettings.floorLevelMm)
          || !Number.isFinite(nextSettings.cableMarginPercent) || nextSettings.cableMarginPercent < 0) {
          state.addToast('Размеры должны быть положительными числами, запас кабеля — неотрицательным.', 'error');
          return;
        }
        const geometryLocked =
          state.boundaryMode === 'auto' &&
          state.rooms.length > 0 &&
          updates.defaultWallThicknessMm !== undefined &&
          updates.defaultWallThicknessMm !== state.settings.defaultWallThicknessMm;

        if (geometryLocked) {
          state.addToast(
            'Толщина стен задаётся один раз до первой комнаты. Сейчас она зафиксирована.',
            'error'
          );
          set({
            settings: {
              ...state.settings,
              ...updates,
              defaultWallThicknessMm: state.settings.defaultWallThicknessMm,
            },
          });
          return;
        }

        set({ settings: { ...state.settings, ...updates } });
      },

      setActiveTool: (tool) => {
        // Режим холста следует за инструментом: планировка — проёмы и стены,
        // электрика — приборы и щиток. «Выбор» и «Рука» не меняют режим.
        const toolMode =
          tool === 'place_device' || tool === 'place_frame' || tool === 'place_panel'
            ? ('electrical' as const)
            : tool === 'draw_room' ||
                tool === 'draw_apartment' ||
                tool === 'draw_opening' ||
                tool === 'draw_partition'
              ? ('architecture' as const)
              : null;
        set((state) => ({
          activeTool: tool,
          designMode: toolMode ?? state.designMode,
          lineAssignLineId: null,
          routeEditLineId: null,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        }));
      },

      setDrawingStage: (stage) => {
        if (get().boundaryMode === 'auto') {
          set({ drawingStage: 'rooms', boundaryLocked: false });
          return;
        }
        set(stage === 'boundary' ? { drawingStage: stage, boundaryLocked: false } : { drawingStage: stage });
      },
      setActiveOpeningType: (type) => set({ activeOpeningType: type }),
      lockBoundary: () => {
        set({ boundaryLocked: true, drawingStage: 'rooms', activeTool: 'select' });
        get().checkCoverage();
      },

      addToast: (message, type = 'info') => {
        const id = `toast-${crypto.randomUUID()}`;
        set((state) => ({
          toasts: [...state.toasts, { id, message, type }],
        }));
        setTimeout(() => get().removeToast(id), 5000);
      },

      removeToast: (id) =>
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        })),

      setActiveRoomType: (type) => set({ activeRoomType: type }),

      setZoom: (zoomOrFn) =>
        set((state) => ({
          zoom: typeof zoomOrFn === 'function' ? zoomOrFn(state.zoom) : zoomOrFn,
        })),

      setStagePos: (posOrFn) =>
        set((state) => ({
          stagePos: typeof posOrFn === 'function' ? posOrFn(state.stagePos) : posOrFn,
        })),

      setCursorPosMm: (pos) => set({ cursorPosMm: pos }),
      setGridSnap: (enabled) => set({ gridSnap: enabled }),
      setSelection: (selection) => set({ selection }),
      setActiveSnap: (snap) => set({ activeSnap: snap }),

      setActiveDeviceType: (type) =>
        set((state) => ({
          activeDeviceType: type,
          deviceShared:
            DEVICE_CATALOG[type].mounting === 'wall' ? state.deviceShared : false,
          designMode: 'electrical',
          lineAssignLineId: null,
          routeEditLineId: null,
          activeTool: 'place_device',
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        })),

      setDeviceShared: (shared) => set({ deviceShared: shared }),

      toggleDimensions: () =>
        set((state) => ({
          settings: { ...state.settings, showDimensions: !state.settings.showDimensions },
        })),

      checkCoverage: () => {
        const state = get();
        if (state.boundaryMode === 'auto') {
          set({
            coveragePercent: state.rooms.length > 0 ? 100 : 0,
            isCoverageValid: true,
          });
          return;
        }
        if (!state.apartment) {
          set({ coveragePercent: 0, isCoverageValid: true });
          return;
        }

        const apartmentArea = calculateNetAreaM2(
          state.apartment.vertices,
          state.apartment.holes ?? []
        );
        const coveredArea = calculateCoveredAreaM2(
          state.apartment,
          state.rooms,
          state.openings,
          state.freePartitions,
          state.settings.defaultWallThicknessMm,
          state.settings.exteriorWallThicknessMm
        );
        const coverage = apartmentArea > 0 ? (coveredArea / apartmentArea) * 100 : 0;

        set({
          coveragePercent: Math.max(0, Math.min(100, coverage)),
          isCoverageValid: coverage >= 99.5,
        });
      },

      startApartmentDrawing: () =>
        set({
          activeTool: 'draw_apartment',
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
        }),

      startRoomDrawing: (type) =>
        set((state) => ({
          activeTool: 'draw_room',
          activeRoomType: type || state.activeRoomType,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
        })),

      addDraftVertex: (vertex) =>
        set((state) => ({
          draftVertices: [...state.draftVertices, vertex],
          dynamicInput: {
            ...DEFAULT_DYNAMIC_INPUT,
            isOpen: false,
          },
        })),

      popDraftVertex: () =>
        set((state) => ({
          draftVertices: state.draftVertices.slice(0, -1),
        })),

      finishDraft: () => {
        const state = get();
        const isLinearTool =
          state.activeTool === 'draw_opening' || state.activeTool === 'draw_partition';
        const minPoints = isLinearTool ? 2 : 3;
        if (state.draftVertices.length < minPoints) {
          set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
          return;
        }

        // 1. Создание контура квартиры (Этап 1)
        if (state.activeTool === 'draw_apartment') {
          if (state.boundaryMode === 'auto') {
            state.addToast(
              'В авто-режиме контур квартиры строится автоматически по комнатам.',
              'error'
            );
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }
          if (state.boundaryLocked) {
            state.addToast('Контур квартиры заблокирован! Перейдите к разметке комнат.', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          let newVertices: Point2D[] = state.draftVertices;
          let newHoles: Point2D[][] = state.apartment?.holes ?? [];

          if (state.apartment) {
            const res = unionApartmentBoundary(
              state.apartment.vertices,
              newHoles,
              state.draftVertices
            );
            if (!res.success) {
              state.addToast(res.error || 'Ошибка объединения', 'error');
              set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
              return;
            }
            newVertices = res.vertices;
            newHoles = res.holes;
          }

          const rawApt: ApartmentBoundary = {
            id: state.apartment?.id || makeEntityId('apartment'),
            name: 'Контур квартиры',
            nodeIds: [],
            vertices: newVertices,
            holes: newHoles,
            exteriorWallThicknessMm: state.settings.exteriorWallThicknessMm,
          };

          const graph = extractGraphFromPlan(
            rawApt,
            state.rooms,
            state.settings.defaultWallThicknessMm,
            state.settings.exteriorWallThicknessMm
          );

          set({
            apartment: graph.updatedApartment,
            rooms: graph.updatedRooms,
            nodes: graph.nodes,
            walls: graph.walls,
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeTool: 'select',
          });
          get().checkCoverage();
          return;
        }

        // 2. Создание комнаты внутри квартиры (Этап 2)
        if (state.activeTool === 'draw_room') {
          if (state.boundaryMode === 'auto') {
            const validation = validateNewRoom(
              state.rooms,
              state.settings.defaultWallThicknessMm,
              state.draftVertices
            );
            if (!validation.ok) {
              state.addToast(validation.error || 'Не удалось добавить комнату.', 'error');
              set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
              return;
            }

            const roomIndex = state.rooms.length;
            const newRoom: RoomZone = {
              id: makeEntityId('room'),
              name: `${ROOM_TYPE_NAMES[state.activeRoomType]} ${roomIndex + 1}`,
              type: state.activeRoomType,
              color: VIBRANT_ROOM_COLORS[roomIndex % VIBRANT_ROOM_COLORS.length],
              wallThicknessMm: state.settings.defaultWallThicknessMm,
              nodeIds: [],
              vertices: state.draftVertices.map((point) => ({ ...point })),
              holes: [],
            };

            const next = computeAutoProjectState(
              [...state.rooms, newRoom],
              state.freePartitions,
              state.openings,
              state.settings.defaultWallThicknessMm
            );

            set({
              ...next.state,
              draftVertices: [],
              dynamicInput: DEFAULT_DYNAMIC_INPUT,
              activeTool: 'select',
              selection: { kind: 'room', id: newRoom.id },
              drawingStage: 'rooms',
              boundaryLocked: false,
            });
            if (next.removedOpenings > 0) {
              state.addToast(
                'Часть проёмов потеряла стену после перестроения и была удалена.',
                'info'
              );
            }
            get().checkCoverage();
            return;
          }

          if (!state.boundaryLocked) {
            state.addToast('Сначала завершите контур квартиры!', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          let roomPolys: { vertices: Point2D[]; holes: Point2D[][] }[] = [
            { vertices: state.draftVertices, holes: [] },
          ];
          if (state.apartment && state.apartment.vertices.length >= 3) {
            roomPolys = clipRoomToApartment(
              state.draftVertices,
              state.apartment.vertices,
              state.apartment.holes ?? []
            );
          }

          if (roomPolys.length === 0 || roomPolys[0].vertices.length < 3) {
            state.addToast('Комната должна находиться внутри контура квартиры!', 'error');
            return;
          }

          if (roomPolys.length > 1) {
            state.addToast(
              'Комната разорвана вырезом квартиры. Нарисуйте её единым контуром.',
              'error'
            );
            return;
          }

          const targetPoly = roomPolys[0].vertices;
          const targetHoles = roomPolys[0].holes;

          // Комнаты не должны пересекаться: пользователь исправляет контур сам
          const hasOverlap = state.rooms.some(
            (room) =>
              calculateRoomsOverlapAreaM2(
                room.vertices,
                room.holes ?? [],
                targetPoly,
                targetHoles
              ) > ROOM_OVERLAP_TOLERANCE_M2
          );

          if (hasOverlap) {
            state.addToast(
              'Комнаты пересекаются. Измените контур комнаты — наложение не допускается.',
              'error'
            );
            return;
          }

          const updatedOldRooms = state.rooms;

          const roomIndex = updatedOldRooms.length;
          const assignedColor = VIBRANT_ROOM_COLORS[roomIndex % VIBRANT_ROOM_COLORS.length];

          const newRoom: RoomZone = {
            id: makeEntityId('room'),
            name: `${ROOM_TYPE_NAMES[state.activeRoomType]} ${updatedOldRooms.length + 1}`,
            type: state.activeRoomType,
            color: assignedColor,
            wallThicknessMm: state.settings.defaultWallThicknessMm,
            nodeIds: [],
            vertices: targetPoly,
            holes: targetHoles,
          };

          const candidateRooms = [...updatedOldRooms, newRoom];

          // Синхронизация с графом стен и узлов (объединение смежных стен в одну общую!)
          const graph = extractGraphFromPlan(
            state.apartment,
            candidateRooms,
            state.settings.defaultWallThicknessMm,
            state.settings.exteriorWallThicknessMm
          );

          set({
            apartment: graph.updatedApartment,
            rooms: graph.updatedRooms,
            nodes: graph.nodes,
            walls: graph.walls,
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeTool: 'select',
            selection: { kind: 'room', id: newRoom.id },
          });
          get().checkCoverage();
          return;
        }

        // 3. Создание проема (Дверь/Окно)
        if (state.activeTool === 'draw_opening') {
          if (state.draftVertices.length < 2) return;
          const rawP1 = state.draftVertices[0];
          const rawP2 = state.draftVertices[state.draftVertices.length - 1];

          // Ищем ближайшую стену или перегородку по первой точке
          const candidates = [
            ...state.walls.flatMap((wall) => {
              const nodeA = state.nodes[wall.nodeAId];
              const nodeB = state.nodes[wall.nodeBId];
              return nodeA && nodeB
                ? [{
                    id: wall.id,
                    a: { x: nodeA.x, y: nodeA.y },
                    b: { x: nodeB.x, y: nodeB.y },
                    thicknessMm: wall.thicknessMm,
                  }]
                : [];
            }),
            ...state.freePartitions.map((partition) => ({
              id: partition.id,
              a: partition.p1,
              b: partition.p2,
              thicknessMm: partition.thicknessMm,
            })),
          ];

          let bestCandidate: (typeof candidates)[number] | null = null;
          let minDist = Infinity;

          for (const candidate of candidates) {
            const d = pointToSegmentDistance(rawP1, candidate.a, candidate.b);
            if (d < minDist && d < 300) {
              minDist = d;
              bestCandidate = candidate;
            }
          }

          if (!bestCandidate) {
            state.addToast('Проем должен располагаться на стене или перегородке!', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const proj1 = projectPointOnSegment(rawP1, bestCandidate.a, bestCandidate.b);
          const proj2 = projectPointOnSegment(rawP2, bestCandidate.a, bestCandidate.b);

          if (proj2.distance > 300) {
            state.addToast('Вторая точка проема должна лежать на той же стене.', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const segDx = bestCandidate.b.x - bestCandidate.a.x;
          const segDy = bestCandidate.b.y - bestCandidate.a.y;
          const segLenSq = segDx * segDx + segDy * segDy;
          const rawT1 = segLenSq > 0
            ? ((rawP1.x - bestCandidate.a.x) * segDx + (rawP1.y - bestCandidate.a.y) * segDy) / segLenSq
            : 0;
          const rawT2 = segLenSq > 0
            ? ((rawP2.x - bestCandidate.a.x) * segDx + (rawP2.y - bestCandidate.a.y) * segDy) / segLenSq
            : 0;

          if (rawT1 < -0.02 || rawT1 > 1.02 || rawT2 < -0.02 || rawT2 > 1.02) {
            state.addToast('Проем выходит за пределы стены или перегородки.', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const widthMm = distance(proj1.point, proj2.point);
          if (widthMm < 200) {
            state.addToast('Проем слишком узкий: минимум 200 мм.', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const p1 = proj1.t <= proj2.t ? proj1.point : proj2.point;
          const p2 = proj1.t <= proj2.t ? proj2.point : proj1.point;
          const isWindow = state.activeOpeningType === 'window';

          const host = bestCandidate;
          const newTmin = Math.min(proj1.t, proj2.t);
          const newTmax = Math.max(proj1.t, proj2.t);
          const overlapsExisting = state.openings.some((opening) => {
            if (opening.wallId !== host.id) return false;
            const ta = projectPointOnSegment(opening.p1, host.a, host.b).t;
            const tb = projectPointOnSegment(opening.p2, host.a, host.b).t;
            const lo = Math.min(ta, tb);
            const hi = Math.max(ta, tb);
            return newTmin < hi - 1e-6 && lo < newTmax - 1e-6;
          });
          if (overlapsExisting) {
            state.addToast('Проем пересекается с существующим проемом на этой стене.', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const newOpening: Opening = {
            id: makeEntityId('opening'),
            type: state.activeOpeningType,
            wallId: bestCandidate.id,
            p1,
            p2,
            widthMm,
            heightMm: isWindow ? 1500 : 2100,
            elevationMm: isWindow ? 900 : 0,
            wallThicknessMm: bestCandidate.thicknessMm,
          };

          set({
            openings: [...state.openings, newOpening],
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeTool: 'select',
            selection: { kind: 'opening', id: newOpening.id },
          });
          state.addToast(isWindow ? 'Окно добавлено.' : 'Дверь добавлена.', 'success');
          return;
        }

        // 5. Создание перегородки
        if (state.activeTool === 'draw_partition') {
          if (state.draftVertices.length < 2) return;
          const p1 = state.draftVertices[0];
          const p2 = state.draftVertices[state.draftVertices.length - 1];

          if (state.boundaryMode === 'auto') {
            const validation = validatePartitionPlacement(
              state.rooms,
              state.freePartitions,
              state.settings.defaultWallThicknessMm,
              p1,
              p2
            );
            if (!validation.ok || !validation.roomId) {
              state.addToast(validation.error || 'Не удалось добавить перегородку.', 'error');
              set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
              return;
            }

            const newPartition: FreePartition = {
              id: makeEntityId('partition'),
              p1,
              p2,
              thicknessMm: state.settings.defaultWallThicknessMm,
              roomId: validation.roomId,
            };

            const next = computeAutoProjectState(
              state.rooms,
              [...state.freePartitions, newPartition],
              state.openings,
              state.settings.defaultWallThicknessMm
            );

            set({
              ...next.state,
              draftVertices: [],
              dynamicInput: DEFAULT_DYNAMIC_INPUT,
              activeTool: 'select',
              selection: { kind: 'partition', id: newPartition.id },
            });
            state.addToast('Перегородка добавлена, комната осталась целой.', 'success');
            get().checkCoverage();
            return;
          }

          if (distance(p1, p2) < 50) {
            state.addToast('Перегородка слишком короткая.', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          // Находим комнату, в которой находится середина перегородки
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const room = state.rooms.find(
            (r) =>
              isPointInPolygon(mid, r.vertices) &&
              !(r.holes ?? []).some((hole) => isPointInPolygon(mid, hole))
          );

          if (!room) {
            state.addToast('Перегородка должна находиться внутри комнаты!', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const insideRoom = (pt: Point2D) =>
            isPointInPolygon(pt, room.vertices) &&
            !(room.holes ?? []).some((hole) => isPointInPolygon(pt, hole));
          if (!insideRoom(p1) || !insideRoom(p2)) {
            state.addToast('Перегородка должна целиком находиться внутри одной комнаты!', 'error');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const newPartition: FreePartition = {
            id: makeEntityId('partition'),
            p1,
            p2,
            thicknessMm: state.settings.defaultWallThicknessMm,
            roomId: room.id,
          };

          // Перегородка от стены до стены делит комнату на две зоны:
          // каждая сторона становится стеной своей комнаты.
          const parts = splitRoomByPartition(room, p1, p2);

          if (parts) {
            const splitRooms: RoomZone[] = [
              ...state.rooms.map((r) =>
                r.id === room.id
                  ? { ...r, nodeIds: [], vertices: parts[0].vertices, holes: parts[0].holes }
                  : r
              ),
              {
                ...room,
                id: makeEntityId('room'),
                name: `${room.name} (часть 2)`,
                nodeIds: [],
                vertices: parts[1].vertices,
                holes: parts[1].holes,
              },
            ];

            const graph = extractGraphFromPlan(
              state.apartment,
              splitRooms,
              state.settings.defaultWallThicknessMm,
              state.settings.exteriorWallThicknessMm
            );

            set({
              rooms: graph.updatedRooms,
              nodes: graph.nodes,
              walls: graph.walls,
              freePartitions: [...state.freePartitions, newPartition],
              draftVertices: [],
              dynamicInput: DEFAULT_DYNAMIC_INPUT,
              activeTool: 'select',
              selection: { kind: 'partition', id: newPartition.id },
            });
            state.addToast('Комната разделена перегородкой на две части.', 'success');
            get().checkCoverage();
            return;
          }

          // Перегородка не доходит до стен — оставляем её простенком
          set({
            freePartitions: [...state.freePartitions, newPartition],
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeTool: 'select',
            selection: { kind: 'partition', id: newPartition.id },
          });
          state.addToast('Перегородка добавлена как простенок (комната не разделена).', 'info');
          return;
        }
      },

      cancelDraft: () =>
        set({
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        }),

      openDynamicInput: (step) =>
        set((state) => ({
          dynamicInput: {
            ...state.dynamicInput,
            isOpen: true,
            step,
          },
        })),

      closeDynamicInput: () =>
        set((state) => ({
          dynamicInput: {
            ...state.dynamicInput,
            isOpen: false,
            step: 'none',
          },
        })),

      setLockedLength: (len) =>
        set((state) => ({
          dynamicInput: { ...state.dynamicInput, lockedLength: len },
        })),

      setLockedAngle: (deg) =>
        set((state) => ({
          dynamicInput: { ...state.dynamicInput, lockedAngle: deg },
        })),

      setDynamicInputValues: (values) =>
        set((state) => ({
          dynamicInput: { ...state.dynamicInput, ...values },
        })),

      setApartment: (apt) => {
        if (get().boundaryMode === 'auto') {
          get().addToast('В авто-режиме контур квартиры пересчитывается по комнатам.', 'info');
          return;
        }
        if (!apt) {
          get().deleteApartment();
          return;
        }
        const state = get();
        const graph = extractGraphFromPlan(
          apt,
          state.rooms,
          state.settings.defaultWallThicknessMm,
          state.settings.exteriorWallThicknessMm
        );
        set({
          apartment: graph.updatedApartment,
          rooms: graph.updatedRooms,
          nodes: graph.nodes,
          walls: graph.walls,
          drawingStage: 'rooms',
          boundaryLocked: true,
        });
      },

      deleteApartment: () => {
        const isAuto = get().boundaryMode === 'auto';
        set({
          nodes: {},
          walls: [],
          openings: [],
          freePartitions: [],
          devices: [],
          panel: null,
          apartment: null,
          rooms: [],
          selection: null,
          activeStep: 'plan',
          highlightedLineId: null,
          lineAssignLineId: null,
          routeEditLineId: null,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
          activeTool: 'select',
          drawingStage: isAuto ? 'rooms' : 'boundary',
          boundaryLocked: false,
          coveragePercent: 0,
          isCoverageValid: true,
        });
        useProjectStore.temporal.getState().clear();
      },

      updateRoom: (id, updates) => {
        const state = get();
        const nextRooms = state.rooms.map((room) =>
          room.id === id ? { ...room, ...updates } : room
        );

        if (
          state.boundaryMode === 'auto' &&
          (updates.vertices !== undefined || updates.holes !== undefined)
        ) {
          const next = computeAutoProjectState(
            nextRooms,
            state.freePartitions,
            state.openings,
            state.settings.defaultWallThicknessMm
          );
          set(next.state);
          return;
        }

        set({ rooms: nextRooms });
      },

      deleteRoom: (id) => {
        const state = get();
        const room = state.rooms.find((candidate) => candidate.id === id);
        if (!room) return;

        const thickness = state.settings.defaultWallThicknessMm;
        const elements = collectRoomElements(
          id,
          state.rooms,
          state.walls,
          state.freePartitions,
          state.openings,
          state.devices,
          thickness
        );
        const doomedOpeningIds = new Set(
          [...elements.doors, ...elements.windows].map((opening) => opening.id)
        );
        const doomedDeviceIds = new Set(
          elements.devices.map((resolved) => resolved.device.id)
        );
        const remainingPartitions = state.freePartitions.filter(
          (partition) => partition.roomId !== id
        );
        const remainingOpenings = state.openings.filter(
          (opening) => !doomedOpeningIds.has(opening.id)
        );
        const baseRemainingDevices = state.devices.filter(
          (device) => !doomedDeviceIds.has(device.id)
        );
        // Рамки на стенах удаляемой комнаты и на её перегородках уходят вместе с механизмами.
        const cascade = framesAfterHostRemoval(
          state.frames,
          baseRemainingDevices,
          (frame) => {
            const anchor = frame.anchor;
            return anchor.kind === 'partition'
              ? remainingPartitions.some((partition) => partition.id === anchor.partitionId)
              : anchor.roomId !== id;
          }
        );
        const remainingDevices = cascade.devices;
        const remainingFrames = cascade.frames;
        const remainingDeviceIds = new Set(remainingDevices.map((device) => device.id));
        const remainingFrameIds = new Set(remainingFrames.map((frame) => frame.id));
        const selection = state.selection;
        const selectionRemoved =
          selection !== null &&
          ((selection.kind === 'room' && selection.id === id) ||
            (selection.kind === 'opening' && doomedOpeningIds.has(selection.id)) ||
            (selection.kind === 'partition' &&
              elements.partitions.some((partition) => partition.id === selection.id)) ||
            (selection.kind === 'device' && !remainingDeviceIds.has(selection.id)) ||
            (selection.kind === 'frame' && !remainingFrameIds.has(selection.id)));

        if (state.boundaryMode === 'auto') {
          const remainingRooms = state.rooms.filter((candidate) => candidate.id !== id);

          if (
            !isAutoLayoutConnected(remainingRooms, thickness)
          ) {
            state.addToast(
              'Удаление разорвёт квартиру на отдельные части. Сначала соедините комнаты.',
              'error'
            );
            return;
          }

          if (remainingRooms.length === 0) {
            set({
              rooms: [],
              freePartitions: [],
              openings: [],
              devices: [],
              frames: [],
              panel: null,
              apartment: null,
              nodes: {},
              walls: [],
              selection: null,
              activeStep: 'plan',
              highlightedLineId: null,
              lineAssignLineId: null,
              routeEditLineId: null,
            });
            get().checkCoverage();
            return;
          }

          const next = computeAutoProjectState(
            remainingRooms,
            remainingPartitions,
            remainingOpenings,
            thickness
          );

          const nextPanel = prunePanelRefs(
            sanitizePanel(state.panel, remainingRooms, remainingPartitions, thickness),
            remainingDevices,
            remainingRooms.map((candidate) => candidate.id)
          );

          set({
            ...next.state,
            devices: remainingDevices,
            frames: remainingFrames,
            panel: nextPanel,
            activeStep: nextPanel ? state.activeStep : 'plan',
            highlightedLineId: keepLineHighlight(nextPanel, state.highlightedLineId),
            selection: selectionRemoved || (state.panel && !nextPanel) ? null : selection,
          });
          if (next.removedOpenings > 0) {
            state.addToast(
              'Проёмы, потерявшие стену, удалены вместе с комнатой.',
              'info'
            );
          }
          get().checkCoverage();
          return;
        }

        const graph = extractGraphFromPlan(
          state.apartment,
          state.rooms.filter((r) => r.id !== id),
          thickness,
          state.settings.exteriorWallThicknessMm
        );
        const nextPanel = prunePanelRefs(
          sanitizePanel(
            state.panel,
            graph.updatedRooms,
            remainingPartitions,
            thickness
          ),
          remainingDevices,
          graph.updatedRooms.map((candidate) => candidate.id)
        );
        set({
          apartment: graph.updatedApartment,
          rooms: graph.updatedRooms,
          nodes: graph.nodes,
          walls: graph.walls,
          freePartitions: remainingPartitions,
          openings: remainingOpenings,
          devices: remainingDevices,
          frames: remainingFrames,
          panel: nextPanel,
          activeStep: nextPanel ? state.activeStep : 'plan',
          highlightedLineId: keepLineHighlight(nextPanel, state.highlightedLineId),
          selection: selectionRemoved || (state.panel && !nextPanel) ? null : selection,
        });
        get().checkCoverage();
      },

      deleteOpening: (id) => {
        const state = get();
        const opening = state.openings.find((candidate) => candidate.id === id);
        if (!opening) return;
        set({
          openings: state.openings.filter((candidate) => candidate.id !== id),
          selection:
            state.selection?.kind === 'opening' && state.selection.id === id
              ? null
              : state.selection,
        });
        state.addToast(
          opening.type === 'door' ? 'Дверь удалена.' : 'Окно удалено.',
          'success'
        );
      },

      deletePartition: (id) => {
        const state = get();
        const partition = state.freePartitions.find((candidate) => candidate.id === id);
        if (!partition) return;

        const thickness = state.settings.defaultWallThicknessMm;
        const remainingPartitions = state.freePartitions.filter(
          (candidate) => candidate.id !== id
        );
        const doomedDeviceIds = new Set(
          state.devices
            .filter(
              (device) =>
                device.anchor.kind === 'partition' && device.anchor.partitionId === id
            )
            .map((device) => device.id)
        );
        const remainingDevices = state.devices.filter(
          (device) => !doomedDeviceIds.has(device.id)
        );
        const cascade = framesAfterHostRemoval(
          state.frames,
          remainingDevices,
          (frame) =>
            frame.anchor.kind !== 'partition' || frame.anchor.partitionId !== id
        );
        const frames = cascade.frames;
        const devices = cascade.devices;
        const remainingDeviceIds = new Set(devices.map((device) => device.id));
        const remainingFrameIds = new Set(frames.map((frame) => frame.id));
        const selection = state.selection;
        const selectionRemoved =
          selection !== null &&
          ((selection.kind === 'partition' && selection.id === id) ||
            (selection.kind === 'device' && !remainingDeviceIds.has(selection.id)) ||
            (selection.kind === 'frame' && !remainingFrameIds.has(selection.id)));

        if (state.boundaryMode === 'auto') {
          const next = computeAutoProjectState(
            state.rooms,
            remainingPartitions,
            state.openings,
            thickness
          );
          const nextPanel = prunePanelRefs(
            sanitizePanel(state.panel, state.rooms, remainingPartitions, thickness),
            devices,
            state.rooms.map((room) => room.id)
          );
          set({
            ...next.state,
            devices,
            frames,
            panel: nextPanel,
            activeStep: nextPanel ? state.activeStep : 'plan',
            highlightedLineId: keepLineHighlight(nextPanel, state.highlightedLineId),
            selection: selectionRemoved || (state.panel && !nextPanel) ? null : selection,
          });
          if (next.removedOpenings > 0) {
            state.addToast('Проёмы на удалённой перегородке тоже удалены.', 'info');
          }
        } else {
          const nextPanel = prunePanelRefs(
            sanitizePanel(state.panel, state.rooms, remainingPartitions, thickness),
            devices,
            state.rooms.map((room) => room.id)
          );
          set({
            freePartitions: remainingPartitions,
            devices,
            frames,
            panel: nextPanel,
            activeStep: nextPanel ? state.activeStep : 'plan',
            highlightedLineId: keepLineHighlight(nextPanel, state.highlightedLineId),
            selection: selectionRemoved || (state.panel && !nextPanel) ? null : selection,
          });
        }
        state.addToast('Перегородка удалена.', 'success');
        get().checkCoverage();
      },

      addDevice: (type, anchor, shared) => {
        const state = get();
        const catalog = DEVICE_CATALOG[type];
        const thickness = state.settings.defaultWallThicknessMm;
        const sameTypeCount = state.devices.filter((device) => device.type === type).length;

        const candidate: ElectricalDevice = {
          id: makeEntityId('device'),
          type,
          name: `${catalog.label} ${sameTypeCount + 1}`,
          anchor,
          heightFromFloorMm: catalog.defaultHeightMm,
          powerWatts: catalog.defaultPowerWatts,
          shared,
        };

        const resolved = resolveDevice(
          candidate,
          state.rooms,
          state.freePartitions,
          thickness
        );
        if (!resolved) {
          state.addToast(
            'Не удалось привязать прибор к комнате. Проверьте план.',
            'error'
          );
          return;
        }

        // Механизмы не существуют вне рамки: одиночный прибор получает рамку на 1 место.
        if (isMechanismType(type) && anchor.kind !== 'room_point') {
          const frame: MountingFrame = {
            id: makeEntityId('frame'),
            anchor,
            heightFromFloorMm: catalog.defaultHeightMm,
            posts: 1,
            mounting: 'flush',
          };
          set({
            frames: [...state.frames, frame],
            devices: [
              ...state.devices,
              {
                ...candidate,
                shared: resolved.isShared,
                frameId: frame.id,
                seatIndex: 0,
              },
            ],
          });
          return;
        }

        set({
          devices: [
            ...state.devices,
            { ...candidate, shared: resolved.isShared },
          ],
        });
      },

      setDeviceNote: (id, note) => {
        const state = get();
        const text = normalizeDeviceNote(note);
        const current = state.devices.find((device) => device.id === id);
        if (!current || current.note === text) return;
        set({
          devices: state.devices.map((device) => {
            if (device.id !== id) return device;
            const next = { ...device };
            if (text) next.note = text;
            else delete next.note;
            return next;
          }),
        });
      },

      deleteDevice: (id) => {
        const state = get();
        if (!state.devices.some((device) => device.id === id)) return;
        const devices = state.devices.filter((device) => device.id !== id);
        const panel = prunePanelRefs(
          state.panel,
          devices,
          state.rooms.map((room) => room.id)
        );
        set({
          devices,
          panel,
          selection:
            state.selection?.kind === 'device' && state.selection.id === id
              ? null
              : state.selection,
        });
        state.addToast('Прибор удалён.', 'success');
      },

      moveDevice: (id, anchor) => {
        const state = get();
        const current = state.devices.find((device) => device.id === id);
        if (!current) return false;
        if (current.frameId) {
          state.addToast(
            'Механизм перемещается только вместе с подрозетником. Потяните сам подрозетник.',
            'info'
          );
          return false;
        }
        if (sameAnchor(current.anchor, anchor)) return true;
        const candidate: ElectricalDevice = { ...current, anchor };
        const resolved = resolveDevice(
          candidate,
          state.rooms,
          state.freePartitions,
          state.settings.defaultWallThicknessMm
        );
        const point = resolved?.poses[0]?.position;
        if (!resolved || !point) {
          state.addToast(
            'Прибор не помещается в этом месте. Выберите точку на стене или в комнате.',
            'error'
          );
          return false;
        }
        const device: ElectricalDevice = { ...candidate, shared: resolved.isShared };
        const { panel, failed } = reconnectManualRoutes(state.panel, [
          { kind: 'device', deviceId: id, point },
        ]);
        set({
          devices: state.devices.map((item) => (item.id === id ? device : item)),
          panel,
        });
        if (failed.length > 0) {
          state.addToast(
            `Трассы линий «${failed.join('», «')}» не удалось переподключить. Сбросьте их в «Трассировке».`,
            'error'
          );
        }
        return true;
      },

      // ---------------------------------------------------------
      // Рамки: монтажная часть без своих линий и нагрузки
      // ---------------------------------------------------------
      setActiveFramePosts: (posts) => {
        const state = get();
        if (state.activeFramePosts === posts) return;
        set({
          activeFramePosts: posts,
          activeFrameSeatTypes: Array.from(
            { length: posts },
            (_, seat) => state.activeFrameSeatTypes[seat] ?? null
          ),
        });
      },

      setActiveFrameMounting: (mounting) => set({ activeFrameMounting: mounting }),

      setActiveFrameSeatType: (seatIndex, type) => {
        const state = get();
        if (
          !Number.isSafeInteger(seatIndex) ||
          seatIndex < 0 ||
          seatIndex >= state.activeFramePosts
        ) {
          return;
        }
        if (type !== null && !isMechanismType(type)) return;
        if (state.activeFrameSeatTypes[seatIndex] === type) return;
        const wasEmpty = state.activeFrameSeatTypes.every((seat) => seat === null);
        const seatTypes = state.activeFrameSeatTypes.map((seat, index) =>
          index === seatIndex ? type : seat
        );
        // Первый выбранный механизм задаёт высоту всего блока; дальше её
        // можно поправить одним полем на все места.
        const height =
          wasEmpty && type
            ? DEVICE_CATALOG[type].defaultHeightMm
            : state.activeFrameHeightMm;
        set({
          activeFrameSeatTypes: seatTypes,
          activeFrameHeightMm: height,
        });
      },

      setActiveFrameHeight: (heightMm) => {
        const state = get();
        if (!Number.isFinite(heightMm)) return;
        set({
          activeFrameHeightMm: Math.max(
            0,
            Math.min(state.settings.ceilingHeightMm, Math.round(heightMm))
          ),
        });
      },

      startFramePlacement: () => {
        get().setActiveTool('place_frame');
      },

      addFrame: (anchor) => {
        const state = get();
        const frame: MountingFrame = {
          id: makeEntityId('frame'),
          anchor,
          heightFromFloorMm: state.activeFrameHeightMm,
          posts: state.activeFramePosts,
          mounting: state.activeFrameMounting,
        };
        const pose = resolveFramePose(
          frame,
          state.rooms,
          state.freePartitions,
          state.settings.defaultWallThicknessMm
        );
        if (!pose) {
          state.addToast('Не удалось привязать подрозетник к стене. Проверьте план.', 'error');
          return null;
        }
        // Блок ставится целиком: рамка и все механизмы в один шаг undo.
        // Пустые места остаются заглушками и приборов не создают.
        const created: ElectricalDevice[] = [];
        for (let seat = 0; seat < frame.posts; seat += 1) {
          const type = state.activeFrameSeatTypes[seat];
          if (!type || !isMechanismType(type)) continue;
          const catalog = DEVICE_CATALOG[type];
          const sameTypeCount = [...state.devices, ...created].filter(
            (device) => device.type === type
          ).length;
          const candidate: ElectricalDevice = {
            id: makeEntityId('device'),
            type,
            name: `${catalog.label} ${sameTypeCount + 1}`,
            anchor: frameSeatAnchor(frame, seat),
            heightFromFloorMm: frame.heightFromFloorMm,
            powerWatts: catalog.defaultPowerWatts,
            shared: false,
            frameId: frame.id,
            seatIndex: seat,
          };
          const resolved = resolveDevice(
            candidate,
            state.rooms,
            state.freePartitions,
            state.settings.defaultWallThicknessMm
          );
          if (resolved) created.push({ ...candidate, shared: resolved.isShared });
        }
        set({
          frames: [...state.frames, frame],
          devices: [...state.devices, ...created],
          selection: { kind: 'frame', id: frame.id },
        });
        return frame.id;
      },

      moveFrame: (id, anchor) => {
        const state = get();
        const frame = state.frames.find((candidate) => candidate.id === id);
        if (!frame) return false;
        const nextAnchor: FrameAnchor = {
          ...anchor,
          // Плата не должна свисать с края стены: как при смене числа мест.
          offsetMm: clampFrameOffset(
            anchor,
            frame.posts,
            state.rooms,
            state.freePartitions
          ),
        };
        if (sameAnchor(frame.anchor, nextAnchor)) return true;
        const nextFrame: MountingFrame = { ...frame, anchor: nextAnchor };
        const pose = resolveFramePose(
          nextFrame,
          state.rooms,
          state.freePartitions,
          state.settings.defaultWallThicknessMm
        );
        if (!pose) {
          state.addToast(
            'Подрозетник не помещается на этой стене. Сдвиньте его вдоль стены.',
            'error'
          );
          return false;
        }

        const thickness = state.settings.defaultWallThicknessMm;
        const moves: ManualRouteAnchorMove[] = [];
        const nextDevices: ElectricalDevice[] = [];
        for (const device of state.devices) {
          if (device.frameId !== id) {
            nextDevices.push(device);
            continue;
          }
          const seat = Number.isSafeInteger(device.seatIndex)
            ? (device.seatIndex as number)
            : 0;
          const anchored: ElectricalDevice = {
            ...device,
            anchor: frameSeatAnchor(nextFrame, seat),
          };
          const resolved = resolveDevice(
            anchored,
            state.rooms,
            state.freePartitions,
            thickness
          );
          if (!resolved) {
            state.addToast(
              'Подрозетник не помещается здесь: механизмы выходят за стену.',
              'error'
            );
            return false;
          }
          const point = resolved.poses[0]?.position;
          if (point) {
            moves.push({ kind: 'device', deviceId: device.id, point });
          }
          nextDevices.push({ ...anchored, shared: resolved.isShared });
        }

        const { panel, failed } = reconnectManualRoutes(state.panel, moves);
        set({
          frames: state.frames.map((candidate) =>
            candidate.id === id ? nextFrame : candidate
          ),
          devices: nextDevices,
          panel,
        });
        if (failed.length > 0) {
          state.addToast(
            `Трассы линий «${failed.join('», «')}» не удалось переподключить. Сбросьте их в «Трассировке».`,
            'error'
          );
        }
        return true;
      },

      setFrameMounting: (id, mounting) => {
        const state = get();
        const frame = state.frames.find((candidate) => candidate.id === id);
        if (!frame || frame.mounting === mounting) return;
        set({
          frames: state.frames.map((candidate) =>
            candidate.id === id ? { ...candidate, mounting } : candidate
          ),
        });
      },

      setFramePosts: (id, posts) => {
        const state = get();
        const frame = state.frames.find((candidate) => candidate.id === id);
        if (!frame || frame.posts === posts) return;
        const maxSeat = state.devices
          .filter((device) => device.frameId === id)
          .reduce((max, device) => Math.max(max, device.seatIndex ?? -1), -1);
        if (maxSeat >= posts) {
          state.addToast(
            'Сначала освободите места, которые исчезнут при уменьшении подрозетника.',
            'error'
          );
          return;
        }
        const nextFrame: MountingFrame = {
          ...frame,
          posts,
          // Плата другого размера не должна свисать с края стены:
          // центр сдвигается до ближайшего допустимого положения.
          anchor: {
            ...frame.anchor,
            offsetMm: clampFrameOffset(
              frame.anchor,
              posts,
              state.rooms,
              state.freePartitions
            ),
          },
        };
        const devices = state.devices.map((device) => {
          if (device.frameId !== id || !Number.isSafeInteger(device.seatIndex)) return device;
          const anchor = frameSeatAnchor(nextFrame, device.seatIndex as number);
          const candidate = { ...device, anchor };
          const resolved = resolveDevice(
            candidate,
            state.rooms,
            state.freePartitions,
            state.settings.defaultWallThicknessMm
          );
          return resolved ? { ...candidate, shared: resolved.isShared } : candidate;
        });
        set({
          frames: state.frames.map((candidate) =>
            candidate.id === id ? nextFrame : candidate
          ),
          devices,
        });
      },

      setFrameHeight: (id, heightMm) => {
        const state = get();
        const frame = state.frames.find((candidate) => candidate.id === id);
        if (!frame || !Number.isFinite(heightMm)) return;
        const height = Math.max(
          0,
          Math.min(
            state.settings.ceilingHeightMm,
            Math.round(heightMm)
          )
        );
        if (height === frame.heightFromFloorMm) return;
        set({
          frames: state.frames.map((candidate) =>
            candidate.id === id ? { ...candidate, heightFromFloorMm: height } : candidate
          ),
          devices: state.devices.map((device) =>
            device.frameId === id ? { ...device, heightFromFloorMm: height } : device
          ),
        });
      },

      setFrameSeatType: (id, seatIndex, type) => {
        const state = get();
        const frame = state.frames.find((candidate) => candidate.id === id);
        if (!frame || !Number.isSafeInteger(seatIndex) || seatIndex < 0 || seatIndex >= frame.posts) {
          return;
        }
        const existingIndex = state.devices.findIndex(
          (device) => device.frameId === id && device.seatIndex === seatIndex
        );
        const existing = existingIndex >= 0 ? state.devices[existingIndex] : null;

        if (type === null) {
          if (!existing) return;
          const devices = state.devices.filter((device) => device.id !== existing.id);
          set({
            devices,
            panel: prunePanelRefs(
              state.panel,
              devices,
              state.rooms.map((room) => room.id)
            ),
            selection:
              state.selection?.kind === 'device' && state.selection.id === existing.id
                ? { kind: 'frame', id }
                : state.selection,
          });
          return;
        }

        if (!isMechanismType(type) || existing?.type === type) return;

        const catalog = DEVICE_CATALOG[type];
        const thickness = state.settings.defaultWallThicknessMm;
        const sameTypeCount = state.devices.filter(
          (device) => device.type === type && device.id !== existing?.id
        ).length;
        const occupiedElsewhere = state.devices.some(
          (device) => device.frameId === id && device.seatIndex !== seatIndex
        );
        const height = occupiedElsewhere ? frame.heightFromFloorMm : catalog.defaultHeightMm;
        const candidate: ElectricalDevice = {
          id: existing?.id ?? makeEntityId('device'),
          type,
          name: `${catalog.label} ${sameTypeCount + 1}`,
          anchor: frameSeatAnchor(frame, seatIndex),
          heightFromFloorMm: height,
          powerWatts: catalog.defaultPowerWatts,
          shared: existing?.shared ?? false,
          frameId: id,
          seatIndex,
        };
        const resolved = resolveDevice(candidate, state.rooms, state.freePartitions, thickness);
        if (!resolved) {
          state.addToast('Не удалось разместить механизм в подрозетнике. Проверьте план.', 'error');
          return;
        }
        const device: ElectricalDevice = { ...candidate, shared: resolved.isShared };
        const rawDevices =
          existingIndex >= 0
            ? state.devices.map((item, index) => (index === existingIndex ? device : item))
            : [...state.devices, device];
        const heightChanged = height !== frame.heightFromFloorMm;
        const devices = heightChanged
          ? rawDevices.map((item) =>
              item.frameId === id ? { ...item, heightFromFloorMm: height } : item
            )
          : rawDevices;
        let panel = state.panel;
        if (panel && existing) {
          const line = panel.lines.find((item) => item.deviceIds.includes(existing.id));
          if (line) {
            const ctx = {
              devices,
              rooms: state.rooms,
              partitions: state.freePartitions,
            };
            panel = unassignDevices(panel, [existing.id], ctx);
            if (DEVICE_CATALOG[existing.type].group === catalog.group) {
              panel = assignDevices(panel, line.id, [device.id], ctx);
            }
          }
        }
        set({
          devices,
          panel,
          frames: heightChanged
            ? state.frames.map((item) =>
                item.id === id ? { ...item, heightFromFloorMm: height } : item
              )
            : state.frames,
        });
      },

      deleteFrame: (id) => {
        const state = get();
        const frame = state.frames.find((candidate) => candidate.id === id);
        if (!frame) return;
        const doomedDeviceIds = new Set(
          state.devices
            .filter((device) => device.frameId === id)
            .map((device) => device.id)
        );
        const devices = state.devices.filter((device) => !doomedDeviceIds.has(device.id));
        const selection = state.selection;
        set({
          frames: state.frames.filter((candidate) => candidate.id !== id),
          devices,
          panel: prunePanelRefs(
            state.panel,
            devices,
            state.rooms.map((room) => room.id)
          ),
          selection:
            (selection?.kind === 'frame' && selection.id === id) ||
            (selection?.kind === 'device' && doomedDeviceIds.has(selection.id))
              ? null
              : selection,
        });
        state.addToast('Подрозетник удалён.', 'success');
      },

      // ---------------------------------------------------------
      // Щиток
      // ---------------------------------------------------------
      setActiveStep: (step) => {
        set({
          activeStep: step,
          designMode: step === 'plan' ? 'architecture' : 'electrical',
          lineAssignLineId: null,
          routeEditLineId: null,
          activeTool: 'select',
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        });
      },

      setPanelStep: (step) => set({ panelStep: step }),

      setHighlightedLine: (id) => {
        if (id === null) {
          set({ highlightedLineId: null });
          return;
        }
        const state = get();
        if (!state.panel?.lines.some((line) => line.id === id)) {
          set({ highlightedLineId: null });
          return;
        }
        set({ highlightedLineId: id });
      },

      placePanel: (anchor) => {
        const state = get();
        if (state.panel) {
          set({
            panel: { ...state.panel, anchor },
            selection: { kind: 'panel', id: state.panel.id },
            activeTool: 'select',
          });
          state.addToast('Щиток перемещён на новую стену.', 'success');
          return;
        }
        const panel = createEmptyPanel(anchor);
        set({
          panel,
          selection: { kind: 'panel', id: panel.id },
          activeTool: 'select',
        });
        state.addToast(
          'Щиток размещён. Откройте модуль «Щиток», чтобы собрать схему.',
          'success'
        );
      },

      deletePanel: () => {
        const state = get();
        if (!state.panel) return;
        set({
          panel: null,
          activeStep: 'plan',
          highlightedLineId: null,
          lineAssignLineId: null,
          routeEditLineId: null,
          selection: state.selection?.kind === 'panel' ? null : state.selection,
        });
        state.addToast('Щиток удалён.', 'success');
      },

      updatePanel: (updates) => {
        const state = get();
        if (!state.panel) return;
        set({ panel: { ...state.panel, ...updates } });
      },

      updatePanelSupply: (updates) => {
        const state = get();
        if (!state.panel) return;
        const merged = { ...state.panel.supply, ...updates };
        const supply =
          updates.allocatedPowerW !== undefined ? recalculateSupply(merged) : merged;
        set({ panel: { ...state.panel, supply } });
      },

      setPanelStrategy: (strategy) => {
        const state = get();
        if (!state.panel) return;
        set({ panel: applyStrategy(state.panel, strategy, state.rooms) });
        if (strategy === 'custom') {
          state.addToast('Ручной режим: изменения схемы больше не перезаписываются.', 'info');
        }
      },

      appendUnassignedDevices: () => {
        const state = get();
        if (!state.panel) return;
        const result = appendUnassignedDevicesOp(state.panel, {
          devices: state.devices,
          rooms: state.rooms,
          partitions: state.freePartitions,
        });
        if (result.assigned === 0) {
          state.addToast(
            'В линиях нет подходящей линии для этих приборов. Создайте линию и добавьте приборы в её составе.',
            'info'
          );
          return;
        }
        set({ panel: result.panel, highlightedLineId: null });
        state.addToast(`Добавлено приборов: ${result.assigned}.`, 'success');
      },

      createManualPanelLine: () => {
        const state = get();
        if (!state.panel) return undefined;
        const line = {
          ...createLine(
            'other',
            [],
            'Без комнаты',
            state.panel.lines.length,
            state.settings.defaultRouting
          ),
          code: nextLineCode(state.panel),
          name: `Линия ${nextLineCode(state.panel)}`,
          loadW: 0,
          deviceIds: [],
          roomIds: [],
          colorIndex: nextColorIndex(state.panel),
          trace: 'none' as const,
        };
        set({
          panel: {
            ...state.panel,
            lines: [...state.panel.lines, line],
          },
          highlightedLineId: line.id,
        });
        return line.id;
      },

      updatePanelLine: (id, updates) => {
        const state = get();
        if (!state.panel) return;
        const lines = state.panel.lines.map((line) => {
          if (line.id !== id) return line;
          let merged = { ...line, ...updates, id: line.id };
          // Смена назначения задаёт пресет защиты; кабель остаётся выбранным.
          if (updates.purpose !== undefined) {
            merged = applyPresetProtection(merged);
          }
          // У дифавтомата один номинал: УЗО повторяет автомат. Без части
          // утечки аппарат снова становится обычным автоматом.
          if (merged.combinedProtection) {
            if (merged.rcd) {
              merged.rcd = { ...merged.rcd, ratingA: merged.breaker.ratingA };
            } else {
              merged.combinedProtection = undefined;
            }
          }
          return merged;
        });
        const manualProtection =
          updates.breaker !== undefined ||
          updates.rcd !== undefined ||
          updates.combinedProtection !== undefined;
        const strategy =
          manualProtection && state.panel.strategy !== 'custom'
            ? ('custom' as const)
            : state.panel.strategy;
        set({ panel: { ...state.panel, lines, strategy } });
        if (strategy !== state.panel.strategy) {
          state.addToast(
            'Автомат и УЗО исправлены вручную — стратегия переключена на «Своя защита».',
            'info'
          );
        }
      },

      deletePanelLine: (id) => {
        const state = get();
        if (!state.panel) return;
        const dinOrder = state.panel.dinOrder?.filter(
          (itemId) => itemId !== `${id}-breaker` && itemId !== `${id}-rcd`
        );
        const lines = state.panel.lines.filter((line) => line.id !== id);
        const nextPanel = { ...state.panel, lines };
        const planSheets = prunePlanSheets(nextPanel, lines);
        if (planSheets) nextPanel.planSheets = planSheets;
        else delete nextPanel.planSheets;
        set({
          panel: withDinOrder(nextPanel, dinOrder),
          highlightedLineId:
            state.highlightedLineId === id ? null : state.highlightedLineId,
          lineAssignLineId:
            state.lineAssignLineId === id ? null : state.lineAssignLineId,
          routeEditLineId:
            state.routeEditLineId === id ? null : state.routeEditLineId,
        });
      },

      clearPanelLines: () => {
        const state = get();
        if (!state.panel) return;
        const lineItemIds = new Set(
          state.panel.lines.flatMap((line) => [
            `${line.id}-breaker`,
            `${line.id}-rcd`,
          ])
        );
        const cleared = { ...state.panel, lines: [], strategy: 'custom' as const };
        delete cleared.planSheets;
        set({
          panel: withDinOrder(
            cleared,
            state.panel.dinOrder?.filter((itemId) => !lineItemIds.has(itemId))
          ),
          highlightedLineId: null,
          lineAssignLineId: null,
          lineAssignStartPanel: null,
          routeEditLineId: null,
        });
        state.addToast('Схема очищена. Добавляйте линии вручную.', 'info');
      },

      movePanelDinItem: (itemId, targetIndex) => {
        const state = get();
        if (!state.panel) return;
        const layout = buildPanelLayout(state.panel, { rooms: state.rooms });
        const currentIds = layout.items.map((item) => item.id);
        if (!currentIds.includes(itemId)) return;
        const nextIds = currentIds.filter((id) => id !== itemId);
        const insertAt = Math.max(0, Math.min(Math.round(targetIndex), nextIds.length));
        nextIds.splice(insertAt, 0, itemId);
        if (nextIds.every((id, index) => id === currentIds[index])) return;

        // Совпало с автопорядком — не храним ручной список вовсе.
        const auto = buildPanelLayout(
          withDinOrder(state.panel, undefined),
          { rooms: state.rooms }
        ).items.map((item) => item.id);
        const isAuto =
          nextIds.length === auto.length &&
          nextIds.every((id, index) => id === auto[index]);
        set({ panel: withDinOrder(state.panel, isAuto ? undefined : nextIds) });
      },

      resetPanelDinOrder: () => {
        const state = get();
        if (!state.panel?.dinOrder?.length) return;
        set({ panel: withDinOrder(state.panel, undefined) });
        state.addToast('Порядок аппаратов возвращён к автоматическому.', 'info');
      },

      savePlanSheet: (sheet) => {
        const state = get();
        if (!state.panel) return;
        const clean = sanitizePlanSheet(sheet, state.panel);
        if (!clean) {
          state.addToast(
            'Лист без групп сохранить нельзя — это пустой чертёж.',
            'info'
          );
          return;
        }
        const stored = state.panel.planSheets ?? [];
        const nextSheet: PlanSheetSpec = {
          ...clean,
          name: clean.name || autoPlanSheetName(state.panel, clean.lineIds),
        };
        const existing = stored.findIndex((item) => item.id === clean.id);
        const planSheets =
          existing >= 0
            ? stored.map((item, index) => (index === existing ? nextSheet : item))
            : [...stored, nextSheet];
        set({ panel: { ...state.panel, planSheets } });
      },

      deletePlanSheet: (id) => {
        const state = get();
        if (!state.panel?.planSheets) return;
        const planSheets = state.panel.planSheets.filter((sheet) => sheet.id !== id);
        const panel = { ...state.panel };
        // Последний лист удалён — вернуть один лист со всеми группами.
        if (planSheets.length > 0) panel.planSheets = planSheets;
        else delete panel.planSheets;
        set({ panel });
      },

      setLineAssignLine: (id) => {
        const state = get();
        if (id && !state.panel?.lines.some((line) => line.id === id)) {
          set({ lineAssignLineId: null, lineAssignStartPanel: null });
          return;
        }
        set({
          lineAssignLineId: id,
          lineAssignStartPanel: id ? state.panel : null,
          ...(id ? {
            // Шаги разделены: набор приборов идёт без редактора трассы.
            routeEditLineId: null,
            activeTool: 'select' as const,
            designMode: 'electrical' as const,
            selection: null,
            highlightedLineId: id,
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeSnap: DEFAULT_SNAP,
          } : {}),
        });
      },

      cancelLineAssignment: () => {
        const state = get();
        if (!state.lineAssignLineId) return;
        const snapshot = state.lineAssignStartPanel;
        set({
          lineAssignLineId: null,
          lineAssignStartPanel: null,
          ...(snapshot && state.panel
            ? { panel: snapshot, highlightedLineId: null }
            : {}),
        });
        if (snapshot && state.panel) {
          state.addToast('Изменения состава отменены.', 'info');
        }
      },

      assignDevicesToLine: (lineId, deviceIds) => {
        const state = get();
        if (!state.panel) return;
        const panel = assignDevices(state.panel, lineId, deviceIds, {
          devices: state.devices,
          rooms: state.rooms,
          partitions: state.freePartitions,
        });
        if (panel !== state.panel) set({ panel });
      },

      unassignDevicesFromLines: (deviceIds) => {
        const state = get();
        if (!state.panel) return;
        const panel = unassignDevices(state.panel, deviceIds, {
          devices: state.devices,
          rooms: state.rooms,
          partitions: state.freePartitions,
        });
        if (panel !== state.panel) {
          set({ panel });
          state.addToast(
            `Снято с линий приборов: ${deviceIds.length}.`,
            'info'
          );
        }
      },

      createPanelLineFromDevices: (deviceIds, purpose) => {
        const state = get();
        if (!state.panel || deviceIds.length === 0) return null;
        const result = createLineFromDevices(
          state.panel,
          deviceIds,
          { purpose, routing: state.settings.defaultRouting, trace: 'none' },
          {
            devices: state.devices,
            rooms: state.rooms,
            partitions: state.freePartitions,
          }
        );
        set({
          panel: result.panel,
          highlightedLineId: result.lineId,
        });
        state.addToast('Линия создана из выбранных приборов.', 'success');
        return result.lineId;
      },

      splitPanelLine: (lineId, deviceIds, newPurpose) => {
        const state = get();
        if (!state.panel) return null;
        const result = splitLine(
          state.panel,
          lineId,
          deviceIds,
          {
            devices: state.devices,
            rooms: state.rooms,
            partitions: state.freePartitions,
          },
          newPurpose
        );
        if (!result) {
          state.addToast(
            'Для деления выберите часть приборов линии — не все и не ни одного.',
            'error'
          );
          return null;
        }
        set({
          panel: result.panel,
          highlightedLineId: result.lineId,
        });
        state.addToast('Линия разделена на две.', 'success');
        return result.lineId;
      },

      mergePanelLines: (lineIds) => {
        const state = get();
        if (!state.panel) return null;
        const result = mergeLines(state.panel, lineIds, {
          devices: state.devices,
          rooms: state.rooms,
          partitions: state.freePartitions,
        });
        if (!result) return null;
        set({
          panel: result.panel,
          highlightedLineId: result.lineId,
          lineAssignLineId:
            state.lineAssignLineId && lineIds.includes(state.lineAssignLineId)
              ? result.lineId
              : state.lineAssignLineId,
          routeEditLineId:
            state.routeEditLineId && lineIds.includes(state.routeEditLineId)
              ? result.lineId
              : state.routeEditLineId,
        });
        state.addToast(`Объединено линий: ${lineIds.length}.`, 'success');
        return result.lineId;
      },

      setRouteEditLine: (id) => {
        const state = get();
        if (id && !state.panel?.lines.some((line) => line.id === id)) {
          set({ routeEditLineId: null });
          return;
        }
        set({
          routeEditLineId: id,
          ...(id
            ? {
                activeTool: 'select' as const,
                designMode: 'electrical' as const,
                selection: null,
                draftVertices: [],
                dynamicInput: DEFAULT_DYNAMIC_INPUT,
                activeSnap: DEFAULT_SNAP,
                lineAssignLineId: null,
                highlightedLineId: id,
              }
            : {}),
        });
      },

      addLineWaypoint: (lineId, point) => {
        const state = get();
        if (!state.panel) return;
        const line = state.panel.lines.find((candidate) => candidate.id === lineId);
        if (!line) return;
        const waypoints = line.waypoints ?? [];
        const last = waypoints[waypoints.length - 1];
        if (last && Math.abs(last.x - point.x) < 1 && Math.abs(last.y - point.y) < 1) {
          return;
        }
        const next = [...waypoints, { x: point.x, y: point.y }];
        set({
          panel: {
            ...state.panel,
            lines: state.panel.lines.map((candidate) =>
              candidate.id === lineId ? { ...candidate, waypoints: next } : candidate
            ),
          },
        });
      },

      moveLineWaypoint: (lineId, index, point) => {
        const state = get();
        if (!state.panel) return;
        const line = state.panel.lines.find((candidate) => candidate.id === lineId);
        const waypoints = line?.waypoints;
        if (!waypoints || index < 0 || index >= waypoints.length) return;
        if (waypoints[index].x === point.x && waypoints[index].y === point.y) return;
        const next = waypoints.map((existing, i) =>
          i === index ? { x: point.x, y: point.y } : existing
        );
        set({
          panel: {
            ...state.panel,
            lines: state.panel.lines.map((candidate) =>
              candidate.id === lineId ? { ...candidate, waypoints: next } : candidate
            ),
          },
        });
      },

      removeLineWaypoint: (lineId, index) => {
        const state = get();
        if (!state.panel) return;
        const line = state.panel.lines.find((candidate) => candidate.id === lineId);
        const waypoints = line?.waypoints;
        if (!waypoints || index < 0 || index >= waypoints.length) return;
        const next = waypoints.filter((_, i) => i !== index);
        set({
          panel: {
            ...state.panel,
            lines: state.panel.lines.map((candidate) =>
              candidate.id === lineId
                ? { ...candidate, waypoints: next.length > 0 ? next : undefined }
                : candidate
            ),
          },
        });
      },

      clearLineWaypoints: (lineId) => {
        const state = get();
        if (!state.panel) return;
        const line = state.panel.lines.find((candidate) => candidate.id === lineId);
        if (!line?.waypoints?.length) return;
        set({
          panel: {
            ...state.panel,
            lines: state.panel.lines.map((candidate) =>
              candidate.id === lineId ? { ...candidate, waypoints: undefined } : candidate
            ),
          },
        });
        state.addToast('Контрольные точки трассы удалены.', 'info');
      },

      moveLineRouteNode: (lineId, nodeIndex, point) => {
        const state = get();
        if (!state.panel) return null;
        const base = materializeRouteForLine(lineRouteInput(state), lineId);
        if (!base) {
          state.addToast('Не удалось построить ручную трассу для линии.', 'error');
          return null;
        }
        const result = moveManualRouteNode(base, nodeIndex, point);
        if (!result.ok) {
          state.addToast(result.error, 'error');
          return null;
        }
        set({
          panel: withLineManualRoute(state.panel, lineId, result.route),
        });
        return result.nodeIndex;
      },

      insertLineRouteNode: (
        lineId,
        pathIndex,
        segmentIndex,
        point,
        maxDistanceMm
      ) => {
        const state = get();
        if (!state.panel) return;
        const base = materializeRouteForLine(lineRouteInput(state), lineId);
        if (!base) {
          state.addToast('Не удалось построить ручную трассу для линии.', 'error');
          return;
        }
        const result = insertManualRouteNode(
          base,
          pathIndex,
          segmentIndex,
          point,
          maxDistanceMm ?? Number.POSITIVE_INFINITY
        );
        if (!result.ok) {
          state.addToast(result.error, 'error');
          return;
        }
        set({
          panel: withLineManualRoute(state.panel, lineId, result.route),
        });
      },

      removeLineRouteNode: (lineId, nodeIndex) => {
        const state = get();
        if (!state.panel) return false;
        const base = materializeRouteForLine(lineRouteInput(state), lineId);
        if (!base) return false;
        const result = removeManualRouteNode(base, nodeIndex);
        if (!result.ok) {
          state.addToast(result.error, 'error');
          return false;
        }
        set({
          panel: withLineManualRoute(state.panel, lineId, result.route),
        });
        return true;
      },

      removeLineRouteSegment: (lineId, pathIndex, segmentIndex) => {
        const state = get();
        if (!state.panel) return false;
        const base = materializeRouteForLine(lineRouteInput(state), lineId);
        if (!base) {
          state.addToast('Не удалось построить ручную трассу для линии.', 'error');
          return false;
        }
        const result = removeManualRouteSegment(base, pathIndex, segmentIndex);
        if (!result.ok) {
          state.addToast(result.error, 'error');
          return false;
        }
        set({
          panel: withLineManualRoute(state.panel, lineId, result.route),
        });
        state.addToast(
          'Участок трассы удалён — остальные участки сохранены.',
          'info'
        );
        return true;
      },

      reorderLineRouteStops: (lineId, branchIndex, fromIndex, toIndex) => {
        const state = get();
        if (!state.panel) return false;
        if (fromIndex === toIndex) return false;
        const base = materializeRouteForLine(lineRouteInput(state), lineId);
        if (!base) {
          state.addToast('Не удалось построить ручную трассу для линии.', 'error');
          return false;
        }
        const result = reorderManualRouteStops(base, branchIndex, fromIndex, toIndex);
        if (!result.ok) {
          state.addToast(result.error, 'error');
          return false;
        }
        set({
          panel: withLineManualRoute(state.panel, lineId, result.route),
        });
        return true;
      },

      addLineRouteJunction: (lineId, point) => {
        const state = get();
        if (!state.panel) {
          return { ok: false, error: 'Сначала разместите щиток на плане.' };
        }
        const line = state.panel.lines.find((candidate) => candidate.id === lineId);
        if (!line) {
          return { ok: false, error: 'Линия не найдена.' };
        }
        const placementError = routeJunctionPlacementError(
          point,
          state.rooms,
          state.freePartitions
        );
        if (placementError) return { ok: false, error: placementError };

        const loose = (line.routeJunctions ?? []).map((item) => ({ ...item }));
        if (
          loose.some((item) => distance(item, point) <= ROUTE_LINK_EPS_MM)
        ) {
          return { ok: false, error: 'Узел уже стоит в этой точке.' };
        }

        let nextRoute = line.manualRoute
          ? materializeRouteForLine(lineRouteInput(state), lineId)
          : null;
        let anchored = false;
        if (nextRoute) {
          const nodeIndex = nextRoute.nodes.findIndex(
            (node) => distance(node, point) <= ROUTE_LINK_EPS_MM
          );
          if (nodeIndex >= 0) {
            const physical = nextRoute.anchors.find(
              (anchor) =>
                anchor.nodeIndex === nodeIndex &&
                (anchor.kind === 'panel' || anchor.kind === 'device')
            );
            if (physical) {
              return {
                ok: false,
                error: 'В этой точке уже подключён щиток или прибор.',
              };
            }
            if (
              nextRoute.anchors.some(
                (anchor) =>
                  anchor.kind === 'junction' &&
                  anchor.nodeIndex === nodeIndex
              )
            ) {
              return { ok: false, error: 'Узел уже стоит в этой точке.' };
            }
          }
          const inserted = insertJunctionIntoRoute(nextRoute, point);
          if (inserted.ok) {
            nextRoute = inserted.route;
            anchored = true;
          } else if (inserted.reason === 'invalid') {
            return { ok: false, error: inserted.error };
          }
        }
        if (!anchored) loose.push({ x: point.x, y: point.y });

        set({
          panel: {
            ...state.panel,
            lines: state.panel.lines.map((candidate) =>
              candidate.id === lineId
                ? {
                    ...candidate,
                    manualRoute: nextRoute ?? candidate.manualRoute,
                    routeJunctions: loose.length > 0 ? loose : undefined,
                  }
                : candidate
            ),
          },
        });
        state.addToast(
          anchored
            ? 'Узел стоит на трассе — от него можно вести ветвь.'
            : 'Узел поставлен. Соедините его с приборами или щитком.',
          'success'
        );
        return { ok: true };
      },

      linkLineRoute: (lineId, from, to, axisFirst) => {
        const state = get();
        if (!state.panel) {
          return { ok: false, error: 'Сначала разместите щиток на плане.' };
        }
        const line = state.panel.lines.find((candidate) => candidate.id === lineId);
        if (!line) {
          return { ok: false, error: 'Линия не найдена.' };
        }
        for (const endpoint of [from, to]) {
          if (endpoint.kind === 'panel' && !state.panel) {
            return { ok: false, error: 'Щиток не размещён на плане.' };
          }
          if (
            endpoint.kind === 'device' &&
            (!endpoint.deviceId || !line.deviceIds.includes(endpoint.deviceId))
          ) {
            return {
              ok: false,
              error: 'Этот прибор не входит в состав линии.',
            };
          }
        }
        const base = materializeRouteForLine(lineRouteInput(state), lineId);
        const result = linkManualRoute(base, from, to, axisFirst);
        if (!result.ok) return result;

        const usedLoose = (line.routeJunctions ?? []).filter((point) =>
          [from, to].some(
            (endpoint) =>
              endpoint.kind === 'junction' &&
              distance(endpoint.point, point) <= ROUTE_LINK_EPS_MM
          )
        );
        const keptLoose = (line.routeJunctions ?? []).filter(
          (point) => !usedLoose.includes(point)
        );
        set({
          panel: {
            ...state.panel,
            lines: state.panel.lines.map((candidate) =>
              candidate.id === lineId
                ? {
                    ...candidate,
                    manualRoute: result.route,
                    routeJunctions:
                      keptLoose.length > 0 ? keptLoose : undefined,
                    waypoints: undefined,
                  }
                : candidate
            ),
          },
        });
        state.addToast(
          result.warnings.length > 0
            ? `Связь добавлена. ${result.warnings.join(' ')}`
            : 'Связь добавлена — можно продолжать в любом порядке.',
          result.warnings.length > 0 ? 'info' : 'success'
        );
        return { ok: true };
      },

      setLineManualRoute: (lineId, manualRoute) => {
        const state = get();
        if (!state.panel) return;
        const line = state.panel.lines.find((candidate) => candidate.id === lineId);
        if (!line) return;
        if (!manualRoute && !line.manualRoute && !line.waypoints?.length) return;
        set({
          panel: withLineManualRoute(state.panel, lineId, manualRoute),
        });
      },

      resetLineRoute: (lineId) => {
        const state = get();
        if (!state.panel) return;
        const line = state.panel.lines.find((candidate) => candidate.id === lineId);
        if (!line) return;
        const hasManual = Boolean(
          line.manualRoute ||
            line.waypoints?.length ||
            line.routeJunctions?.length
        );
        if (!hasManual && line.trace !== 'none') return;
        set({
          panel: {
            ...state.panel,
            lines: state.panel.lines.map((candidate) =>
              candidate.id === lineId
                ? {
                    ...candidate,
                    manualRoute: undefined,
                    routeJunctions: undefined,
                    waypoints: undefined,
                    trace: 'auto',
                  }
                : candidate
            ),
          },
        });
        state.addToast(
          hasManual
            ? 'Ручная трасса сброшена — линия снова трассируется автоматически.'
            : 'Линия переведена в автоматический режим: трасса считается автоматически.',
          'info'
        );
      },

      resetProject: () => {
        set({
          nodes: {},
          walls: [],
          openings: [],
          freePartitions: [],
          devices: [],
          frames: [],
          panel: null,
          apartment: null,
          rooms: [],
          selection: null,
          activeStep: 'plan',
          panelStep: 'devices',
          highlightedLineId: null,
          lineAssignLineId: null,
          routeEditLineId: null,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
          activeTool: 'select',
          designMode: 'architecture',
          activeDeviceType: 'socket_single',
          deviceShared: false,
          ...DEFAULT_FRAME_BLOCK,
          boundaryMode: 'auto',
          drawingStage: 'rooms',
          boundaryLocked: false,
          toasts: [],
          isCoverageValid: true,
          coveragePercent: 0,
        });
        useProjectStore.temporal.getState().clear();
      },

      loadProject: (snapshot) => {
        if (!isProjectSnapshot(snapshot)) {
          get().addToast('Не удалось загрузить проект: некорректные данные JSON.', 'error');
          return;
        }
        const settings = { ...DEFAULT_SETTINGS, ...snapshot.settings };
        const mode: BoundaryMode =
          snapshot.boundaryMode ?? (snapshot.apartment ? 'manual' : 'auto');
        const storedDevices = snapshot.devices ?? [];

        if (mode === 'auto') {
          const next = computeAutoProjectState(
            snapshot.rooms ?? [],
            snapshot.freePartitions ?? [],
            snapshot.openings ?? [],
            settings.defaultWallThicknessMm
          );

          const electrical = sanitizeElectrical(
            storedDevices,
            snapshot.frames ?? [],
            next.state.rooms,
            next.state.freePartitions,
            settings.defaultWallThicknessMm
          );
          const { devices, frames } = electrical;
          const sanitizedPanel = prunePanelRefs(
            sanitizePanel(
              snapshot.panel ?? null,
              next.state.rooms,
              next.state.freePartitions,
              settings.defaultWallThicknessMm
            ),
            devices,
            next.state.rooms.map((room) => room.id)
          );
          const panel = sanitizedPanel
            ? normalizeLineAssignments(sanitizedPanel)
            : null;

          set({
            settings,
            boundaryMode: 'auto',
            ...next.state,
            devices,
            frames,
            panel,
            selection: null,
            activeStep: 'plan',
            panelStep: 'devices',
            highlightedLineId: null,
            lineAssignLineId: null,
            routeEditLineId: null,
            designMode: 'architecture',
            activeDeviceType: 'socket_single',
            deviceShared: false,
            ...DEFAULT_FRAME_BLOCK,
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeSnap: DEFAULT_SNAP,
            activeTool: 'select',
            drawingStage: 'rooms',
            boundaryLocked: false,
            toasts: [],
          });
          useProjectStore.temporal.getState().clear();
          get().checkCoverage();
          return;
        }

        const apartment = snapshot.apartment
          ? { ...snapshot.apartment, holes: snapshot.apartment.holes ?? [] }
          : null;
        const rooms = snapshot.rooms ?? [];
        const partitions = snapshot.freePartitions ?? [];
        const electrical = sanitizeElectrical(
          storedDevices,
          snapshot.frames ?? [],
          rooms,
          partitions,
          settings.defaultWallThicknessMm
        );
        const { devices, frames } = electrical;
        const sanitizedPanel = prunePanelRefs(
          sanitizePanel(
            snapshot.panel ?? null,
            rooms,
            partitions,
            settings.defaultWallThicknessMm
          ),
          devices,
          rooms.map((room) => room.id)
        );
        const panel = sanitizedPanel
          ? normalizeLineAssignments(sanitizedPanel)
          : null;

        set({
          settings,
          boundaryMode: 'manual',
          apartment,
          rooms,
          nodes: snapshot.nodes ?? {},
          walls: snapshot.walls ?? [],
          openings: snapshot.openings ?? [],
          freePartitions: partitions,
          devices,
          frames,
          panel,
          selection: null,
          activeStep: 'plan',
          panelStep: 'devices',
          highlightedLineId: null,
          lineAssignLineId: null,
          routeEditLineId: null,
          designMode: 'architecture',
          activeDeviceType: 'socket_single',
          deviceShared: false,
          ...DEFAULT_FRAME_BLOCK,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
          activeTool: 'select',
          drawingStage: apartment ? 'rooms' : 'boundary',
          boundaryLocked: Boolean(apartment),
          toasts: [],
        });
        useProjectStore.temporal.getState().clear();
        get().checkCoverage();
      },
    }),
    {
      limit: 50,
      // Undo возвращает только данные проекта; вид (план/щиток), выделение и
      // инструменты остаются текущими, чтобы Ctrl+Z не переключал экраны.
      partialize: (state) => ({
        nodes: state.nodes,
        walls: state.walls,
        apartment: state.apartment,
        rooms: state.rooms,
        openings: state.openings,
        freePartitions: state.freePartitions,
        devices: state.devices,
        frames: state.frames,
        panel: state.panel,
      }),
      equality: (pastState, currentState) =>
        JSON.stringify(pastState.apartment) === JSON.stringify(currentState.apartment) &&
        JSON.stringify(pastState.rooms) === JSON.stringify(currentState.rooms) &&
        JSON.stringify(pastState.openings) === JSON.stringify(currentState.openings) &&
        JSON.stringify(pastState.freePartitions) === JSON.stringify(currentState.freePartitions) &&
        JSON.stringify(pastState.devices) === JSON.stringify(currentState.devices) &&
        JSON.stringify(pastState.frames) === JSON.stringify(currentState.frames) &&
        JSON.stringify(pastState.panel) === JSON.stringify(currentState.panel),
    }
  )
);

// -------------------------------------------------------------
// Сохранение проекта: быстрый автосейв в localStorage + файл JSON
// -------------------------------------------------------------
const STORAGE_KEY = 'electrica-project-v1';

export function getProjectSnapshot(): ProjectSnapshot {
  const state = useProjectStore.getState();
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    boundaryMode: state.boundaryMode,
    settings: state.settings,
    apartment: state.apartment,
    rooms: state.rooms,
    nodes: state.nodes,
    walls: state.walls,
    openings: state.openings,
    freePartitions: state.freePartitions,
    devices: state.devices,
    frames: state.frames,
    panel: state.panel,
  };
}

export function isProjectSnapshot(value: unknown): value is ProjectSnapshot {
  return validateProjectSnapshot(value, DEFAULT_SETTINGS);
}

function restoreStoredProject(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (isProjectSnapshot(parsed)) {
      useProjectStore.getState().loadProject(parsed);
    }
  } catch (err) {
    console.warn('Не удалось восстановить проект из localStorage:', err);
  }
}

restoreStoredProject();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
useProjectStore.subscribe(() => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getProjectSnapshot()));
    } catch (err) {
      console.warn('Не удалось сохранить проект:', err);
    }
  }, 400);
});

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
  ShaftCutout,
  ProjectSettings,
  ProjectSnapshot,
  CADTool,
  DynamicInputState,
  SnapResult,
  DrawingStage,
  BoundaryTool,
  BoundaryMode,
  ToastMessage,
  DesignMode,
  Selection,
  DeviceType,
  DeviceAnchor,
  ElectricalDevice,
  ElectricalPanel,
  CircuitLine,
  LinePurpose,
  PanelStrategy,
  PanelSupply,
  ProjectView,
} from '../types';
import {
  calculateRoomsOverlapAreaM2,
  clipRoomToApartment,
  splitRoomByPartition,
  subtractShaftFromRoom,
  unionApartmentBoundary,
  differenceApartmentBoundary,
} from '../core/geometry/csg';
import { calculateCoveredAreaM2, extractGraphFromPlan } from '../core/geometry/wallsGraph';
import {
  buildAutoLayout,
  isAutoLayoutConnected,
  roomTouchesShafts,
  validateNewRoom,
  validatePartitionPlacement,
  validateShaftPlacement,
  type AutoLayout,
} from '../core/geometry/autoLayout';
import {
  DEVICE_CATALOG,
  resolveDevice,
  sanitizeDevices,
} from '../core/electrical/devices';
import {
  applyStrategy,
  autoLinesFromDevices,
  createEmptyPanel,
  createLine,
  recalculateLine,
  recalculateSupply,
  sanitizePanel,
  type PanelWallAnchor,
} from '../core/electrical/panel';
import { prunePanelRefs } from '../core/electrical/lineAssignment';
import { collectRoomElements } from '../core/model/roomElements';

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

// 100 мм²: отсекаем погрешность вычислений, но ловим реальное наложение
const ROOM_OVERLAP_TOLERANCE_M2 = 0.0001;

interface ProjectState {
  // Графовая модель данных (Nodes + Walls + Rooms)
  nodes: Record<string, Node2D>;
  walls: Wall[];
  openings: Opening[];
  freePartitions: FreePartition[];
  devices: ElectricalDevice[];
  panel: ElectricalPanel | null;
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  shafts: ShaftCutout[];
  selection: Selection | null;

  // Отдельный экран щитка вместо плана и подсветка линии на плане
  activeView: ProjectView;
  highlightedLineId: string | null;

  // Настройки
  settings: ProjectSettings;

  // Режим работы и активный электроприбор
  designMode: DesignMode;
  activeDeviceType: DeviceType;
  deviceShared: boolean;

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
  activeBoundaryTool: BoundaryTool;
  activeOpeningType: OpeningType;
  toasts: ToastMessage[];
  isCoverageValid: boolean;
  coveragePercent: number;

  // Actions
  setSettings: (settings: Partial<ProjectSettings>) => void;
  setActiveTool: (tool: CADTool) => void;
  setDrawingStage: (stage: DrawingStage) => void;
  setBoundaryTool: (tool: BoundaryTool) => void;
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
  setDesignMode: (mode: DesignMode) => void;
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
  deleteDevice: (id: string) => void;

  // Щиток
  setActiveView: (view: ProjectView) => void;
  setHighlightedLine: (id: string | null) => void;
  placePanel: (anchor: PanelWallAnchor) => void;
  deletePanel: () => void;
  updatePanel: (updates: Partial<Omit<ElectricalPanel, 'id' | 'lines' | 'supply'>>) => void;
  updatePanelSupply: (updates: Partial<PanelSupply>) => void;
  setPanelStrategy: (strategy: PanelStrategy) => void;
  generatePanelLines: () => void;
  addPanelLine: (purpose: LinePurpose, roomIds: string[]) => void;
  updatePanelLine: (id: string, updates: Partial<CircuitLine>) => void;
  deletePanelLine: (id: string) => void;
  clearPanelLines: () => void;

  resetProject: () => void;
  loadProject: (snapshot: ProjectSnapshot) => void;
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
  shafts: ShaftCutout[];
  freePartitions: FreePartition[];
  openings: Opening[];
  apartment: ApartmentBoundary | null;
  nodes: Record<string, Node2D>;
  walls: Wall[];
}

function computeAutoProjectState(
  rooms: RoomZone[],
  shafts: ShaftCutout[],
  freePartitions: FreePartition[],
  openings: Opening[],
  thickness: number
): { state: AutoProjectState; removedOpenings: number; layout: AutoLayout } {
  const layout = buildAutoLayout(rooms, shafts, freePartitions, openings, thickness);
  return {
    state: {
      rooms,
      shafts,
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
      panel: null,
      apartment: null,
      rooms: [],
      shafts: [],
      selection: null,

      activeView: 'plan',
      highlightedLineId: null,

      settings: DEFAULT_SETTINGS,

      designMode: 'architecture',
      activeDeviceType: 'socket_single',
      deviceShared: false,

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
      activeBoundaryTool: 'add',
      activeOpeningType: 'door',
      toasts: [],
      isCoverageValid: true,
      coveragePercent: 0,

      setSettings: (updates) => {
        const state = get();
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
        const state = get();
        if (
          tool === 'draw_shaft' &&
          state.boundaryMode === 'manual' &&
          (state.boundaryLocked || state.drawingStage !== 'boundary')
        ) {
          state.addToast(
            'Шахты вычитаются только на этапе построения контура квартиры.',
            'error'
          );
          return;
        }
        set({
          activeTool: tool,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        });
      },

      setDrawingStage: (stage) => {
        if (get().boundaryMode === 'auto') {
          set({ drawingStage: 'rooms', boundaryLocked: false });
          return;
        }
        set(stage === 'boundary' ? { drawingStage: stage, boundaryLocked: false } : { drawingStage: stage });
      },
      setBoundaryTool: (tool) => set({ activeBoundaryTool: tool }),
      setActiveOpeningType: (type) => set({ activeOpeningType: type }),
      lockBoundary: () => {
        set({ boundaryLocked: true, drawingStage: 'rooms', activeTool: 'select' });
        get().checkCoverage();
      },

      addToast: (message, type = 'info') => {
        const id = `toast-${Date.now()}`;
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

      setDesignMode: (mode) =>
        set({
          designMode: mode,
          activeTool: 'select',
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        }),

      setActiveDeviceType: (type) =>
        set({
          activeDeviceType: type,
          activeTool: 'place_device',
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        }),

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
          let newShaft: ShaftCutout | null = null;

          if (!state.apartment) {
            // Первый контур
            if (state.activeBoundaryTool === 'subtract') {
              state.addToast('Первый контур должен быть основным, а не шахтой!', 'error');
              set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
              return;
            }
          } else if (state.activeBoundaryTool === 'add') {
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
          } else {
            const previousHoleCount = newHoles.length;
            const res = differenceApartmentBoundary(
              state.apartment.vertices,
              newHoles,
              state.draftVertices
            );
            if (!res.success) {
              state.addToast(res.error || 'Ошибка вычитания', 'error');
              set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
              return;
            }
            newVertices = res.vertices;
            newHoles = res.holes;
            // Внутренний вырез сохраняется как отдельное кольцо — заводим его в шахты,
            // чтобы пол и подписи отрисовались корректно.
            if (newHoles.length > previousHoleCount) {
              newShaft = { id: makeEntityId('shaft'), vertices: state.draftVertices };
            }
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
            shafts: newShaft ? [...state.shafts, newShaft] : state.shafts,
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
              state.shafts,
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

        // 3. Вырезание шахт
        if (state.activeTool === 'draw_shaft') {
          if (state.boundaryMode === 'auto') {
            const validation = validateShaftPlacement(
              state.rooms,
              state.shafts,
              state.freePartitions,
              state.settings.defaultWallThicknessMm,
              state.draftVertices
            );
            if (!validation.ok) {
              state.addToast(validation.error || 'Не удалось добавить шахту.', 'error');
              set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
              return;
            }

            const next = computeAutoProjectState(
              state.rooms,
              [...state.shafts, { id: makeEntityId('shaft'), vertices: state.draftVertices }],
              state.freePartitions,
              state.openings,
              state.settings.defaultWallThicknessMm
            );

            set({
              ...next.state,
              draftVertices: [],
              dynamicInput: DEFAULT_DYNAMIC_INPUT,
              activeTool: 'select',
              drawingStage: 'rooms',
              boundaryLocked: false,
            });
            state.addToast('Шахта вырезана из комнат, стены вокруг построены.', 'success');
            get().checkCoverage();
            return;
          }

          if (state.boundaryLocked || state.drawingStage !== 'boundary') {
            state.addToast(
              'Шахты вычитаются только на этапе построения контура квартиры.',
              'error'
            );
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const { rooms } = state;
          const updatedRooms: RoomZone[] = [];

          for (const room of rooms) {
            const cutPolys = subtractShaftFromRoom(room.vertices, state.draftVertices);
            if (cutPolys.length > 0) {
              updatedRooms.push({ ...room, vertices: cutPolys[0] });
              for (let i = 1; i < cutPolys.length; i++) {
                updatedRooms.push({
                  ...room,
                  id: `${makeEntityId('room')}-${i}`,
                  name: `${room.name} (часть ${i + 1})`,
                  nodeIds: [],
                  vertices: cutPolys[i],
                });
              }
            }
          }

          const graph = extractGraphFromPlan(
            state.apartment,
            updatedRooms,
            state.settings.defaultWallThicknessMm,
            state.settings.exteriorWallThicknessMm
          );

          set({
            apartment: graph.updatedApartment,
            rooms: graph.updatedRooms,
            nodes: graph.nodes,
            walls: graph.walls,
            shafts: [...state.shafts, { id: makeEntityId('shaft'), vertices: state.draftVertices }],
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeTool: 'select',
          });
          get().checkCoverage();
          return;
        }

        // 4. Создание проема (Дверь/Окно)
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
              state.shafts,
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
              state.shafts,
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
          shafts: [],
          selection: null,
          activeView: 'plan',
          highlightedLineId: null,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
          activeTool: 'select',
          drawingStage: isAuto ? 'rooms' : 'boundary',
          boundaryLocked: false,
          activeBoundaryTool: 'add',
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
            state.shafts,
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
        const remainingDevices = state.devices.filter(
          (device) => !doomedDeviceIds.has(device.id)
        );
        const selection = state.selection;
        const selectionRemoved =
          selection !== null &&
          ((selection.kind === 'room' && selection.id === id) ||
            (selection.kind === 'opening' && doomedOpeningIds.has(selection.id)) ||
            (selection.kind === 'partition' &&
              elements.partitions.some((partition) => partition.id === selection.id)) ||
            (selection.kind === 'device' && doomedDeviceIds.has(selection.id)));

        if (state.boundaryMode === 'auto') {
          if (roomTouchesShafts(room, state.shafts, thickness)) {
            state.addToast(
              'В комнате есть шахта. Сначала удалите шахту или оставьте комнату на месте.',
              'error'
            );
            return;
          }

          const remainingRooms = state.rooms.filter((candidate) => candidate.id !== id);

          if (
            !isAutoLayoutConnected(remainingRooms, state.shafts, thickness)
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
              shafts: [],
              freePartitions: [],
              openings: [],
              devices: [],
              panel: null,
              apartment: null,
              nodes: {},
              walls: [],
              selection: null,
              activeView: 'plan',
              highlightedLineId: null,
            });
            get().checkCoverage();
            return;
          }

          const next = computeAutoProjectState(
            remainingRooms,
            state.shafts,
            remainingPartitions,
            remainingOpenings,
            thickness
          );

          const nextPanel = prunePanelRefs(
            sanitizePanel(state.panel, remainingRooms, remainingPartitions, thickness),
            remainingDevices.map((device) => device.id),
            remainingRooms.map((candidate) => candidate.id)
          );

          set({
            ...next.state,
            devices: remainingDevices,
            panel: nextPanel,
            activeView: nextPanel ? state.activeView : 'plan',
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
          remainingDevices.map((device) => device.id),
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
          panel: nextPanel,
          activeView: nextPanel ? state.activeView : 'plan',
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
        const selection = state.selection;
        const selectionRemoved =
          selection !== null &&
          ((selection.kind === 'partition' && selection.id === id) ||
            (selection.kind === 'device' && doomedDeviceIds.has(selection.id)));

        if (state.boundaryMode === 'auto') {
          const next = computeAutoProjectState(
            state.rooms,
            state.shafts,
            remainingPartitions,
            state.openings,
            thickness
          );
          const nextPanel = prunePanelRefs(
            sanitizePanel(state.panel, state.rooms, remainingPartitions, thickness),
            remainingDevices.map((device) => device.id),
            state.rooms.map((room) => room.id)
          );
          set({
            ...next.state,
            devices: remainingDevices,
            panel: nextPanel,
            activeView: nextPanel ? state.activeView : 'plan',
            highlightedLineId: keepLineHighlight(nextPanel, state.highlightedLineId),
            selection: selectionRemoved || (state.panel && !nextPanel) ? null : selection,
          });
          if (next.removedOpenings > 0) {
            state.addToast('Проёмы на удалённой перегородке тоже удалены.', 'info');
          }
        } else {
          const nextPanel = prunePanelRefs(
            sanitizePanel(state.panel, state.rooms, remainingPartitions, thickness),
            remainingDevices.map((device) => device.id),
            state.rooms.map((room) => room.id)
          );
          set({
            freePartitions: remainingPartitions,
            devices: remainingDevices,
            panel: nextPanel,
            activeView: nextPanel ? state.activeView : 'plan',
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

        set({
          devices: [
            ...state.devices,
            { ...candidate, shared: resolved.isShared },
          ],
        });
      },

      deleteDevice: (id) => {
        const state = get();
        if (!state.devices.some((device) => device.id === id)) return;
        const devices = state.devices.filter((device) => device.id !== id);
        const panel = prunePanelRefs(
          state.panel,
          devices.map((device) => device.id),
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

      // ---------------------------------------------------------
      // Щиток
      // ---------------------------------------------------------
      setActiveView: (view) => {
        const state = get();
        if (view === 'panel' && !state.panel) {
          state.addToast('Сначала разместите щиток на плане.', 'error');
          return;
        }
        set({
          activeView: view,
          activeTool: 'select',
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        });
      },

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
          activeView: 'plan',
          highlightedLineId: null,
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
        set({ panel: applyStrategy(state.panel, strategy) });
        if (strategy === 'custom') {
          state.addToast('Ручной режим: изменения схемы больше не перезаписываются.', 'info');
        }
      },

      generatePanelLines: () => {
        const state = get();
        if (!state.panel) return;
        const lines = autoLinesFromDevices(
          state.devices,
          state.rooms,
          state.freePartitions
        );
        const withStrategy = applyStrategy({ ...state.panel, lines }, state.panel.strategy);
        set({ panel: withStrategy, highlightedLineId: null });
        if (lines.length === 0) {
          state.addToast(
            'Приборов на плане нет. Добавьте линии вручную или расставьте розетки и свет.',
            'info'
          );
        } else {
          state.addToast(
            `Собрано линий: ${lines.length}. Проверьте автоматы, кабели и УЗО.`,
            'success'
          );
        }
      },

      addPanelLine: (purpose, roomIds) => {
        const state = get();
        if (!state.panel) return;
        const roomName =
          roomIds.length > 0
            ? state.rooms.find((room) => room.id === roomIds[0])?.name ?? 'Группа'
            : 'Без комнаты';
        const line = createLine(purpose, roomIds, roomName, state.panel.lines.length);
        set({
          panel: { ...state.panel, lines: [...state.panel.lines, line] },
        });
      },

      updatePanelLine: (id, updates) => {
        const state = get();
        if (!state.panel) return;
        const lines = state.panel.lines.map((line) => {
          if (line.id !== id) return line;
          const merged = { ...line, ...updates, id: line.id };
          if (updates.loadW !== undefined || updates.purpose !== undefined) {
            return recalculateLine(merged);
          }
          return merged;
        });
        set({ panel: { ...state.panel, lines } });
      },

      deletePanelLine: (id) => {
        const state = get();
        if (!state.panel) return;
        set({
          panel: {
            ...state.panel,
            lines: state.panel.lines.filter((line) => line.id !== id),
          },
          highlightedLineId:
            state.highlightedLineId === id ? null : state.highlightedLineId,
        });
      },

      clearPanelLines: () => {
        const state = get();
        if (!state.panel) return;
        set({
          panel: { ...state.panel, lines: [], strategy: 'custom' },
          highlightedLineId: null,
        });
        state.addToast('Схема очищена. Добавляйте линии вручную.', 'info');
      },

      resetProject: () => {
        set({
          nodes: {},
          walls: [],
          openings: [],
          freePartitions: [],
          devices: [],
          panel: null,
          apartment: null,
          rooms: [],
          shafts: [],
          selection: null,
          activeView: 'plan',
          highlightedLineId: null,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
          activeTool: 'select',
          designMode: 'architecture',
          activeDeviceType: 'socket_single',
          deviceShared: false,
          boundaryMode: 'auto',
          drawingStage: 'rooms',
          boundaryLocked: false,
          activeBoundaryTool: 'add',
          toasts: [],
          isCoverageValid: true,
          coveragePercent: 0,
        });
        useProjectStore.temporal.getState().clear();
      },

      loadProject: (snapshot) => {
        const settings = { ...DEFAULT_SETTINGS, ...snapshot.settings };
        const mode: BoundaryMode =
          snapshot.boundaryMode ?? (snapshot.apartment ? 'manual' : 'auto');
        const storedDevices = snapshot.devices ?? [];

        if (mode === 'auto') {
          const next = computeAutoProjectState(
            snapshot.rooms ?? [],
            snapshot.shafts ?? [],
            snapshot.freePartitions ?? [],
            snapshot.openings ?? [],
            settings.defaultWallThicknessMm
          );

          const devices = sanitizeDevices(
            storedDevices,
            next.state.rooms,
            next.state.freePartitions,
            settings.defaultWallThicknessMm
          );
          const panel = prunePanelRefs(
            sanitizePanel(
              snapshot.panel ?? null,
              next.state.rooms,
              next.state.freePartitions,
              settings.defaultWallThicknessMm
            ),
            devices.map((device) => device.id),
            next.state.rooms.map((room) => room.id)
          );

          set({
            settings,
            boundaryMode: 'auto',
            ...next.state,
            devices,
            panel,
            selection: null,
            activeView: 'plan',
            highlightedLineId: null,
            designMode: 'architecture',
            activeDeviceType: 'socket_single',
            deviceShared: false,
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeSnap: DEFAULT_SNAP,
            activeTool: 'select',
            drawingStage: 'rooms',
            boundaryLocked: false,
            activeBoundaryTool: 'add',
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
        const devices = sanitizeDevices(
          storedDevices,
          rooms,
          partitions,
          settings.defaultWallThicknessMm
        );
        const panel = prunePanelRefs(
          sanitizePanel(
            snapshot.panel ?? null,
            rooms,
            partitions,
            settings.defaultWallThicknessMm
          ),
          devices.map((device) => device.id),
          rooms.map((room) => room.id)
        );

        set({
          settings,
          boundaryMode: 'manual',
          apartment,
          rooms,
          nodes: snapshot.nodes ?? {},
          walls: snapshot.walls ?? [],
          openings: snapshot.openings ?? [],
          freePartitions: partitions,
          shafts: snapshot.shafts ?? [],
          devices,
          panel,
          selection: null,
          activeView: 'plan',
          highlightedLineId: null,
          designMode: 'architecture',
          activeDeviceType: 'socket_single',
          deviceShared: false,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
          activeTool: 'select',
          drawingStage: apartment ? 'rooms' : 'boundary',
          boundaryLocked: Boolean(apartment),
          activeBoundaryTool: 'add',
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
        shafts: state.shafts,
        devices: state.devices,
        panel: state.panel,
      }),
      equality: (pastState, currentState) =>
        JSON.stringify(pastState.apartment) === JSON.stringify(currentState.apartment) &&
        JSON.stringify(pastState.rooms) === JSON.stringify(currentState.rooms) &&
        JSON.stringify(pastState.openings) === JSON.stringify(currentState.openings) &&
        JSON.stringify(pastState.freePartitions) === JSON.stringify(currentState.freePartitions) &&
        JSON.stringify(pastState.shafts) === JSON.stringify(currentState.shafts) &&
        JSON.stringify(pastState.devices) === JSON.stringify(currentState.devices) &&
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
    shafts: state.shafts,
    devices: state.devices,
    panel: state.panel,
  };
}

export function isProjectSnapshot(value: unknown): value is ProjectSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ProjectSnapshot>;
  return (
    snapshot.version === 1 &&
    Array.isArray(snapshot.rooms) &&
    Array.isArray(snapshot.walls) &&
    Array.isArray(snapshot.openings) &&
    Array.isArray(snapshot.freePartitions) &&
    Array.isArray(snapshot.shafts) &&
    (snapshot.devices === undefined || Array.isArray(snapshot.devices)) &&
    (snapshot.panel === undefined ||
      snapshot.panel === null ||
      typeof snapshot.panel === 'object') &&
    (snapshot.apartment === null || typeof snapshot.apartment === 'object')
  );
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

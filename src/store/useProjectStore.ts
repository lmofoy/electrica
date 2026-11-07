import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  Point2D,
  Node2D,
  Wall,
  ApartmentBoundary,
  RoomZone,
  RoomType,
  ShaftCutout,
  ProjectSettings,
  CADTool,
  DynamicInputState,
  SnapResult,
} from '../types';
import {
  clipRoomToApartment,
  resolveRoomOverlaps,
  subtractShaftFromRoom,
} from '../core/geometry/csg';
import { extractGraphFromPlan } from '../core/geometry/wallsGraph';

interface ProjectState {
  // Графовая модель данных (Nodes + Walls + Rooms)
  nodes: Record<string, Node2D>;        // Единый реестр узлов
  walls: Wall[];                       // Единый реестр стен (без задвоений!)
  apartment: ApartmentBoundary | null; // Контур квартиры (высший уровень)
  rooms: RoomZone[];                   // Помещения внутри квартиры
  shafts: ShaftCutout[];               // Шахты и монолитные колонны
  selectedRoomId: string | null;

  // Настройки
  settings: ProjectSettings;

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

  // Actions
  setSettings: (settings: Partial<ProjectSettings>) => void;
  setActiveTool: (tool: CADTool) => void;
  setActiveRoomType: (type: RoomType) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setStagePos: (pos: Point2D | ((prev: Point2D) => Point2D)) => void;
  setCursorPosMm: (pos: Point2D) => void;
  setGridSnap: (enabled: boolean) => void;
  setSelectedRoomId: (id: string | null) => void;
  setActiveSnap: (snap: SnapResult) => void;

  // Черчение
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
  updateRoom: (id: string, updates: Partial<RoomZone>) => void;
  deleteRoom: (id: string) => void;
  resetProject: () => void;
}

const DEFAULT_SETTINGS: ProjectSettings = {
  defaultWallThicknessMm: 120,    // Межкомнатные стены 120 мм
  exteriorWallThicknessMm: 250,   // Наружные стены 250 мм
  ceilingHeightMm: 2700,
  floorLevelMm: 0,
  cableMarginPercent: 15,
  defaultRouting: 'ceiling',
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

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => ({
      nodes: {},
      walls: [],
      apartment: null,
      rooms: [],
      shafts: [],
      selectedRoomId: null,

      settings: DEFAULT_SETTINGS,

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

      setSettings: (updates) =>
        set((state) => ({ settings: { ...state.settings, ...updates } })),

      setActiveTool: (tool) =>
        set({
          activeTool: tool,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        }),

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
      setSelectedRoomId: (id) => set({ selectedRoomId: id }),
      setActiveSnap: (snap) => set({ activeSnap: snap }),

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
        if (state.draftVertices.length < 3) {
          set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
          return;
        }

        // 1. Создание контура квартиры
        if (state.activeTool === 'draw_apartment') {
          const rawApt: ApartmentBoundary = {
            id: `apartment-${Date.now()}`,
            name: 'Контур квартиры',
            nodeIds: [],
            vertices: state.draftVertices,
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
          return;
        }

        // 2. Создание комнаты внутри квартиры
        if (state.activeTool === 'draw_room') {
          let roomPolys = [state.draftVertices];

          if (state.apartment && state.apartment.vertices.length >= 3) {
            roomPolys = clipRoomToApartment(state.draftVertices, state.apartment.vertices);
          }

          if (roomPolys.length === 0 || roomPolys[0].length < 3) {
            alert('Комната должна находиться внутри контура квартиры!');
            set({ draftVertices: [], dynamicInput: DEFAULT_DYNAMIC_INPUT });
            return;
          }

          const targetPoly = roomPolys[0];

          // Правило: автоматическое вычитание пересечений из старых комнат
          const updatedOldRooms = resolveRoomOverlaps(state.rooms, targetPoly);

          const typeNames: Record<RoomType, string> = {
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
            '#3b82f6', // Синий
            '#a855f7', // Фиолетовый
            '#f97316', // Оранжевый
            '#06b6d4', // Бирюзовый
            '#10b981', // Изумрудный
            '#ec4899', // Розовый
            '#eab308', // Золотисто-желтый
            '#84cc16', // Салатовый
            '#6366f1', // Индиго
            '#14b8a6', // Морская волна
          ];

          const roomIndex = updatedOldRooms.length;
          const assignedColor = VIBRANT_ROOM_COLORS[roomIndex % VIBRANT_ROOM_COLORS.length];

          const newRoom: RoomZone = {
            id: `room-${Date.now()}`,
            name: `${typeNames[state.activeRoomType]} ${updatedOldRooms.length + 1}`,
            type: state.activeRoomType,
            color: assignedColor,
            wallThicknessMm: state.settings.defaultWallThicknessMm,
            nodeIds: [],
            vertices: targetPoly,
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
            selectedRoomId: newRoom.id,
          });
          return;
        }

        // 3. Вырезание шахт
        if (state.activeTool === 'draw_shaft') {
          const { rooms } = state;
          const updatedRooms: RoomZone[] = [];

          for (const room of rooms) {
            const cutPolys = subtractShaftFromRoom(room.vertices, state.draftVertices);
            if (cutPolys.length > 0) {
              updatedRooms.push({ ...room, vertices: cutPolys[0] });
              for (let i = 1; i < cutPolys.length; i++) {
                updatedRooms.push({
                  ...room,
                  id: `room-${Date.now()}-${i}`,
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
            shafts: [...state.shafts, { id: `shaft-${Date.now()}`, vertices: state.draftVertices }],
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeTool: 'select',
          });
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
        });
      },

      updateRoom: (id, updates) =>
        set((s) => ({
          rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),

      deleteRoom: (id) => {
        const state = get();
        const remainingRooms = state.rooms.filter((r) => r.id !== id);
        const graph = extractGraphFromPlan(
          state.apartment,
          remainingRooms,
          state.settings.defaultWallThicknessMm,
          state.settings.exteriorWallThicknessMm
        );
        set({
          apartment: graph.updatedApartment,
          rooms: graph.updatedRooms,
          nodes: graph.nodes,
          walls: graph.walls,
          selectedRoomId: state.selectedRoomId === id ? null : state.selectedRoomId,
        });
      },

      resetProject: () =>
        set({
          nodes: {},
          walls: [],
          apartment: null,
          rooms: [],
          shafts: [],
          selectedRoomId: null,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
          activeSnap: DEFAULT_SNAP,
        }),
    }),
    {
      limit: 50,
      equality: (pastState, currentState) =>
        JSON.stringify(pastState.apartment) === JSON.stringify(currentState.apartment) &&
        JSON.stringify(pastState.rooms) === JSON.stringify(currentState.rooms),
    }
  )
);

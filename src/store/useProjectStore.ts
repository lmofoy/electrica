import { create } from 'zustand';
import { temporal } from 'zundo';
import type { Point2D, RoomZone, RoomType, ShaftCutout, ProjectSettings, CADTool, DynamicInputState } from '../types';
import { subtractShaftFromRoom } from '../core/geometry/csg';

interface ProjectState {
  // Данные проекта
  settings: ProjectSettings;
  rooms: RoomZone[];
  shafts: ShaftCutout[];
  selectedRoomId: string | null;

  // Инструменты и холст
  activeTool: CADTool;
  activeRoomType: RoomType;
  zoom: number;
  stagePos: Point2D;
  gridSnap: boolean;
  gridStepMm: number;

  // Черчение в реальном времени
  draftVertices: Point2D[];
  cursorPosMm: Point2D;
  dynamicInput: DynamicInputState;

  // Actions
  setSettings: (settings: Partial<ProjectSettings>) => void;
  setActiveTool: (tool: CADTool) => void;
  setActiveRoomType: (type: RoomType) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setStagePos: (pos: Point2D | ((prev: Point2D) => Point2D)) => void;
  setCursorPosMm: (pos: Point2D) => void;
  setGridSnap: (enabled: boolean) => void;
  setSelectedRoomId: (id: string | null) => void;

  // Черчение и параметрический ввод
  addDraftVertex: (vertex: Point2D) => void;
  popDraftVertex: () => void;
  finishDraft: () => void;
  cancelDraft: () => void;
  
  // Динамический ввод (Tab -> Length -> Enter -> Angle -> Enter)
  openDynamicInput: (step: 'length' | 'angle') => void;
  closeDynamicInput: () => void;
  setLockedLength: (len: number | null) => void;
  setLockedAngle: (deg: number | null) => void;
  setDynamicInputValues: (values: Partial<DynamicInputState>) => void;

  // Операции с комнатами
  addRoom: (room: RoomZone) => void;
  updateRoom: (id: string, updates: Partial<RoomZone>) => void;
  deleteRoom: (id: string) => void;
  addShaft: (shaft: ShaftCutout) => void;
  applyShaftCutout: (shaftVertices: Point2D[]) => void;
  resetProject: () => void;
}

const DEFAULT_SETTINGS: ProjectSettings = {
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

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      rooms: [
        // Демонстрационная комната для старта
        {
          id: 'room-demo-1',
          name: 'Гостиная',
          type: 'living',
          color: 'rgba(59, 130, 246, 0.15)',
          wallThicknessMm: 150,
          vertices: [
            { x: 1000, y: 1000 },
            { x: 6000, y: 1000 },
            { x: 6000, y: 4500 },
            { x: 1000, y: 4500 },
          ],
        },
      ],
      shafts: [],
      selectedRoomId: null,

      activeTool: 'select',
      activeRoomType: 'living',
      zoom: 0.15, // 1 пиксель экрана = ~6.6 мм в реальности
      stagePos: { x: 80, y: 80 },
      gridSnap: true,
      gridStepMm: 100, // шаг привязки 100 мм

      draftVertices: [],
      cursorPosMm: { x: 0, y: 0 },
      dynamicInput: DEFAULT_DYNAMIC_INPUT,

      setSettings: (updates) =>
        set((state) => ({ settings: { ...state.settings, ...updates } })),

      setActiveTool: (tool) => {
        set({
          activeTool: tool,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
        });
      },

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

        if (state.activeTool === 'draw_room' || state.activeTool === 'quick_rect') {
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
          const colors: Record<RoomType, string> = {
            living: 'rgba(59, 130, 246, 0.15)',
            bedroom: 'rgba(168, 85, 247, 0.15)',
            kitchen: 'rgba(234, 88, 12, 0.15)',
            bathroom: 'rgba(6, 182, 212, 0.15)',
            toilet: 'rgba(20, 184, 166, 0.15)',
            corridor: 'rgba(107, 114, 128, 0.15)',
            balcony: 'rgba(34, 197, 94, 0.15)',
            storage: 'rgba(245, 158, 11, 0.15)',
            custom: 'rgba(99, 102, 241, 0.15)',
          };

          const newRoom: RoomZone = {
            id: `room-${Date.now()}`,
            name: `${typeNames[state.activeRoomType]} ${state.rooms.length + 1}`,
            type: state.activeRoomType,
            color: colors[state.activeRoomType],
            wallThicknessMm: 150,
            vertices: state.draftVertices,
          };

          set((s) => ({
            rooms: [...s.rooms, newRoom],
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeTool: 'select',
            selectedRoomId: newRoom.id,
          }));
        } else if (state.activeTool === 'draw_shaft') {
          // Вычитание шахты из пересекающихся комнат
          get().applyShaftCutout(state.draftVertices);
          set({
            draftVertices: [],
            dynamicInput: DEFAULT_DYNAMIC_INPUT,
            activeTool: 'select',
          });
        }
      },

      cancelDraft: () => {
        set({
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
        });
      },

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

      addRoom: (room) => set((s) => ({ rooms: [...s.rooms, room] })),

      updateRoom: (id, updates) =>
        set((s) => ({
          rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),

      deleteRoom: (id) =>
        set((s) => ({
          rooms: s.rooms.filter((r) => r.id !== id),
          selectedRoomId: s.selectedRoomId === id ? null : s.selectedRoomId,
        })),

      addShaft: (shaft) => set((s) => ({ shafts: [...s.shafts, shaft] })),

      applyShaftCutout: (shaftVertices) => {
        const { rooms } = get();
        const updatedRooms: RoomZone[] = [];

        for (const room of rooms) {
          const cutPolys = subtractShaftFromRoom(room.vertices, shaftVertices);
          if (cutPolys.length > 0) {
            // Берем основной полигон комнаты
            updatedRooms.push({
              ...room,
              vertices: cutPolys[0],
            });
            // Если шахта разрезала комнату на 2 части
            for (let i = 1; i < cutPolys.length; i++) {
              updatedRooms.push({
                ...room,
                id: `room-${Date.now()}-${i}`,
                name: `${room.name} (часть ${i + 1})`,
                vertices: cutPolys[i],
              });
            }
          }
        }

        set({
          rooms: updatedRooms,
          shafts: [...get().shafts, { id: `shaft-${Date.now()}`, vertices: shaftVertices }],
        });
      },

      resetProject: () =>
        set({
          rooms: [],
          shafts: [],
          selectedRoomId: null,
          draftVertices: [],
          dynamicInput: DEFAULT_DYNAMIC_INPUT,
        }),
    }),
    {
      limit: 50,
      equality: (pastState, currentState) =>
        JSON.stringify(pastState.rooms) === JSON.stringify(currentState.rooms),
    }
  )
);

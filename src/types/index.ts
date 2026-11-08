export interface Point2D {
  x: number; // в миллиметрах (мировые координаты)
  y: number; // в миллиметрах (мировые координаты)
}

// -------------------------------------------------------------
// Графовая архитектура стен и узлов (Planar Straight-Line Graph)
// -------------------------------------------------------------
export interface Node2D {
  id: string;
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  nodeAId: string;
  nodeBId: string;
  thicknessMm: number;
  isExterior: boolean;
  roomIds: string[]; // к каким комнатам примыкает (2 комнаты = общая стена!)
  ownerRoomId?: string; // комната-владелец грани (для авто-режима)
}

export type RoomType =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'toilet'
  | 'corridor'
  | 'balcony'
  | 'storage'
  | 'custom';

// Контур всей квартиры (высший уровень иерархии)
export interface ApartmentBoundary {
  id: string;
  name: string;
  nodeIds: string[]; // замкнутая цепочка узлов
  vertices: Point2D[]; // внутренние чистовые границы квартиры в мм
  holes: Point2D[][]; // внутренние вырезы (шахты, колонны)
  exteriorWallThicknessMm: number; // толщина наружных стен (250 мм)
}

// Комната внутри квартиры (ссылается на общие узлы)
export interface RoomZone {
  id: string;
  name: string;
  type: RoomType;
  nodeIds: string[]; // замкнутый контур узлов: [node1, node2, node3, ...]
  vertices: Point2D[]; // координаты вершин чистового пола в мм
  holes?: Point2D[][]; // вырезы внутри комнаты (шахты, колонны)
  color: string;
  wallThicknessMm: number; // базовая толщина стен
}

export interface ShaftCutout {
  id: string;
  vertices: Point2D[]; // контур выреза вентшахты или несущей колонны в мм
}

export interface ProjectSettings {
  defaultWallThicknessMm: number; // базовая толщина межкомнатных перегородок (120 мм)
  exteriorWallThicknessMm: number; // толщина наружных стен (250 мм)
  ceilingHeightMm: number; // высота потолка (2700 мм)
  floorLevelMm: number; // 0 мм
  cableMarginPercent: number; // настраиваемый запас кабеля (+15%)
  defaultRouting: 'ceiling' | 'floor'; // прокладка по потолку или по полу
  showDimensions: boolean; // Видимость размеров
}

export type CADTool =
  | 'select'
  | 'pan'
  | 'draw_apartment' // очерчивание контура квартиры
  | 'draw_room'      // очерчивание комнат внутри квартиры
  | 'draw_shaft'     // вырезание шахт и колонн
  | 'draw_opening'   // установка дверей и окон
  | 'draw_partition'; // рисование одиночных перегородок

export type OpeningType = 'door' | 'window';

export interface Opening {
  id: string;
  type: OpeningType;
  wallId: string;
  p1: Point2D; // Начало проема на осевой линии стены
  p2: Point2D; // Конец проема
  widthMm: number;
  heightMm: number;
  elevationMm: number; // Высота от пола (0 для дверей, ~900 для окон)
  wallThicknessMm: number; // Толщина стены, в которой вырезан проем
}

export interface FreePartition {
  id: string;
  p1: Point2D;
  p2: Point2D;
  thicknessMm: number;
  roomId: string; // В какой комнате находится
}

export type DrawingStage = 'boundary' | 'rooms';
export type BoundaryTool = 'add' | 'subtract';
export type BoundaryMode = 'auto' | 'manual';

export interface ProjectSnapshot {
  version: 1;
  savedAt: string;
  boundaryMode?: BoundaryMode; // отсутствует в старых проектах — тогда режим определяется по apartment
  settings: ProjectSettings;
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  nodes: Record<string, Node2D>;
  walls: Wall[];
  openings: Opening[];
  freePartitions: FreePartition[];
  shafts: ShaftCutout[];
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'error' | 'info' | 'success';
}

export interface DynamicInputState {
  isOpen: boolean;
  step: 'none' | 'length' | 'angle';
  lockedLength: number | null; // зафиксированная длина в мм
  lockedAngle: number | null; // зафиксированный угол в градусах
  currentLengthInput: string;
  currentAngleInput: string;
}

export interface GuideLine {
  from: Point2D;
  to: Point2D;
  type: 'polar' | 'align_x' | 'align_y' | 'edge';
  label?: string;
  sourceNode?: Point2D;
}

export interface SnapResult {
  point: Point2D;
  isSnapped: boolean;
  snapType: 'none' | 'vertex' | 'polar' | 'alignment' | 'wall_edge';
  guideLines: GuideLine[];
  label?: string;
}

// -------------------------------------------------------------
// Архитектурная модель электроточек (для следующего шага)
// -------------------------------------------------------------
export type DeviceType =
  | 'socket_single'
  | 'socket_double'
  | 'socket_wet'
  | 'switch_1k'
  | 'switch_2k'
  | 'light_ceiling'
  | 'cooktop'
  | 'oven'
  | 'water_heater'
  | 'ac'
  | 'panel_board';

export interface ElectricalDevice {
  id: string;
  type: DeviceType;
  name: string;
  roomId: string; // Привязка к КОНКРЕТНОЙ комнате (решает проблему смежных стен!)
  wallId?: string; // Привязка к конкретной стене
  wallOffsetT?: number; // Смещение вдоль стены (0..1)
  position: Point2D; // Мировые координаты в мм
  heightFromFloorMm: number; // Высота от чистового пола (300 мм розетки, 900 мм выключатели)
  inwardNormalAngleDeg: number; // Угол разворота внутрь комнаты
  powerWatts: number;
  circuitId?: string;
}

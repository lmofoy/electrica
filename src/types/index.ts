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
  exteriorWallThicknessMm: number; // толщина наружных стен (250 мм)
}

// Комната внутри квартиры (ссылается на общие узлы)
export interface RoomZone {
  id: string;
  name: string;
  type: RoomType;
  nodeIds: string[]; // замкнутый контур узлов: [node1, node2, node3, ...]
  vertices: Point2D[]; // координаты вершин чистового пола в мм
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
}

export type CADTool =
  | 'select'
  | 'pan'
  | 'draw_apartment' // очерчивание контура квартиры
  | 'draw_room'      // очерчивание комнат внутри квартиры
  | 'draw_shaft';    // вырезание шахт и колонн

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

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
  defaultRouting: LineRouting; // прокладка по потолку или по полу
  showDimensions: boolean; // Видимость размеров
}

export type CADTool =
  | 'select'
  | 'pan'
  | 'draw_apartment' // очерчивание контура квартиры
  | 'draw_room'      // очерчивание комнат внутри квартиры
  | 'draw_shaft'     // вырезание шахт и колонн
  | 'draw_opening'   // установка дверей и окон
  | 'draw_partition' // рисование одиночных перегородок
  | 'place_device'   // расстановка электроточек
  | 'place_panel';   // размещение электрощитка

// Режим работы: архитектура (оболочка) или электрика (наполнение)
export type DesignMode = 'architecture' | 'electrical';

// Единое выделение любого элемента плана
export type Selection =
  | { kind: 'room'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'partition'; id: string }
  | { kind: 'shaft'; id: string }
  | { kind: 'device'; id: string }
  | { kind: 'panel'; id: string };

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
  devices?: ElectricalDevice[]; // отсутствует в проектах до этапа «Электрика»
  panel?: ElectricalPanel | null; // отсутствует в проектах до этапа «Щиток»
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
// Электрика: устройства привязаны к грани комнаты или перегородке.
// Одна запись может отображаться двумя зеркальными символами
// (сквозь стену, для двух смежных комнат).
// -------------------------------------------------------------
export type DeviceType =
  | 'socket_single'
  | 'socket_double'
  | 'socket_wet'
  | 'switch_1k'
  | 'switch_2k'
  | 'light_ceiling';

// Грань комнаты: edgeIndex — индекс ребра vertices[i] → vertices[i+1]
export interface DeviceRoomEdgeAnchor {
  kind: 'room_edge';
  roomId: string;
  edgeIndex: number;
  offsetMm: number; // расстояние от начала ребра вдоль него
}

// Перегородка: side = 1 | -1 — сторона нормали p1 → p2
export interface DevicePartitionAnchor {
  kind: 'partition';
  partitionId: string;
  offsetMm: number;
  side: 1 | -1;
}

// Потолочная точка внутри комнаты
export interface DeviceRoomPointAnchor {
  kind: 'room_point';
  roomId: string;
  x: number;
  y: number;
}

export type DeviceAnchor =
  | DeviceRoomEdgeAnchor
  | DevicePartitionAnchor
  | DeviceRoomPointAnchor;

export interface ElectricalDevice {
  id: string;
  type: DeviceType;
  name: string;
  anchor: DeviceAnchor;
  heightFromFloorMm: number; // розетки 300 мм, выключатели 900 мм, светильники — потолок
  powerWatts: number;
  shared: boolean; // сквозное устройство: принадлежит двум смежным комнатам
  circuitId?: string;
}

// -------------------------------------------------------------
// Электрощиток: отдельный модуль со своей схемой.
// Щиток привязан к стене (грань комнаты или перегородка), на плане
// отображается символом, а его схема открывается отдельным экраном.
// -------------------------------------------------------------
export type ProjectView = 'plan' | 'panel';

export type PanelStrategy = 'budget' | 'optimal' | 'maximum' | 'custom';

export type PanelMounting = 'flush' | 'surface'; // встроенный / накладной

export type LinePurpose =
  | 'lighting'
  | 'sockets'
  | 'wet'
  | 'kitchen'
  | 'hob'
  | 'oven'
  | 'washing'
  | 'ac'
  | 'heating'
  | 'other';

export type LineRouting = 'ceiling' | 'floor';

export interface CableSpec {
  sectionMm2: number; // 1.5 | 2.5 | 4 | 6 | 10 | 16
  cores: 3; // 1 фаза: L + N + PE
}

export interface BreakerSpec {
  poles: 1 | 2;
  ratingA: number; // 6, 10, 16, 20, 25, 32, 40, 50, 63
  curve: 'B' | 'C';
}

export interface RcdSpec {
  poles: 2; // 1P+N
  ratingA: number;
  sensitivityMa: number; // 10 | 30 | 100 | 300
  type: 'A' | 'AC';
}

export interface CircuitLine {
  id: string;
  name: string;
  purpose: LinePurpose;
  roomIds: string[];
  deviceIds: string[]; // фактический состав линии для подсветки и трассировки
  colorIndex?: number; // стабильный цвет линии; не задан — берётся позиция в списке
  loadW: number;
  cable: CableSpec;
  breaker: BreakerSpec;
  rcd: RcdSpec | null;
  routing?: LineRouting; // способ прокладки; не задан — берётся defaultRouting проекта
  waypoints?: Point2D[]; // ручные контрольные точки трассы (мм); маршрут проходит через них по порядку
}

export interface PanelSupply {
  allocatedPowerW: number; // выделенная мощность по ТУ
  voltageV: 230;
  inputCable: CableSpec;
  inputBreaker: BreakerSpec;
  meter: { enabled: boolean };
  mainRcd: RcdSpec | null; // противопожарное УЗО на вводе
  voltageRelay: boolean;
  surgeProtection: boolean;
}

export interface ElectricalPanel {
  id: string;
  name: string;
  anchor: DeviceRoomEdgeAnchor | DevicePartitionAnchor;
  heightFromFloorMm: number;
  mounting: PanelMounting;
  supply: PanelSupply;
  strategy: PanelStrategy;
  lines: CircuitLine[];
}

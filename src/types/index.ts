export interface Point2D {
  x: number; // в миллиметрах (мировые координаты)
  y: number; // в миллиметрах (мировые координаты)
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
  vertices: Point2D[]; // внутренние чистовые границы квартиры в мм
  exteriorWallThicknessMm: number; // толщина наружных стен (например, 250 мм)
}

// Комната внутри квартиры
export interface RoomZone {
  id: string;
  name: string;
  type: RoomType;
  vertices: Point2D[]; // внутренние чистовые границы комнаты в мм
  color: string;
  wallThicknessMm: number; // толщина межкомнатных перегородок (например, 100-150 мм)
}

export interface ShaftCutout {
  id: string;
  vertices: Point2D[]; // контур выреза вентшахты или несущей колонны в мм
}

export interface ProjectSettings {
  defaultWallThicknessMm: number; // базовая толщина межкомнатных стен (по умолч. 120 мм)
  exteriorWallThicknessMm: number; // толщина наружных стен квартиры (по умолч. 250 мм)
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

// Информация о привязке (магните)
export interface SnapResult {
  point: Point2D;
  isSnapped: boolean;
  snapType: 'none' | 'vertex' | 'ortho_align' | 'wall_edge';
  guideLine?: { from: Point2D; to: Point2D };
  label?: string;
}

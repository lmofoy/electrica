export interface Point2D {
  x: number; // в миллиметрах (world coordinates)
  y: number; // в миллиметрах (world coordinates)
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

export interface RoomZone {
  id: string;
  name: string;
  type: RoomType;
  vertices: Point2D[]; // многоугольник в мм
  color: string;
  wallThicknessMm: number; // обычно 100 или 200 мм
}

export interface ShaftCutout {
  id: string;
  vertices: Point2D[]; // контур выреза вентшахты или колонны в мм
}

export interface ProjectSettings {
  ceilingHeightMm: number; // высота потолка (например, 2700 мм)
  floorLevelMm: number; // 0 мм
  cableMarginPercent: number; // настраиваемый запас (по умолчанию 15%)
  defaultRouting: 'ceiling' | 'floor'; // по потолку или по полу
}

export type CADTool =
  | 'select'
  | 'pan'
  | 'draw_room'
  | 'draw_shaft'
  | 'quick_rect';

export interface DynamicInputState {
  isOpen: boolean;
  step: 'none' | 'length' | 'angle';
  lockedLength: number | null; // зафиксированная длина в мм
  lockedAngle: number | null; // зафиксированный угол в градусах
  currentLengthInput: string;
  currentAngleInput: string;
}

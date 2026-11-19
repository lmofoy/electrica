import type {
  ElectricalDevice,
  ElectricalPanel,
  FreePartition,
  Node2D,
  Opening,
  Point2D,
  RoomZone,
  Wall,
} from '../../types';
import type { AutoLayout } from '../geometry/autoLayout';
import {
  calculateCentroid,
  calculateNetAreaM2,
  distance,
} from '../geometry/math';
import { DEVICE_CATALOG, resolveDevice } from './devices';
import type { DeviceGlyphKind } from './devices';
import { resolvePanelPose } from './panel';
import { buildLineColorMap } from './lineColors';
import type { LineRoute } from './routing';
import {
  A3_HEIGHT_MM,
  A3_WIDTH_MM,
  SHEET_FRAME,
  SHEET_NOTES_BLOCK,
  type SheetRect,
  type SheetStampLine,
} from './sheetLayout';
import {
  buildSheetDocumentBlock,
  type SheetDocumentBlock,
} from './sheetDocument';

// -------------------------------------------------------------
// Печатные планы (ЭС-05 розетки, ЭС-06 освещение): стены и полы,
// приборы с высотами, группы и трассы, ведомость приборов, легенда,
// примечания и штамп. Модуль не рисует — отдаёт координаты в мм.
// -------------------------------------------------------------

export type PlanMode = 'power' | 'lighting';

export interface PlanSheetSource {
  mode: PlanMode;
  rooms: RoomZone[];
  nodes: Record<string, Node2D>;
  walls: Wall[];
  openings: Opening[];
  partitions: FreePartition[];
  devices: ElectricalDevice[];
  panel: ElectricalPanel | null;
  autoLayout: AutoLayout | null;
  routes: Map<string, LineRoute>;
  wallThicknessMm: number;
}

export interface PlanSheetOptions {
  date?: string;
  scale?: number;
}

export interface PlanRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanFloor {
  rings: Point2D[][];
}

export interface PlanRoomLabel {
  roomId: string;
  name: string;
  x: number;
  y: number;
  areaLabel: string;
}

export interface PlanSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

export interface PlanOpening {
  id: string;
  type: Opening['type'];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  clearWidth: number;
  ticks: SheetStampLine[];
  middleLine: SheetStampLine | null;
}

export interface PlanDeviceSymbol {
  id: string;
  type: ElectricalDevice['type'];
  glyph: DeviceGlyphKind;
  x: number;
  y: number;
  rotationDeg: number;
  mirrored: boolean;
  roomId: string;
  roomName: string;
  lineIndex: number | null;
  heightLabel: string;
  labelX: number;
  labelY: number;
}

export interface PlanRoutePath {
  lineId: string;
  index: number;
  name: string;
  color: string;
  routing: 'ceiling' | 'floor';
  points: Point2D[];
  labelX: number;
  labelY: number;
}

export interface PlanDimension {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  text: string;
  textX: number;
  textY: number;
  textAngle: number;
  ticks: SheetStampLine[];
  extensions: SheetStampLine[];
}

export interface PlanTableColumn {
  id: string;
  label: string;
  width: number;
  align: 'start' | 'middle' | 'end';
}

export interface PlanTableRow {
  cells: string[];
}

export interface PlanTable {
  title: string;
  rect: PlanRect;
  columns: PlanTableColumn[];
  headerHeight: number;
  rowHeight: number;
  rows: PlanTableRow[];
  lines: SheetStampLine[];
  emptyLabel?: string;
}

export interface PlanLegendEntry {
  type: ElectricalDevice['type'];
  label: string;
  x: number;
  y: number;
  glyph: DeviceGlyphKind;
}

export interface PlanSheetLayout {
  mode: PlanMode;
  title: string;
  subtitle: string;
  paper: { width: number; height: number };
  frame: SheetRect;
  planArea: PlanRect;
  rightColumn: PlanRect;
  scale: number;
  scaleLabel: string;
  floors: PlanFloor[];
  wallPolygons: Point2D[][][];
  wallSegments: PlanSegment[];
  partitionSegments: PlanSegment[];
  rooms: PlanRoomLabel[];
  openings: PlanOpening[];
  devices: PlanDeviceSymbol[];
  routes: PlanRoutePath[];
  panel: { x: number; y: number; rotationDeg: number; label: string } | null;
  dimensions: PlanDimension[];
  legend: {
    rect: PlanRect;
    title: string;
    entries: PlanLegendEntry[];
    rowHeight: number;
    truncated: number;
  };
  schedule: PlanTable;
  notesBlock: SheetRect;
  notesTitle: string;
  notesLines: string[];
  document: SheetDocumentBlock;
}

const PLAN_AREA: PlanRect = { x: 25, y: 40, width: 280, height: 188 };
const RIGHT_COLUMN: PlanRect = { x: 310, y: 40, width: 102, height: 188 };
const SCALE_STEPS = [50, 75, 100, 150, 200, 250, 300, 400, 500];
const LEGEND_LIMIT = 12;
const RIGHT_ROW_GAP = 4;

const GROUP_TITLES: Record<PlanMode, { title: string; subtitle: string; designation: string; sheet: string }> = {
  power: {
    title: 'План розеточных сетей',
    subtitle: 'план расположения',
    designation: 'ЭС-05',
    sheet: '6',
  },
  lighting: {
    title: 'План осветительных сетей',
    subtitle: 'план расположения',
    designation: 'ЭС-06',
    sheet: '7',
  },
};

function num(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function areaLabel(rooms: RoomZone[]): string {
  const area = rooms.reduce(
    (sum, room) => sum + calculateNetAreaM2(room.vertices, room.holes ?? []),
    0
  );
  return `${num(area, 1)} м²`;
}

function groupsFor(mode: PlanMode): Array<'socket' | 'switch' | 'light'> {
  return mode === 'power' ? ['socket'] : ['switch', 'light'];
}

function lineInMode(purpose: string, mode: PlanMode): boolean {
  return mode === 'power' ? purpose !== 'lighting' : purpose === 'lighting';
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function expand(bounds: Bounds, marginMm: number): Bounds {
  return {
    minX: bounds.minX - marginMm,
    minY: bounds.minY - marginMm,
    maxX: bounds.maxX + marginMm,
    maxY: bounds.maxY + marginMm,
  };
}

function collectBounds(source: PlanSheetSource): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (point: Point2D) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const polygon of source.autoLayout?.wallMesh ?? []) {
    for (const ring of polygon) for (const point of ring) include(point);
  }
  if (minX === Infinity) {
    for (const room of source.rooms) for (const point of room.vertices) include(point);
  }
  if (minX === Infinity) {
    for (const device of source.devices) {
      if (device.anchor.kind === 'room_point') include(device.anchor);
    }
  }
  if (minX === Infinity) return null;
  return expand({ minX, minY, maxX, maxY }, 250);
}

function chooseScale(bounds: Bounds): number {
  const widthMm = Math.max(1, bounds.maxX - bounds.minX);
  const heightMm = Math.max(1, bounds.maxY - bounds.minY);
  const fitWidth = PLAN_AREA.width - 24;
  const fitHeight = PLAN_AREA.height - 18;
  for (const step of SCALE_STEPS) {
    if (widthMm / step <= fitWidth && heightMm / step <= fitHeight) return step;
  }
  const needed = Math.max(widthMm / fitWidth, heightMm / fitHeight);
  return Math.ceil(needed / 10) * 10;
}

function polylineLength(points: Point2D[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

function midpointOfLongest(paths: Point2D[][]): Point2D | null {
  let best: Point2D[] | null = null;
  let bestLength = -1;
  for (const path of paths) {
    const length = polylineLength(path);
    if (length > bestLength) {
      best = path;
      bestLength = length;
    }
  }
  if (!best || best.length === 0) return null;
  let remaining = bestLength / 2;
  for (let index = 1; index < best.length; index += 1) {
    const segmentLength = distance(best[index - 1], best[index]);
    if (remaining <= segmentLength || index === best.length - 1) {
      const ratio = segmentLength > 0 ? remaining / segmentLength : 0;
      return {
        x: best[index - 1].x + (best[index].x - best[index - 1].x) * ratio,
        y: best[index - 1].y + (best[index].y - best[index - 1].y) * ratio,
      };
    }
    remaining -= segmentLength;
  }
  return best[0];
}

function legendRowHeight(count: number): number {
  if (count > 9) return 3.7;
  if (count > 6) return 4.2;
  return 4.7;
}

function tableLines(
  rect: PlanRect,
  columns: PlanTableColumn[],
  headerHeight: number,
  rowHeight: number,
  rowCount: number
): SheetStampLine[] {
  const lines: SheetStampLine[] = [
    {
      x1: rect.x,
      y1: rect.y + headerHeight,
      x2: rect.x + rect.width,
      y2: rect.y + headerHeight,
      weight: 0.45,
    },
  ];
  for (let index = 1; index < rowCount; index += 1) {
    const y = rect.y + headerHeight + rowHeight * index;
    lines.push({ x1: rect.x, y1: y, x2: rect.x + rect.width, y2: y, weight: 0.2 });
  }
  let columnX = rect.x;
  for (const column of columns.slice(0, -1)) {
    columnX += column.width;
    lines.push({
      x1: columnX,
      y1: rect.y,
      x2: columnX,
      y2: rect.y + rect.height,
      weight: 0.2,
    });
  }
  return lines;
}

export function buildPlanSheet(
  source: PlanSheetSource,
  options: PlanSheetOptions = {}
): PlanSheetLayout {
  const { mode } = source;
  const groups = groupsFor(mode);
  const panel = source.panel;
  const lineColorMap = buildLineColorMap(panel);
  const lineIndexById = new Map<string, number>();
  panel?.lines.forEach((line, index) => lineIndexById.set(line.id, index + 1));
  const lineIndexByDevice = new Map<string, number>();
  const lineIdByDevice = new Map<string, string>();
  for (const line of panel?.lines ?? []) {
    for (const deviceId of line.deviceIds) {
      if (!lineIndexByDevice.has(deviceId)) {
        lineIndexByDevice.set(deviceId, lineIndexById.get(line.id) ?? 0);
        lineIdByDevice.set(deviceId, line.id);
      }
    }
  }

  const roomById = new Map(source.rooms.map((room) => [room.id, room]));
  const bounds = collectBounds(source);
  const scale = options.scale ?? (bounds ? chooseScale(bounds) : 100);
  const centerX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
  const centerY = bounds ? (bounds.minY + bounds.maxY) / 2 : 0;
  const originX = PLAN_AREA.x + PLAN_AREA.width / 2;
  const originY = PLAN_AREA.y + PLAN_AREA.height / 2 - 3;
  const toSheet = (point: Point2D): Point2D => ({
    x: originX + (point.x - centerX) / scale,
    y: originY + (point.y - centerY) / scale,
  });
  const mapRing = (ring: Point2D[]): Point2D[] => ring.map(toSheet);

  const floors: PlanFloor[] =
    source.autoLayout && source.autoLayout.floors.length > 0
      ? source.autoLayout.floors.map((floor) => ({
          rings: floor.rings.map(mapRing),
        }))
      : source.rooms.map((room) => ({
          rings: [mapRing(room.vertices), ...(room.holes ?? []).map(mapRing)],
        }));

  const wallPolygons = (source.autoLayout?.wallMesh ?? []).map((polygon) =>
    polygon.map(mapRing)
  );

  const wallSegments: PlanSegment[] = [];
  if (wallPolygons.length === 0) {
    for (const wall of source.walls) {
      const a = source.nodes[wall.nodeAId];
      const b = source.nodes[wall.nodeBId];
      if (!a || !b) continue;
      const p1 = toSheet(a);
      const p2 = toSheet(b);
      wallSegments.push({
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        width: Math.max(0.35, wall.thicknessMm / scale),
      });
    }
  }
  const partitionSegments: PlanSegment[] = source.partitions.map((partition) => {
    const p1 = toSheet(partition.p1);
    const p2 = toSheet(partition.p2);
    return {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      width: Math.max(0.4, partition.thicknessMm / scale),
    };
  });

  const rooms: PlanRoomLabel[] = source.rooms.map((room) => {
    const centroid = calculateCentroid(room.vertices);
    const point = toSheet(centroid);
    return {
      roomId: room.id,
      name: room.name,
      x: point.x,
      y: point.y,
      areaLabel: `${num(calculateNetAreaM2(room.vertices, room.holes ?? []), 1)} м²`,
    };
  });

  const openings: PlanOpening[] = source.openings.map((opening) => {
    const dx = opening.p2.x - opening.p1.x;
    const dy = opening.p2.y - opening.p1.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const half = Math.max(0.5, opening.wallThicknessMm / scale / 2);
    const p1 = toSheet(opening.p1);
    const p2 = toSheet(opening.p2);
    const tick = (point: Point2D): SheetStampLine => ({
      x1: point.x - nx * half,
      y1: point.y - ny * half,
      x2: point.x + nx * half,
      y2: point.y + ny * half,
      weight: 0.3,
    });
    const middle =
      opening.type === 'window'
        ? {
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y,
            weight: 0.22,
          }
        : null;
    return {
      id: opening.id,
      type: opening.type,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      clearWidth: Math.max(1.1, opening.wallThicknessMm / scale + 0.7),
      ticks: [tick(p1), tick(p2)],
      middleLine: middle,
    };
  });

  const devices: PlanDeviceSymbol[] = [];
  for (const device of source.devices) {
    const entry = DEVICE_CATALOG[device.type];
    if (!groups.includes(entry.group)) continue;
    const resolved = resolveDevice(
      device,
      source.rooms,
      source.partitions,
      source.wallThicknessMm
    );
    if (!resolved) continue;
    const lineIndex = lineIndexByDevice.get(device.id) ?? null;
    const isCeiling = entry.mounting === 'ceiling';
    const heightLabel = isCeiling ? 'пот.' : String(device.heightFromFloorMm);
    for (const pose of resolved.poses) {
      const point = toSheet(pose.position);
      const radians = (pose.rotationDeg * Math.PI) / 180;
      const offset = isCeiling ? 0 : 4.4;
      const labelX =
        point.x + (isCeiling ? 0 : -Math.sin(radians) * offset);
      const labelY =
        point.y + (isCeiling ? 4.2 : Math.cos(radians) * offset + 0.6);
      devices.push({
        id: device.id,
        type: device.type,
        glyph: entry.glyph,
        x: point.x,
        y: point.y,
        rotationDeg: pose.rotationDeg,
        mirrored: pose.mirrored,
        roomId: pose.roomId,
        roomName: roomById.get(pose.roomId)?.name ?? '—',
        lineIndex,
        heightLabel,
        labelX,
        labelY,
      });
    }
  }

  const routes: PlanRoutePath[] = [];
  for (const line of panel?.lines ?? []) {
    if (!lineInMode(line.purpose, mode)) continue;
    const route = source.routes.get(line.id);
    if (!route || route.paths.length === 0) continue;
    const labelPoint = midpointOfLongest(route.paths);
    if (!labelPoint) continue;
    const label = toSheet(labelPoint);
    const paths = route.paths.map((path) => path.map(toSheet));
    for (const path of paths) {
      routes.push({
        lineId: line.id,
        index: lineIndexById.get(line.id) ?? 0,
        name: line.name,
        color: lineColorMap.get(line.id) ?? '#475569',
        routing: route.mode,
        points: path,
        labelX: label.x,
        labelY: label.y,
      });
    }
  }

  const panelPose = panel
    ? resolvePanelPose(panel, source.rooms, source.partitions, source.wallThicknessMm)
    : null;
  const panelPoint = panelPose ? toSheet(panelPose.position) : null;

  const dimensions: PlanDimension[] = [];
  if (bounds) {
    const topLeft = toSheet({ x: bounds.minX, y: bounds.minY });
    const bottomRight = toSheet({ x: bounds.maxX, y: bounds.maxY });
    const widthMm = Math.round((bounds.maxX - bounds.minX) / 10) * 10;
    const heightMm = Math.round((bounds.maxY - bounds.minY) / 10) * 10;
    const tick = (x: number, y: number): SheetStampLine => ({
      x1: x - 1.1,
      y1: y + 1.1,
      x2: x + 1.1,
      y2: y - 1.1,
      weight: 0.35,
    });
    const dimY = Math.min(PLAN_AREA.y + PLAN_AREA.height - 2, bottomRight.y + 8);
    dimensions.push({
      x1: topLeft.x,
      y1: dimY,
      x2: bottomRight.x,
      y2: dimY,
      text: `${widthMm} мм`,
      textX: (topLeft.x + bottomRight.x) / 2,
      textY: dimY - 1.3,
      textAngle: 0,
      ticks: [tick(topLeft.x, dimY), tick(bottomRight.x, dimY)],
      extensions: [
        {
          x1: topLeft.x,
          y1: Math.min(bottomRight.y, dimY - 6),
          x2: topLeft.x,
          y2: dimY + 1.2,
          weight: 0.22,
        },
        {
          x1: bottomRight.x,
          y1: Math.min(bottomRight.y, dimY - 6),
          x2: bottomRight.x,
          y2: dimY + 1.2,
          weight: 0.22,
        },
      ],
    });
    const dimX = Math.max(PLAN_AREA.x + 2, topLeft.x - 8);
    dimensions.push({
      x1: dimX,
      y1: topLeft.y,
      x2: dimX,
      y2: bottomRight.y,
      text: `${heightMm} мм`,
      textX: dimX - 1.3,
      textY: (topLeft.y + bottomRight.y) / 2,
      textAngle: -90,
      ticks: [tick(dimX, topLeft.y), tick(dimX, bottomRight.y)],
      extensions: [
        {
          x1: Math.max(PLAN_AREA.x, dimX - 6),
          y1: topLeft.y,
          x2: dimX + 1.2,
          y2: topLeft.y,
          weight: 0.22,
        },
        {
          x1: Math.max(PLAN_AREA.x, dimX - 6),
          y1: bottomRight.y,
          x2: dimX + 1.2,
          y2: bottomRight.y,
          weight: 0.22,
        },
      ],
    });
  }

  const planDevicesCount = new Set(devices.map((device) => device.id)).size;
  const panelLabel = panel?.name ?? 'Щиток';
  const title = GROUP_TITLES[mode].title;
  const lineCount = panel
    ? panel.lines.filter((line) => lineInMode(line.purpose, mode)).length
    : 0;
  const subtitle = `${panelLabel} · ${lineCount} ${plural(
    lineCount,
    'группа',
    'группы',
    'групп'
  )} · ${planDevicesCount} ${plural(
    planDevicesCount,
    'прибор',
    'прибора',
    'приборов'
  )} · ${areaLabel(source.rooms)}`;

  const legendTypes: ElectricalDevice['type'][] = [];
  for (const device of devices) {
    if (!legendTypes.includes(device.type)) legendTypes.push(device.type);
  }
  legendTypes.sort(
    (a, b) =>
      DEVICE_CATALOG[a].section.localeCompare(DEVICE_CATALOG[b].section) ||
      DEVICE_CATALOG[a].order - DEVICE_CATALOG[b].order
  );
  const shownTypes = legendTypes.slice(0, LEGEND_LIMIT);
  const legendHeight = 5.6 + shownTypes.length * legendRowHeight(shownTypes.length);
  const legend: PlanSheetLayout['legend'] = {
    rect: {
      x: RIGHT_COLUMN.x,
      y: RIGHT_COLUMN.y,
      width: RIGHT_COLUMN.width,
      height: legendHeight,
    },
    title: 'Условные обозначения',
    entries: shownTypes.map((type, index) => ({
      type,
      label: DEVICE_CATALOG[type].shortLabel,
      x: RIGHT_COLUMN.x + 3,
      y: RIGHT_COLUMN.y + 8.6 + index * legendRowHeight(shownTypes.length),
      glyph: DEVICE_CATALOG[type].glyph,
    })),
    rowHeight: legendRowHeight(shownTypes.length),
    truncated: Math.max(0, legendTypes.length - shownTypes.length),
  };

  const scheduleTop = legend.rect.y + legend.rect.height + RIGHT_ROW_GAP;
  const scheduleColumns: PlanTableColumn[] = [
    { id: 'no', label: '№', width: 6, align: 'middle' },
    { id: 'name', label: 'Наименование', width: 46, align: 'start' },
    { id: 'room', label: 'Пом.', width: 20, align: 'start' },
    { id: 'height', label: 'H', width: 9, align: 'middle' },
    { id: 'line', label: 'Гр.', width: 8, align: 'middle' },
    { id: 'qty', label: 'Кол.', width: 9, align: 'end' },
  ];
  const scheduleWidth = scheduleColumns.reduce((sum, column) => sum + column.width, 0);

  interface DeviceGroup {
    type: ElectricalDevice['type'];
    roomName: string;
    height: string;
    line: string;
    count: number;
  }
  const groupKey = (device: PlanDeviceSymbol, withRoom: boolean, withLine: boolean) =>
    [
      device.type,
      withRoom ? device.roomName : '—',
      device.heightLabel,
      withLine ? (device.lineIndex ?? '—') : '—',
    ].join('|');
  const groupDevices = (
    withRoom: boolean,
    withLine: boolean
  ): DeviceGroup[] => {
    const map = new Map<string, DeviceGroup>();
    for (const device of devices) {
      const key = groupKey(device, withRoom, withLine);
      const entry = map.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        map.set(key, {
          type: device.type,
          roomName: withRoom ? device.roomName : '—',
          height: device.heightLabel,
          line: withLine && device.lineIndex ? String(device.lineIndex) : '—',
          count: 1,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        DEVICE_CATALOG[a.type].section.localeCompare(DEVICE_CATALOG[b.type].section) ||
        DEVICE_CATALOG[a.type].order - DEVICE_CATALOG[b.type].order ||
        a.roomName.localeCompare(b.roomName, 'ru') ||
        a.height.localeCompare(b.height, 'ru')
    );
  };

  const scheduleAvailable = RIGHT_COLUMN.y + RIGHT_COLUMN.height - scheduleTop - 9;
  const maxRows = Math.max(1, Math.floor((scheduleAvailable - 2) / 3.2));
  let groupRows = groupDevices(true, true);
  if (groupRows.length > maxRows) groupRows = groupDevices(true, false);
  if (groupRows.length > maxRows) groupRows = groupDevices(false, false);
  const scheduleRows = groupRows.slice(0, maxRows);
  const rowHeight = scheduleRows.length
    ? Math.max(
        3.2,
        Math.min(5.2, (scheduleAvailable - 2) / scheduleRows.length)
      )
    : 4.2;
  const scheduleRect: PlanRect = {
    x: RIGHT_COLUMN.x,
    y: scheduleTop,
    width: scheduleWidth,
    height: 9 + scheduleRows.length * rowHeight,
  };
  const schedule: PlanTable = {
    title: 'Ведомость приборов',
    rect: scheduleRect,
    columns: scheduleColumns,
    headerHeight: 9,
    rowHeight,
    rows: scheduleRows.map((row, index) => ({
      cells: [
        String(index + 1),
        DEVICE_CATALOG[row.type].shortLabel,
        row.roomName,
        row.height,
        row.line,
        String(row.count),
      ],
    })),
    lines: tableLines(
      scheduleRect,
      scheduleColumns,
      9,
      rowHeight,
      scheduleRows.length
    ),
    emptyLabel: devices.length === 0 ? 'На этом плане приборов нет' : undefined,
  };

  const date =
    options.date ?? new Intl.DateTimeFormat('ru-RU').format(new Date());

  const sections = new Set(
    devices.map((device) => DEVICE_CATALOG[device.type].section)
  );
  const cableBrand = panel?.supply.cableBrand ?? 'ВВГнг(А)-LS';
  const notesLines = [
    'Высоты установки указаны над полом; у светильников — «пот.» (на потолке).',
    'Приборы привязаны к стенам и осям помещений; размеры на плане — в мм.',
    `Групповые линии — ${cableBrand}; сплошная линия — потолок, пунктир — пол.`,
    'Трассы показаны схематично; крепление и штробление уточняются при монтаже.',
    'Монтаж и проверку выполнять по ПУЭ-7 и СП 256.1325800.2016.',
    'Лист не является исполнительной схемой; привязки уточняются на объекте.',
  ];

  return {
    mode,
    title,
    subtitle: `${subtitle}${
      sections.size === 0 ? ' · приборы не заданы' : ''
    }`,
    paper: { width: A3_WIDTH_MM, height: A3_HEIGHT_MM },
    frame: { ...SHEET_FRAME },
    planArea: { ...PLAN_AREA },
    rightColumn: { ...RIGHT_COLUMN },
    scale,
    scaleLabel: `1:${scale}`,
    floors,
    wallPolygons,
    wallSegments,
    partitionSegments,
    rooms,
    openings,
    devices,
    routes,
    panel: panelPoint
      ? {
          x: panelPoint.x,
          y: panelPoint.y,
          rotationDeg: panelPose?.rotationDeg ?? 0,
          label: panelLabel,
        }
      : null,
    dimensions,
    legend,
    schedule,
    notesBlock: { ...SHEET_NOTES_BLOCK },
    notesTitle: 'Примечания',
    notesLines,
    document: buildSheetDocumentBlock({
      title: GROUP_TITLES[mode].title,
      subtitle: `${GROUP_TITLES[mode].subtitle} · М 1:${scale}`,
      objectTitle: panelLabel,
      designation: GROUP_TITLES[mode].designation,
      basis: 'ГОСТ 21.613-2014 · ГОСТ 2.301-68 · ПУЭ-7',
      date,
      sheet: GROUP_TITLES[mode].sheet,
      sheetTotal: '8',
    }),
  };
}

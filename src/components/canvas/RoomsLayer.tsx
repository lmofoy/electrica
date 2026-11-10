import React, { useMemo } from 'react';
import { Layer, Line, Text, Group, Circle, Shape } from 'react-konva';
import type {
  ApartmentBoundary,
  BoundaryMode,
  RoomZone,
  ShaftCutout,
  Point2D,
} from '../../types';
import type { AutoLayout } from '../../core/geometry/autoLayout';
import { calculateCentroid, calculateNetAreaM2 } from '../../core/geometry/math';

interface RoomsLayerProps {
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  shafts: ShaftCutout[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string) => void;
  zoom: number;
  boundaryMode: BoundaryMode;
  autoLayout: AutoLayout | null;
  grid?: React.ReactNode;
  listening: boolean;
}

export const RoomsLayer: React.FC<RoomsLayerProps> = ({
  apartment,
  rooms,
  shafts,
  selectedRoomId,
  onSelectRoom,
  zoom,
  boundaryMode,
  autoLayout,
  grid,
  listening,
}) => {
  const floorByRoom = useMemo(() => {
    const map = new Map<string, { rings: Point2D[][]; areaM2: number }>();
    if (boundaryMode !== 'auto' || !autoLayout) return map;
    for (const floor of autoLayout.floors) {
      map.set(floor.roomId, { rings: floor.rings, areaM2: floor.areaM2 });
    }
    return map;
  }, [boundaryMode, autoLayout]);

  return (
    <Layer listening={listening}>
      {grid}
      {/* 1. Общий пол квартиры — с вырезами шахт через evenodd */}
      {apartment && apartment.vertices.length >= 3 && (
        <Shape
          fill="#1e293b"
          stroke="#334155"
          strokeWidth={1 / zoom}
          fillRule="evenodd"
          listening={false}
          sceneFunc={(ctx, shape) => {
            const traceRing = (ring: Point2D[]) => {
              if (ring.length < 3) return;
              ctx.moveTo(ring[0].x, ring[0].y);
              for (let i = 1; i < ring.length; i++) {
                ctx.lineTo(ring[i].x, ring[i].y);
              }
              ctx.closePath();
            };

            ctx.beginPath();
            traceRing(apartment.vertices);
            for (const hole of apartment.holes ?? []) {
              traceRing(hole);
            }
            ctx.fillStrokeShape(shape);
          }}
        />
      )}

      {/* 2. Комнаты внутри квартиры — сочные контрастные цвета */}
      {rooms.map((room) => {
        const floor = boundaryMode === 'auto' ? floorByRoom.get(room.id) : null;
        const rings =
          floor && floor.rings.length > 0
            ? floor.rings
            : [room.vertices, ...(room.holes ?? [])];
        const centroid = calculateCentroid(rings[0] ?? room.vertices);
        const areaM2 =
          boundaryMode === 'auto' ? floor?.areaM2 ?? 0 : calculateNetAreaM2(room.vertices, room.holes ?? []);
        const isSelected = room.id === selectedRoomId;

        return (
          <Group key={room.id} onClick={(event) => { if (event.evt.button === 0) onSelectRoom(room.id); }}>
            {/* Заливка пола комнаты (при выделении максимальная яркость и контраст!) */}
            {rings.length > 0 && (
              <Shape
                fill={room.color}
                opacity={isSelected ? 0.95 : 0.65}
                stroke={isSelected ? '#38bdf8' : '#1e293b'}
                strokeWidth={(isSelected ? 4 : 1.5) / zoom}
                shadowColor={isSelected ? '#38bdf8' : undefined}
                shadowBlur={isSelected ? 30 / zoom : 0}
                shadowOpacity={1}
                fillRule="evenodd"
                sceneFunc={(ctx, shape) => {
                  ctx.beginPath();
                  for (const ring of rings) {
                    if (ring.length < 3) continue;
                    ctx.moveTo(ring[0].x, ring[0].y);
                    for (let i = 1; i < ring.length; i++) {
                      ctx.lineTo(ring[i].x, ring[i].y);
                    }
                    ctx.closePath();
                  }
                  ctx.fillStrokeShape(shape);
                }}
              />
            )}

            {/* Маркерные точки на углах выбранной комнаты */}
            {isSelected &&
              room.vertices.map((v, i) => (
                <Circle
                  key={`sel-v-${i}`}
                  x={v.x}
                  y={v.y}
                  radius={6 / zoom}
                  fill="#38bdf8"
                  stroke="#ffffff"
                  strokeWidth={2 / zoom}
                />
              ))}

            {/* Метка с названием и площадью по центру комнаты */}
            <Group x={centroid.x} y={centroid.y}>
              <Text
                text={room.name}
                fontSize={(isSelected ? 17 : 14) / zoom}
                fontStyle="bold"
                fill="#ffffff"
                align="center"
                offsetX={60 / zoom}
                offsetY={20 / zoom}
                width={120 / zoom}
                shadowColor="rgba(0, 0, 0, 0.9)"
                shadowBlur={8 / zoom}
              />
              <Text
                text={`${areaM2.toFixed(2)} м²`}
                fontSize={(isSelected ? 14 : 12) / zoom}
                fontFamily="monospace"
                fontStyle="bold"
                fill={isSelected ? '#38bdf8' : '#f1f5f9'}
                align="center"
                offsetX={60 / zoom}
                offsetY={0}
                width={120 / zoom}
                shadowColor="rgba(0, 0, 0, 0.9)"
                shadowBlur={8 / zoom}
              />
            </Group>
          </Group>
        );
      })}

      {/* 3. Шахты и монолитные колонны */}
      {shafts.map((shaft) => {
        const flatPoints = shaft.vertices.flatMap((v) => [v.x, v.y]);
        const centroid = calculateCentroid(shaft.vertices);

        return (
          <Group key={shaft.id}>
            <Line
              points={flatPoints}
              closed
              fill="#090d16"
              stroke="#ef4444"
              strokeWidth={2 / zoom}
              dash={[8 / zoom, 4 / zoom]}
            />
            {shaft.vertices.length >= 4 && (
              <>
                <Line
                  points={[shaft.vertices[0].x, shaft.vertices[0].y, shaft.vertices[2].x, shaft.vertices[2].y]}
                  stroke="#ef4444"
                  strokeWidth={1 / zoom}
                  opacity={0.6}
                />
                <Line
                  points={[shaft.vertices[1].x, shaft.vertices[1].y, shaft.vertices[3].x, shaft.vertices[3].y]}
                  stroke="#ef4444"
                  strokeWidth={1 / zoom}
                  opacity={0.6}
                />
              </>
            )}
            <Text
              x={centroid.x}
              y={centroid.y}
              text="ШАХТА"
              fontSize={10 / zoom}
              fontStyle="bold"
              fill="#ef4444"
              align="center"
              offsetX={30 / zoom}
              offsetY={5 / zoom}
              width={60 / zoom}
            />
          </Group>
        );
      })}
    </Layer>
  );
};

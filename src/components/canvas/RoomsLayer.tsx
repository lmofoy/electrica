import React from 'react';
import { Layer, Line, Text, Group, Circle } from 'react-konva';
import type { ApartmentBoundary, RoomZone, ShaftCutout } from '../../types';
import { calculateCentroid, calculatePolygonAreaM2 } from '../../core/geometry/math';

interface RoomsLayerProps {
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  shafts: ShaftCutout[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string) => void;
  zoom: number;
}

export const RoomsLayer: React.FC<RoomsLayerProps> = ({
  apartment,
  rooms,
  shafts,
  selectedRoomId,
  onSelectRoom,
  zoom,
}) => {
  return (
    <Layer>
      {/* 1. Общий пол квартиры — аккуратный серенький нейтральный цвет */}
      {apartment && apartment.vertices.length >= 3 && (
        <Group>
          <Line
            points={apartment.vertices.flatMap((v) => [v.x, v.y])}
            closed
            fill="#1e293b"
            stroke="#475569"
            strokeWidth={1.5 / zoom}
          />
        </Group>
      )}

      {/* 2. Комнаты внутри квартиры — сочные контрастные цвета */}
      {rooms.map((room) => {
        const flatPoints = room.vertices.flatMap((v) => [v.x, v.y]);
        const centroid = calculateCentroid(room.vertices);
        const areaM2 = calculatePolygonAreaM2(room.vertices);
        const isSelected = room.id === selectedRoomId;

        return (
          <Group key={room.id} onClick={() => onSelectRoom(room.id)}>
            {/* Заливка пола комнаты (при выделении яркость и сочность резко возрастают!) */}
            <Line
              points={flatPoints}
              closed
              fill={room.color}
              opacity={isSelected ? 0.9 : 0.45}
              stroke={isSelected ? '#38bdf8' : '#334155'}
              strokeWidth={(isSelected ? 4 : 1.5) / zoom}
              shadowColor={isSelected ? '#38bdf8' : undefined}
              shadowBlur={isSelected ? 25 / zoom : 0}
              shadowOpacity={1}
            />

            {/* Маркерные узловые точки на углах выбранной комнаты */}
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
                shadowColor="rgba(0, 0, 0, 0.95)"
                shadowBlur={8 / zoom}
              />
              <Text
                text={`${areaM2.toFixed(2)} м²`}
                fontSize={(isSelected ? 14 : 12) / zoom}
                fontFamily="monospace"
                fontStyle="bold"
                fill={isSelected ? '#38bdf8' : '#e2e8f0'}
                align="center"
                offsetX={60 / zoom}
                offsetY={0}
                width={120 / zoom}
                shadowColor="rgba(0, 0, 0, 0.95)"
                shadowBlur={8 / zoom}
              />
            </Group>
          </Group>
        );
      })}

      {/* 3. Отрисовка шахт и колонн */}
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

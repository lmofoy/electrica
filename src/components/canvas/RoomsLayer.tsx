import React from 'react';
import { Layer, Line, Text, Group } from 'react-konva';
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
      {/* 1. Общий контур квартиры (Рабочая область) */}
      {apartment && apartment.vertices.length >= 3 && (
        <Group>
          {/* Пол квартиры */}
          <Line
            points={apartment.vertices.flatMap((v) => [v.x, v.y])}
            closed
            fill="#090d16"
            stroke="#475569"
            strokeWidth={1 / zoom}
          />
        </Group>
      )}

      {/* 2. Комнаты внутри квартиры */}
      {rooms.map((room) => {
        const flatPoints = room.vertices.flatMap((v) => [v.x, v.y]);
        const centroid = calculateCentroid(room.vertices);
        const areaM2 = calculatePolygonAreaM2(room.vertices);
        const isSelected = room.id === selectedRoomId;

        return (
          <Group key={room.id} onClick={() => onSelectRoom(room.id)}>
            {/* Заливка пола комнаты */}
            <Line
              points={flatPoints}
              closed
              fill={room.color}
              stroke={isSelected ? '#38bdf8' : '#334155'}
              strokeWidth={(isSelected ? 3 : 1) / zoom}
              opacity={0.9}
            />

            {/* Метка по центру комнаты */}
            <Group x={centroid.x} y={centroid.y}>
              <Text
                text={room.name}
                fontSize={15 / zoom}
                fontStyle="bold"
                fill="#f8fafc"
                align="center"
                offsetX={60 / zoom}
                offsetY={20 / zoom}
                width={120 / zoom}
                shadowColor="rgba(0, 0, 0, 0.9)"
                shadowBlur={5 / zoom}
              />
              <Text
                text={`${areaM2.toFixed(2)} м²`}
                fontSize={13 / zoom}
                fontFamily="monospace"
                fill="#94a3b8"
                align="center"
                offsetX={60 / zoom}
                offsetY={0}
                width={120 / zoom}
                shadowColor="rgba(0, 0, 0, 0.9)"
                shadowBlur={5 / zoom}
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
              fill="#020617"
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
                  opacity={0.5}
                />
                <Line
                  points={[shaft.vertices[1].x, shaft.vertices[1].y, shaft.vertices[3].x, shaft.vertices[3].y]}
                  stroke="#ef4444"
                  strokeWidth={1 / zoom}
                  opacity={0.5}
                />
              </>
            )}
            <Text
              x={centroid.x}
              y={centroid.y}
              text="ШАХТА"
              fontSize={10 / zoom}
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

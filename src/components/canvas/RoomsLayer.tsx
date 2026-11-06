import React from 'react';
import { Layer, Line, Text, Group } from 'react-konva';
import type { RoomZone, ShaftCutout } from '../../types';
import { calculateCentroid, calculatePolygonAreaM2 } from '../../core/geometry/math';

interface RoomsLayerProps {
  rooms: RoomZone[];
  shafts: ShaftCutout[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string) => void;
  zoom: number;
}

export const RoomsLayer: React.FC<RoomsLayerProps> = ({
  rooms,
  shafts,
  selectedRoomId,
  onSelectRoom,
  zoom,
}) => {
  return (
    <Layer>
      {/* Отрисовка комнат */}
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
              stroke={isSelected ? '#60a5fa' : '#334155'}
              strokeWidth={(isSelected ? 3 : 1) / zoom}
              opacity={0.9}
            />

            {/* Метка с названием и площадью в м² по центру комнаты */}
            <Group x={centroid.x} y={centroid.y}>
              <Text
                text={room.name}
                fontSize={16 / zoom}
                fontStyle="bold"
                fill="#f8fafc"
                align="center"
                offsetX={60 / zoom}
                offsetY={20 / zoom}
                width={120 / zoom}
                shadowColor="rgba(0, 0, 0, 0.8)"
                shadowBlur={4 / zoom}
              />
              <Text
                text={`${areaM2.toFixed(2)} м²`}
                fontSize={13 / zoom}
                fill="#94a3b8"
                align="center"
                offsetX={60 / zoom}
                offsetY={0}
                width={120 / zoom}
                shadowColor="rgba(0, 0, 0, 0.8)"
                shadowBlur={4 / zoom}
              />
            </Group>
          </Group>
        );
      })}

      {/* Отрисовка вырезанных шахт / колонн */}
      {shafts.map((shaft) => {
        const flatPoints = shaft.vertices.flatMap((v) => [v.x, v.y]);
        const centroid = calculateCentroid(shaft.vertices);

        return (
          <Group key={shaft.id}>
            <Line
              points={flatPoints}
              closed
              fill="#0f172a"
              stroke="#ef4444"
              strokeWidth={2 / zoom}
              dash={[10 / zoom, 5 / zoom]}
            />
            {/* Крест-накрест для обозначения шахты по чертежным стандартам */}
            {shaft.vertices.length >= 4 && (
              <>
                <Line
                  points={[shaft.vertices[0].x, shaft.vertices[0].y, shaft.vertices[2].x, shaft.vertices[2].y]}
                  stroke="#ef4444"
                  strokeWidth={1 / zoom}
                  opacity={0.4}
                />
                <Line
                  points={[shaft.vertices[1].x, shaft.vertices[1].y, shaft.vertices[3].x, shaft.vertices[3].y]}
                  stroke="#ef4444"
                  strokeWidth={1 / zoom}
                  opacity={0.4}
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

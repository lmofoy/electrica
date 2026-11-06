import React from 'react';
import { Layer, Line, Text, Group } from 'react-konva';
import type { ApartmentBoundary, RoomZone, Point2D } from '../../types';
import {
  distance,
  angleDeg,
  computeOutwardWallPolygon,
} from '../../core/geometry/math';

interface WallsAndDimensionsLayerProps {
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  defaultWallThicknessMm: number;
  zoom: number;
}

export const WallsAndDimensionsLayer: React.FC<WallsAndDimensionsLayerProps> = ({
  apartment,
  rooms,
  defaultWallThicknessMm,
  zoom,
}) => {
  // Вспомогательная функция отрисовки размерных цепочек для замкнутого контура
  const renderDimensionChain = (
    vertices: Point2D[],
    keyPrefix: string,
    color: string,
    offsetDist: number
  ) => {
    const n = vertices.length;
    if (n < 2) return null;

    const elements: React.ReactNode[] = [];

    for (let i = 0; i < n; i++) {
      const p1 = vertices[i];
      const p2 = vertices[(i + 1) % n];
      const distMm = Math.round(distance(p1, p2));
      if (distMm < 50) continue;

      const angle = angleDeg(p1, p2);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      const nx = -dy / len;
      const ny = dx / len;

      const dimP1: Point2D = { x: p1.x + nx * offsetDist, y: p1.y + ny * offsetDist };
      const dimP2: Point2D = { x: p2.x + nx * offsetDist, y: p2.y + ny * offsetDist };

      const midX = (dimP1.x + dimP2.x) / 2;
      const midY = (dimP1.y + dimP2.y) / 2;

      const tickLen = 65;
      const tickRad = ((angle + 45) * Math.PI) / 180;
      const tdx = (Math.cos(tickRad) * tickLen) / 2;
      const tdy = (Math.sin(tickRad) * tickLen) / 2;

      let textAngle = angle;
      if (textAngle > 90 || textAngle < -90) {
        textAngle += 180;
      }

      elements.push(
        <Group key={`${keyPrefix}-dim-${i}`}>
          {/* Выносные засечки */}
          <Line
            points={[p1.x, p1.y, dimP1.x, dimP1.y]}
            stroke="#475569"
            strokeWidth={1 / zoom}
            opacity={0.4}
          />
          <Line
            points={[p2.x, p2.y, dimP2.x, dimP2.y]}
            stroke="#475569"
            strokeWidth={1 / zoom}
            opacity={0.4}
          />

          {/* Главная размерная линия */}
          <Line
            points={[dimP1.x, dimP1.y, dimP2.x, dimP2.y]}
            stroke={color}
            strokeWidth={1.5 / zoom}
          />

          {/* Засечки 45° */}
          <Line
            points={[dimP1.x - tdx, dimP1.y - tdy, dimP1.x + tdx, dimP1.y + tdy]}
            stroke={color}
            strokeWidth={2 / zoom}
          />
          <Line
            points={[dimP2.x - tdx, dimP2.y - tdy, dimP2.x + tdx, dimP2.y + tdy]}
            stroke={color}
            strokeWidth={2 / zoom}
          />

          {/* Размер в миллиметрах */}
          <Group x={midX} y={midY} rotation={textAngle}>
            <Text
              text={distMm.toLocaleString('ru-RU')}
              fontSize={13 / zoom}
              fontFamily="monospace"
              fontStyle="bold"
              fill={color}
              align="center"
              verticalAlign="middle"
              offsetX={40 / zoom}
              offsetY={18 / zoom}
              width={80 / zoom}
              shadowColor="#020617"
              shadowBlur={6 / zoom}
            />
          </Group>
        </Group>
      );
    }

    return elements;
  };

  return (
    <Layer listening={false}>
      {/* 1. Наружные несущие стены квартиры (Строго наружу от чистового контура) */}
      {apartment && apartment.vertices.length >= 3 && (() => {
        const extThickness = apartment.exteriorWallThicknessMm || 250;
        const outerApt = computeOutwardWallPolygon(apartment.vertices, extThickness);

        return (
          <Group>
            {/* Массив толщины наружной стены (заливка между внутренним и внешним контуром) */}
            <Line
              points={outerApt.flatMap((v) => [v.x, v.y])}
              closed
              fill="#1e293b"
              stroke="#64748b"
              strokeWidth={2 / zoom}
            />

            {/* Внутренняя чистовая грань стен квартиры (граница пола) */}
            <Line
              points={apartment.vertices.flatMap((v) => [v.x, v.y])}
              closed
              stroke="#cbd5e1"
              strokeWidth={2 / zoom}
            />

            {/* Внешние габаритные размеры квартиры снаружи */}
            {renderDimensionChain(
              apartment.vertices,
              'apt-ext',
              '#fbbf24',
              extThickness + 220
            )}
          </Group>
        );
      })()}

      {/* 2. Межкомнатные стены комнат (Толщина строго наружу от контура пола) */}
      {rooms.map((room) => {
        const thickness = room.wallThicknessMm || defaultWallThicknessMm;
        const outerRoom = computeOutwardWallPolygon(room.vertices, thickness);

        return (
          <Group key={`walls-${room.id}`}>
            {/* Внешний контур толщины стены (перегородки) */}
            <Line
              points={outerRoom.flatMap((v) => [v.x, v.y])}
              closed
              stroke="#475569"
              strokeWidth={1.5 / zoom}
              dash={[6 / zoom, 3 / zoom]}
              opacity={0.8}
            />

            {/* Внутренняя чистовая грань стены комнаты */}
            <Line
              points={room.vertices.flatMap((v) => [v.x, v.y])}
              closed
              stroke="#94a3b8"
              strokeWidth={2 / zoom}
            />

            {/* Внутренние размеры комнат */}
            {renderDimensionChain(room.vertices, room.id, '#38bdf8', 190)}
          </Group>
        );
      })}
    </Layer>
  );
};

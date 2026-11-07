import React, { useMemo } from 'react';
import { Layer, Shape, Line, Text, Group } from 'react-konva';
import type { ApartmentBoundary, RoomZone, Point2D } from '../../types';
import { distance, angleDeg, computeOutwardWallPolygon } from '../../core/geometry/math';

interface WallsAndDimensionsLayerProps {
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  defaultWallThicknessMm: number;
  zoom: number;
}

/**
 * Создает изображение с архитектурной диагональной штриховкой под 45°
 */
function createHatchImage(strokeColor = '#64748b', bgColor = '#1e293b', size = 80): HTMLImageElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 4;
    ctx.beginPath();

    // Диагональные линии под 45 градусов
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);

    ctx.moveTo(-size / 2, size / 2);
    ctx.lineTo(size / 2, -size / 2);

    ctx.moveTo(size / 2, size * 1.5);
    ctx.lineTo(size * 1.5, size / 2);

    ctx.stroke();
  }
  const img = new Image();
  img.src = canvas.toDataURL();
  return img;
}

export const WallsAndDimensionsLayer: React.FC<WallsAndDimensionsLayerProps> = ({
  apartment,
  rooms,
  defaultWallThicknessMm,
  zoom,
}) => {
  // Архитектурная штриховка
  const hatchPattern = useMemo(() => {
    return createHatchImage('#64748b', '#1e293b', 80);
  }, []);

  // Отрисовка размерных цепочек
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
          <Line
            points={[p1.x, p1.y, dimP1.x, dimP1.y]}
            stroke="#64748b"
            strokeWidth={1 / zoom}
            opacity={0.5}
          />
          <Line
            points={[p2.x, p2.y, dimP2.x, dimP2.y]}
            stroke="#64748b"
            strokeWidth={1 / zoom}
            opacity={0.5}
          />

          <Line
            points={[dimP1.x, dimP1.y, dimP2.x, dimP2.y]}
            stroke={color}
            strokeWidth={1.5 / zoom}
          />

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
      {/* 1. НАРУЖНЫЕ СТЕНЫ КВАРТИРЫ: Полое тело со штриховкой между наружным и внутренним контуром */}
      {apartment && apartment.vertices.length >= 3 && (() => {
        const extThickness = apartment.exteriorWallThicknessMm || 250;
        const outerApt = computeOutwardWallPolygon(apartment.vertices, extThickness);
        const innerApt = apartment.vertices;

        return (
          <Group key="apartment-walls-group">
            {/* Полый контур стены со штриховкой под 45° (внутри квартиры штриховки НЕТ!) */}
            <Shape
              sceneFunc={(context, shape) => {
                context.beginPath();
                // Внешний контур
                for (let i = 0; i < outerApt.length; i++) {
                  if (i === 0) context.moveTo(outerApt[i].x, outerApt[i].y);
                  else context.lineTo(outerApt[i].x, outerApt[i].y);
                }
                context.closePath();

                // Внутренний вырез (чистовой пол квартиры)
                for (let i = 0; i < innerApt.length; i++) {
                  if (i === 0) context.moveTo(innerApt[i].x, innerApt[i].y);
                  else context.lineTo(innerApt[i].x, innerApt[i].y);
                }
                context.closePath();

                // Правило evenodd заливает ТОЛЬКО толщину стены!
                context.fillStrokeShape(shape);
              }}
              fillPatternImage={hatchPattern}
              fillPatternRepeat="repeat"
              fillRule="evenodd"
              stroke="#64748b"
              strokeWidth={2 / zoom}
            />

            {/* Внутренняя чистовая кромка стены квартиры */}
            <Line
              points={innerApt.flatMap((v) => [v.x, v.y])}
              closed
              stroke="#cbd5e1"
              strokeWidth={2 / zoom}
            />

            {/* Внешние габаритные размеры квартиры */}
            {renderDimensionChain(
              apartment.vertices,
              'apt-ext',
              '#fbbf24',
              extThickness + 220
            )}
          </Group>
        );
      })()}

      {/* 2. ПЕРЕГОРОДКИ КОМНАТ: Полое тело перегородки со штриховкой */}
      {rooms.map((room) => {
        if (room.vertices.length < 3) return null;
        const thickness = room.wallThicknessMm || defaultWallThicknessMm;
        const outerRoom = computeOutwardWallPolygon(room.vertices, thickness);
        const innerRoom = room.vertices;

        return (
          <Group key={`room-wall-group-${room.id}`}>
            {/* Полая стена комнаты со штриховкой 45° */}
            <Shape
              sceneFunc={(context, shape) => {
                context.beginPath();
                // Наружная грань перегородки
                for (let i = 0; i < outerRoom.length; i++) {
                  if (i === 0) context.moveTo(outerRoom[i].x, outerRoom[i].y);
                  else context.lineTo(outerRoom[i].x, outerRoom[i].y);
                }
                context.closePath();

                // Внутренняя грань (чистовой пол комнаты)
                for (let i = 0; i < innerRoom.length; i++) {
                  if (i === 0) context.moveTo(innerRoom[i].x, innerRoom[i].y);
                  else context.lineTo(innerRoom[i].x, innerRoom[i].y);
                }
                context.closePath();

                context.fillStrokeShape(shape);
              }}
              fillPatternImage={hatchPattern}
              fillPatternRepeat="repeat"
              fillRule="evenodd"
              stroke="#64748b"
              strokeWidth={1.5 / zoom}
            />

            {/* Чистовая грань комнаты */}
            <Line
              points={innerRoom.flatMap((v) => [v.x, v.y])}
              closed
              stroke="#94a3b8"
              strokeWidth={1.5 / zoom}
            />

            {/* Внутренние размеры помещения */}
            {renderDimensionChain(room.vertices, room.id, '#38bdf8', 190)}
          </Group>
        );
      })}
    </Layer>
  );
};

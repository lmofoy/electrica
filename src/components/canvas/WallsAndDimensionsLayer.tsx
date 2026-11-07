import React, { useMemo } from 'react';
import { Layer, Shape, Line, Text, Group } from 'react-konva';
import type { ApartmentBoundary, RoomZone, Point2D } from '../../types';
import { distance, angleDeg } from '../../core/geometry/math';
import { buildMonolithicWallMesh } from '../../core/geometry/wallsGraph';

interface WallsAndDimensionsLayerProps {
  apartment: ApartmentBoundary | null;
  rooms: RoomZone[];
  defaultWallThicknessMm: number;
  zoom: number;
}

/**
 * Архитектурная диагональная штриховка стен под 45°
 */
function createHatchImage(strokeColor = '#64748b', bgColor = '#334155', size = 60): HTMLImageElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.beginPath();

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
    return createHatchImage('#64748b', '#334155', 60);
  }, []);

  // Генерация единого монолитного массива стен (Boolean Union + вычитание комнат)
  const monolithicWallPolys = useMemo(() => {
    const extThickness = apartment?.exteriorWallThicknessMm || 250;
    return buildMonolithicWallMesh(apartment, rooms, defaultWallThicknessMm, extThickness);
  }, [apartment, rooms, defaultWallThicknessMm]);

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
      {/* 1. ЕДИНЫЙ МОНОЛИТНЫЙ МАССИВ СТЕН (CSG Union без задвоений и наложений) */}
      {monolithicWallPolys.map((polyRings, idx) => (
        <Shape
          key={`monolithic-wall-${idx}`}
          sceneFunc={(context, shape) => {
            context.beginPath();

            // polyRings[0] — внешний контур стен здания
            // polyRings[1..k] — внутренние вырезы чистового пола комнат
            for (const ring of polyRings) {
              if (ring.length < 3) continue;
              for (let i = 0; i < ring.length; i++) {
                if (i === 0) context.moveTo(ring[i].x, ring[i].y);
                else context.lineTo(ring[i].x, ring[i].y);
              }
              context.closePath();
            }

            // evenodd оставляет полы комнат 100% чистыми и заливает только тело стен!
            context.fillStrokeShape(shape);
          }}
          fillPatternImage={hatchPattern}
          fillPatternRepeat="repeat"
          fillPriority="pattern"
          fillRule="evenodd"
          stroke="#64748b"
          strokeWidth={1.5 / zoom}
          lineJoin="miter"
          opacity={0.95}
        />
      ))}

      {/* 2. Чистовые внутренние кромки комнат */}
      {rooms.map((room) => (
        <Group key={`room-clean-edges-${room.id}`}>
          <Line
            points={room.vertices.flatMap((v) => [v.x, v.y])}
            closed
            stroke="#94a3b8"
            strokeWidth={1.5 / zoom}
          />
          {renderDimensionChain(room.vertices, room.id, '#38bdf8', 190)}
        </Group>
      ))}

      {/* 3. Чистовой контур квартиры и внешние габаритные размеры */}
      {apartment && apartment.vertices.length >= 3 && (
        <Group>
          <Line
            points={apartment.vertices.flatMap((v) => [v.x, v.y])}
            closed
            stroke="#e2e8f0"
            strokeWidth={2.5 / zoom}
          />
          {renderDimensionChain(
            apartment.vertices,
            'apt-ext',
            '#fbbf24',
            (apartment.exteriorWallThicknessMm || 250) + 220
          )}
        </Group>
      )}
    </Layer>
  );
};

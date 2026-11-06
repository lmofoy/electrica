import React from 'react';
import { Layer, Line, Text, Group } from 'react-konva';
import type { RoomZone, Point2D } from '../../types';
import { distance, angleDeg } from '../../core/geometry/math';

interface WallsAndDimensionsLayerProps {
  rooms: RoomZone[];
  zoom: number;
}

export const WallsAndDimensionsLayer: React.FC<WallsAndDimensionsLayerProps> = ({
  rooms,
  zoom,
}) => {
  return (
    <Layer listening={false}>
      {rooms.map((room) => {
        const vertices = room.vertices;
        const n = vertices.length;
        if (n < 2) return null;

        const wallElements: React.ReactNode[] = [];

        // 1. Отрисовка толстых стен (150 мм в реальном масштабе)
        const flatPoints = vertices.flatMap((v) => [v.x, v.y]);
        wallElements.push(
          <Line
            key={`wall-outline-${room.id}`}
            points={flatPoints}
            closed
            stroke="#94a3b8"
            strokeWidth={room.wallThicknessMm || 150}
            lineCap="square"
            lineJoin="miter"
            opacity={0.8}
          />
        );

        // 2. Отрисовка размерных линий для каждого ребра
        for (let i = 0; i < n; i++) {
          const p1 = vertices[i];
          const p2 = vertices[(i + 1) % n];
          const distMm = Math.round(distance(p1, p2));
          if (distMm < 50) continue; // пропускаем микро-сегменты

          const angle = angleDeg(p1, p2);

          // Вектор направления и единичная нормаль
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy);
          const nx = -dy / len;
          const ny = dx / len;

          // Смещение размерной линии от стены наружу (300 мм)
          const offsetDist = 320;
          const dimP1: Point2D = { x: p1.x + nx * offsetDist, y: p1.y + ny * offsetDist };
          const dimP2: Point2D = { x: p2.x + nx * offsetDist, y: p2.y + ny * offsetDist };

          // Середина для текста размера
          const midX = (dimP1.x + dimP2.x) / 2;
          const midY = (dimP1.y + dimP2.y) / 2;

          // Длина засечки (120 мм)
          const tickLen = 80;
          const tickRad = ((angle + 45) * Math.PI) / 180;
          const tdx = (Math.cos(tickRad) * tickLen) / 2;
          const tdy = (Math.sin(tickRad) * tickLen) / 2;

          // Форматируем число с разделителем тысяч (например, "3 500")
          const formattedDim = distMm.toLocaleString('ru-RU');

          // Угол для читаемости текста (чтобы текст не был вверх ногами)
          let textAngle = angle;
          if (textAngle > 90 || textAngle < -90) {
            textAngle += 180;
          }

          wallElements.push(
            <Group key={`dim-${room.id}-${i}`}>
              {/* Выносные линии от стены к размерной линии */}
              <Line
                points={[p1.x + nx * 50, p1.y + ny * 50, dimP1.x + nx * 50, dimP1.y + ny * 50]}
                stroke="#64748b"
                strokeWidth={1 / zoom}
                opacity={0.5}
              />
              <Line
                points={[p2.x + nx * 50, p2.y + ny * 50, dimP2.x + nx * 50, dimP2.y + ny * 50]}
                stroke="#64748b"
                strokeWidth={1 / zoom}
                opacity={0.5}
              />

              {/* Главная размерная линия */}
              <Line
                points={[dimP1.x, dimP1.y, dimP2.x, dimP2.y]}
                stroke="#38bdf8"
                strokeWidth={1.5 / zoom}
              />

              {/* Засечки под 45 градусов на концах */}
              <Line
                points={[dimP1.x - tdx, dimP1.y - tdy, dimP1.x + tdx, dimP1.y + tdy]}
                stroke="#38bdf8"
                strokeWidth={2 / zoom}
              />
              <Line
                points={[dimP2.x - tdx, dimP2.y - tdy, dimP2.x + tdx, dimP2.y + tdy]}
                stroke="#38bdf8"
                strokeWidth={2 / zoom}
              />

              {/* Текст размера в мм */}
              <Group x={midX} y={midY} rotation={textAngle}>
                <Text
                  text={formattedDim}
                  fontSize={14 / zoom}
                  fontFamily="monospace"
                  fontStyle="bold"
                  fill="#38bdf8"
                  align="center"
                  verticalAlign="middle"
                  offsetX={40 / zoom}
                  offsetY={20 / zoom}
                  width={80 / zoom}
                  shadowColor="#090d16"
                  shadowBlur={5 / zoom}
                />
              </Group>
            </Group>
          );
        }

        return <React.Fragment key={room.id}>{wallElements}</React.Fragment>;
      })}
    </Layer>
  );
};

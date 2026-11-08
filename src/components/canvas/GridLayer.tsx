import React from 'react';
import { Group, Line, Text } from 'react-konva';
import type { Point2D } from '../../types';

interface GridLayerProps {
  width: number;
  height: number;
  zoom: number;
  stagePos: Point2D;
}

export const GridLayer: React.FC<GridLayerProps> = ({ width, height, zoom, stagePos }) => {
  // Вычисляем видимую область экрана в мировых координатах (мм)
  const startX = -stagePos.x / zoom;
  const startY = -stagePos.y / zoom;
  const endX = startX + width / zoom;
  const endY = startY + height / zoom;

  // Адаптивный шаг сетки в зависимости от масштаба
  let minorStepMm = 100; // 10 см
  let majorStepMm = 1000; // 1 метр

  if (zoom < 0.05) {
    minorStepMm = 1000;
    majorStepMm = 5000;
  } else if (zoom < 0.1) {
    minorStepMm = 500;
    majorStepMm = 2000;
  }

  const firstMinorX = Math.floor(startX / minorStepMm) * minorStepMm;
  const lastMinorX = Math.ceil(endX / minorStepMm) * minorStepMm;
  const firstMinorY = Math.floor(startY / minorStepMm) * minorStepMm;
  const lastMinorY = Math.ceil(endY / minorStepMm) * minorStepMm;

  const verticalLines: { points: number[]; isMajor: boolean; label?: string; x: number }[] = [];
  for (let x = firstMinorX; x <= lastMinorX; x += minorStepMm) {
    const isMajor = x % majorStepMm === 0;
    verticalLines.push({
      points: [x, startY, x, endY],
      isMajor,
      label: isMajor ? `${(x / 1000).toFixed(0)} м` : undefined,
      x,
    });
  }

  const horizontalLines: { points: number[]; isMajor: boolean; label?: string; y: number }[] = [];
  for (let y = firstMinorY; y <= lastMinorY; y += minorStepMm) {
    const isMajor = y % majorStepMm === 0;
    horizontalLines.push({
      points: [startX, y, endX, y],
      isMajor,
      label: isMajor ? `${(y / 1000).toFixed(0)} м` : undefined,
      y,
    });
  }

  return (
    <Group listening={false}>
      {/* Мелкая сетка */}
      {verticalLines.map((line, i) => (
        <Line
          key={`v-${i}`}
          points={line.points}
          stroke={line.isMajor ? '#475569' : '#1e293b'}
          strokeWidth={line.isMajor ? 1.5 / zoom : 0.8 / zoom}
          opacity={line.isMajor ? 0.6 : 0.3}
        />
      ))}

      {horizontalLines.map((line, i) => (
        <Line
          key={`h-${i}`}
          points={line.points}
          stroke={line.isMajor ? '#475569' : '#1e293b'}
          strokeWidth={line.isMajor ? 1.5 / zoom : 0.8 / zoom}
          opacity={line.isMajor ? 0.6 : 0.3}
        />
      ))}

      {/* Метки осей и координат (X, Y = 0 выделены ярче) */}
      <Line
        points={[0, startY, 0, endY]}
        stroke="#3b82f6"
        strokeWidth={2 / zoom}
        opacity={0.8}
      />
      <Line
        points={[startX, 0, endX, 0]}
        stroke="#ef4444"
        strokeWidth={2 / zoom}
        opacity={0.8}
      />

      {/* Числовые метки крупных шагов сетки */}
      <Group>
        {verticalLines
          .filter((l) => l.isMajor)
          .map((line, i) => (
            <Text
              key={`vl-${i}`}
              x={line.x + 5 / zoom}
              y={startY + 15 / zoom}
              text={line.label || ''}
              fontSize={11 / zoom}
              fill="#64748b"
            />
          ))}
        {horizontalLines
          .filter((l) => l.isMajor)
          .map((line, i) => (
            <Text
              key={`hl-${i}`}
              x={startX + 15 / zoom}
              y={line.y + 5 / zoom}
              text={line.label || ''}
              fontSize={11 / zoom}
              fill="#64748b"
            />
          ))}
      </Group>
    </Group>
  );
};

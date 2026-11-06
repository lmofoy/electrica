import React from 'react';
import { Layer, Line, Circle, Text, Group } from 'react-konva';
import type { Point2D, DynamicInputState } from '../../types';
import { distance, angleDeg, polarToPoint, snapAngle } from '../../core/geometry/math';

interface DraftingLayerProps {
  draftVertices: Point2D[];
  cursorPosMm: Point2D;
  dynamicInput: DynamicInputState;
  zoom: number;
  isShaftTool: boolean;
}

export const DraftingLayer: React.FC<DraftingLayerProps> = ({
  draftVertices,
  cursorPosMm,
  dynamicInput,
  zoom,
  isShaftTool,
}) => {
  if (draftVertices.length === 0) return null;

  const lastVertex = draftVertices[draftVertices.length - 1];
  const firstVertex = draftVertices[0];

  // Вычисляем свободный угол и дистанцию от последней точки к курсору
  let rawDist = distance(lastVertex, cursorPosMm);
  let rawAngle = angleDeg(lastVertex, cursorPosMm);

  // Применяем привязку угла (если угол не зафиксирован вручную)
  const effectiveAngle =
    dynamicInput.lockedAngle !== null
      ? dynamicInput.lockedAngle
      : snapAngle(rawAngle, 6);

  // Применяем длину (если зафиксирована через Tab/Enter)
  const effectiveLength =
    dynamicInput.lockedLength !== null
      ? dynamicInput.lockedLength
      : rawDist;

  // Итоговая вычисленная точка следующей вершины
  let nextVertex = polarToPoint(lastVertex, effectiveLength, effectiveAngle);

  // Проверка привязки к стартовой точке (замыкание контура)
  const distToStart = distance(nextVertex, firstVertex);
  const isSnapToStart = draftVertices.length >= 2 && distToStart < (25 / zoom); // 25 пикселей экрана
  if (isSnapToStart && dynamicInput.lockedLength === null) {
    nextVertex = { ...firstVertex };
  }

  // Все линии уже установленных сегментов
  const confirmedPoints = draftVertices.flatMap((v) => [v.x, v.y]);

  const colorPrimary = isShaftTool ? '#ef4444' : '#22c55e';

  return (
    <Layer listening={false}>
      {/* Уже зафиксированные сегменты */}
      <Line
        points={confirmedPoints}
        stroke={colorPrimary}
        strokeWidth={3 / zoom}
        lineCap="round"
        lineJoin="round"
      />

      {/* Вершины с точками */}
      {draftVertices.map((v, i) => (
        <Circle
          key={`draft-v-${i}`}
          x={v.x}
          y={v.y}
          radius={(i === 0 ? 8 : 5) / zoom}
          fill={i === 0 ? '#38bdf8' : colorPrimary}
          stroke="#0f172a"
          strokeWidth={2 / zoom}
        />
      ))}

      {/* Резиновая линия к курсору */}
      <Line
        points={[lastVertex.x, lastVertex.y, nextVertex.x, nextVertex.y]}
        stroke={colorPrimary}
        strokeWidth={2 / zoom}
        dash={[8 / zoom, 4 / zoom]}
      />

      {/* Окружность радиуса, если длина зафиксирована */}
      {dynamicInput.lockedLength !== null && (
        <Circle
          x={lastVertex.x}
          y={lastVertex.y}
          radius={dynamicInput.lockedLength}
          stroke="#38bdf8"
          strokeWidth={1 / zoom}
          dash={[6 / zoom, 6 / zoom]}
          opacity={0.4}
        />
      )}

      {/* Текущая точка курсора */}
      <Circle
        x={nextVertex.x}
        y={nextVertex.y}
        radius={6 / zoom}
        fill={isSnapToStart ? '#38bdf8' : '#fbbf24'}
        stroke="#0f172a"
        strokeWidth={2 / zoom}
      />

      {/* Подсказка о замыкании контура */}
      {isSnapToStart && (
        <Group x={firstVertex.x + 15 / zoom} y={firstVertex.y - 15 / zoom}>
          <Text
            text="Кликните для замыкания"
            fontSize={13 / zoom}
            fontStyle="bold"
            fill="#38bdf8"
            shadowColor="#000"
            shadowBlur={4 / zoom}
          />
        </Group>
      )}

      {/* Подсказка длины и угла прямо на резиновой линии */}
      {!isSnapToStart && (
        <Group
          x={(lastVertex.x + nextVertex.x) / 2}
          y={(lastVertex.y + nextVertex.y) / 2 - 25 / zoom}
        >
          <Text
            text={`${Math.round(effectiveLength).toLocaleString('ru-RU')} мм | ${Math.round(effectiveAngle)}°`}
            fontSize={12 / zoom}
            fontFamily="monospace"
            fontStyle="bold"
            fill="#fbbf24"
            align="center"
            offsetX={60 / zoom}
            width={120 / zoom}
            shadowColor="#090d16"
            shadowBlur={5 / zoom}
          />
        </Group>
      )}
    </Layer>
  );
};

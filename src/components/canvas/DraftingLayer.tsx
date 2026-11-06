import React from 'react';
import { Layer, Line, Circle, Text, Group } from 'react-konva';
import type { Point2D, DynamicInputState, SnapResult } from '../../types';
import { distance, angleDeg, polarToPoint, snapAngle } from '../../core/geometry/math';

interface DraftingLayerProps {
  draftVertices: Point2D[];
  cursorPosMm: Point2D;
  dynamicInput: DynamicInputState;
  activeSnap: SnapResult;
  zoom: number;
  isApartmentTool: boolean;
  isShaftTool: boolean;
}

export const DraftingLayer: React.FC<DraftingLayerProps> = ({
  draftVertices,
  cursorPosMm,
  dynamicInput,
  activeSnap,
  zoom,
  isApartmentTool,
  isShaftTool,
}) => {
  if (draftVertices.length === 0) return null;

  const lastVertex = draftVertices[draftVertices.length - 1];
  const firstVertex = draftVertices[0];

  // Точка курсора: если есть активная привязка (магнит), берем ее, иначе свободный курсор
  const targetPoint = activeSnap.isSnapped && dynamicInput.lockedLength === null
    ? activeSnap.point
    : cursorPosMm;

  let rawDist = distance(lastVertex, targetPoint);
  let rawAngle = angleDeg(lastVertex, targetPoint);

  const effectiveAngle =
    dynamicInput.lockedAngle !== null
      ? dynamicInput.lockedAngle
      : snapAngle(rawAngle, 6);

  const effectiveLength =
    dynamicInput.lockedLength !== null
      ? dynamicInput.lockedLength
      : rawDist;

  let nextVertex = polarToPoint(lastVertex, effectiveLength, effectiveAngle);

  // Проверка замыкания контура на первую точку
  const distToStart = distance(nextVertex, firstVertex);
  const isSnapToStart = draftVertices.length >= 2 && distToStart < 25 / zoom;
  if (isSnapToStart && dynamicInput.lockedLength === null) {
    nextVertex = { ...firstVertex };
  }

  const confirmedPoints = draftVertices.flatMap((v) => [v.x, v.y]);

  let colorPrimary = '#38bdf8'; // Комнаты - голубой
  if (isApartmentTool) colorPrimary = '#fbbf24'; // Квартира - золотистый
  if (isShaftTool) colorPrimary = '#ef4444'; // Шахта - красный

  return (
    <Layer listening={false}>
      {/* Направляющая линия привязки (лучи X / Y) */}
      {activeSnap.guideLine && (
        <Line
          points={[
            activeSnap.guideLine.from.x,
            activeSnap.guideLine.from.y,
            activeSnap.guideLine.to.x,
            activeSnap.guideLine.to.y,
          ]}
          stroke="#06b6d4"
          strokeWidth={1 / zoom}
          dash={[6 / zoom, 4 / zoom]}
          opacity={0.8}
        />
      )}

      {/* Зафиксированные сегменты */}
      <Line
        points={confirmedPoints}
        stroke={colorPrimary}
        strokeWidth={3 / zoom}
        lineCap="round"
        lineJoin="round"
      />

      {/* Вершины */}
      {draftVertices.map((v, i) => (
        <Circle
          key={`draft-v-${i}`}
          x={v.x}
          y={v.y}
          radius={(i === 0 ? 8 : 5) / zoom}
          fill={i === 0 ? '#fbbf24' : colorPrimary}
          stroke="#090d16"
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

      {/* Окружность зафиксированной длины (CAD) */}
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

      {/* Индикатор магнитной привязки (Snap target ring) */}
      {activeSnap.isSnapped && (
        <Group x={activeSnap.point.x} y={activeSnap.point.y}>
          <Circle
            radius={9 / zoom}
            stroke="#22c55e"
            strokeWidth={2 / zoom}
            fill="rgba(34, 197, 94, 0.2)"
          />
          <Text
            text={activeSnap.label || 'Магнит'}
            fontSize={10 / zoom}
            fontFamily="monospace"
            fill="#22c55e"
            x={12 / zoom}
            y={-5 / zoom}
            shadowColor="#000"
            shadowBlur={4 / zoom}
          />
        </Group>
      )}

      {/* Точка курсора */}
      <Circle
        x={nextVertex.x}
        y={nextVertex.y}
        radius={6 / zoom}
        fill={isSnapToStart ? '#22c55e' : '#fbbf24'}
        stroke="#090d16"
        strokeWidth={2 / zoom}
      />

      {/* Текст замыкания контура */}
      {isSnapToStart && (
        <Group x={firstVertex.x + 15 / zoom} y={firstVertex.y - 15 / zoom}>
          <Text
            text="Замкнуть контур (Клик)"
            fontSize={13 / zoom}
            fontStyle="bold"
            fill="#22c55e"
            shadowColor="#000"
            shadowBlur={4 / zoom}
          />
        </Group>
      )}

      {/* Размер и угол на резиновой линии */}
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
            fill={colorPrimary}
            align="center"
            offsetX={60 / zoom}
            width={120 / zoom}
            shadowColor="#090d16"
            shadowBlur={6 / zoom}
          />
        </Group>
      )}
    </Layer>
  );
};

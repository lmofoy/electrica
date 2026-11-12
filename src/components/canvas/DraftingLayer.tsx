import React from 'react';
import { Layer, Line, Circle, Text, Group, Rect } from 'react-konva';
import type { Point2D, DynamicInputState, SnapResult } from '../../types';
import { distance, angleDeg, polarToPoint, snapAngle } from '../../core/geometry/math';

interface DraftingLayerProps {
  draftVertices: Point2D[];
  cursorPosMm: Point2D;
  dynamicInput: DynamicInputState;
  activeSnap: SnapResult;
  zoom: number;
  isApartmentTool: boolean;
  isOpeningTool: boolean;
  isPartitionTool: boolean;
}

export const DraftingLayer: React.FC<DraftingLayerProps> = ({
  draftVertices,
  cursorPosMm,
  dynamicInput,
  activeSnap,
  zoom,
  isApartmentTool,
  isOpeningTool,
  isPartitionTool,
}) => {
  // Визуализация маркера магнитной привязки
  const renderSnapIndicator = () => {
    if (!activeSnap.isSnapped) return null;

    const snapPoint = activeSnap.point;
    const snapType = activeSnap.snapType;
    const segmentStart =
      draftVertices.length > 0 ? draftVertices[draftVertices.length - 1] : null;

    return (
      <Group x={snapPoint.x} y={snapPoint.y}>
        {/* Уровень 1: Узел (Endpoints / Intersections) — Зеленый круг */}
        {snapType === 'vertex' && (
          <>
            <Circle
              radius={10 / zoom}
              stroke="#22c55e"
              strokeWidth={2.5 / zoom}
              fill="rgba(34, 197, 94, 0.25)"
            />
            <Circle radius={3 / zoom} fill="#22c55e" />
          </>
        )}

        {/* Уровень 2: Выравнивание / Polar — Голубой / Золотистый перекресток */}
        {(snapType === 'polar' || snapType === 'alignment') && (
          <>
            <Line
              points={[-8 / zoom, 0, 8 / zoom, 0]}
              stroke="#38bdf8"
              strokeWidth={2 / zoom}
            />
            <Line
              points={[0, -8 / zoom, 0, 8 / zoom]}
              stroke="#38bdf8"
              strokeWidth={2 / zoom}
            />
            <Circle
              radius={7 / zoom}
              stroke="#38bdf8"
              strokeWidth={1.5 / zoom}
              dash={[4 / zoom, 2 / zoom]}
            />
          </>
        )}

        {/* Уровень 3: Стена (Edge Snap) — Ромб / Перпендикуляр */}
        {snapType === 'wall_edge' && (
          <Rect
            x={0}
            y={0}
            offsetX={6 / zoom}
            offsetY={6 / zoom}
            width={12 / zoom}
            height={12 / zoom}
            rotation={45}
            stroke="#06b6d4"
            strokeWidth={2 / zoom}
            fill="rgba(6, 182, 212, 0.2)"
          />
        )}

        {/* Текстовый бейдж привязки */}
        <Text
          text={activeSnap.label || 'Магнит'}
          fontSize={11 / zoom}
          fontFamily="monospace"
          fontStyle="bold"
          fill={
            snapType === 'vertex'
              ? '#4ade80'
              : snapType === 'wall_edge'
              ? '#22d3ee'
              : '#38bdf8'
          }
          x={14 / zoom}
          y={-6 / zoom}
          shadowColor="#000"
          shadowBlur={6 / zoom}
        />

        {/* Длина текущего отрезка от последней точки до привязки */}
        {segmentStart && (
          <Text
            text={`${Math.round(distance(segmentStart, snapPoint)).toLocaleString('ru-RU')} мм`}
            fontSize={10 / zoom}
            fontFamily="monospace"
            fill="#e2e8f0"
            x={14 / zoom}
            y={9 / zoom}
            shadowColor="#000"
            shadowBlur={6 / zoom}
          />
        )}
      </Group>
    );
  };

  // Отрисовка направляющих лучей (Alignment Guides & Polar Rays)
  const renderGuideLines = () => {
    if (!activeSnap.guideLines || activeSnap.guideLines.length === 0) return null;

    return (
      <Group>
        {activeSnap.guideLines.map((gl, i) => {
          const isPolar = gl.type === 'polar';
          const strokeColor = isPolar ? '#fbbf24' : '#38bdf8';

          return (
            <Group key={`guideline-${i}`}>
              {/* Пунктирный луч от исходного узла к точке курсора */}
              <Line
                points={[gl.from.x, gl.from.y, gl.to.x, gl.to.y]}
                stroke={strokeColor}
                strokeWidth={1.5 / zoom}
                dash={isPolar ? [8 / zoom, 4 / zoom] : [6 / zoom, 3 / zoom]}
                opacity={0.85}
              />

              {/* Маркер на исходном узле, от которого строится луч */}
              {gl.sourceNode && (
                <Circle
                  x={gl.sourceNode.x}
                  y={gl.sourceNode.y}
                  radius={5 / zoom}
                  stroke="#38bdf8"
                  strokeWidth={1.5 / zoom}
                  fill="rgba(56, 189, 248, 0.4)"
                />
              )}
            </Group>
          );
        })}
      </Group>
    );
  };

  // Если точек еще нет — отображаем направляющие и маркер магнита на свободном курсоре
  if (draftVertices.length === 0) {
    return (
      <Layer listening={false}>
        {renderGuideLines()}
        {renderSnapIndicator()}
        {!activeSnap.isSnapped && (
          <Circle
            x={cursorPosMm.x}
            y={cursorPosMm.y}
            radius={5 / zoom}
            fill="#fbbf24"
            stroke="#000"
            strokeWidth={1.5 / zoom}
          />
        )}
      </Layer>
    );
  }

  const lastVertex = draftVertices[draftVertices.length - 1];
  const firstVertex = draftVertices[0];

  const targetPoint = activeSnap.isSnapped && dynamicInput.lockedLength === null
    ? activeSnap.point
    : cursorPosMm;

  let rawDist = distance(lastVertex, targetPoint);
  let rawAngle = angleDeg(lastVertex, targetPoint);

  const effectiveAngle =
    dynamicInput.lockedAngle !== null
      ? dynamicInput.lockedAngle
      : snapAngle(rawAngle, 6);

  // Иерархия: Любой активный магнит 100% отменяет шаг 100 мм и притягивает точно
  let effectiveLength: number;
  let nextVertex: Point2D;

  if (activeSnap.isSnapped && dynamicInput.lockedLength === null) {
    nextVertex = { ...activeSnap.point };
    effectiveLength = distance(lastVertex, activeSnap.point);
  } else if (dynamicInput.lockedLength !== null) {
    effectiveLength = dynamicInput.lockedLength;
    nextVertex = polarToPoint(lastVertex, effectiveLength, effectiveAngle);
  } else {
    effectiveLength = Math.max(100, Math.round(rawDist / 100) * 100);
    nextVertex = polarToPoint(lastVertex, effectiveLength, effectiveAngle);
  }

  // Проверка замыкания контура на первую точку
  const distToStart = distance(nextVertex, firstVertex);
  const isSnapToStart = draftVertices.length >= 2 && distToStart < 25 / zoom;
  if (isSnapToStart && dynamicInput.lockedLength === null) {
    nextVertex = { ...firstVertex };
  }

  const confirmedPoints = draftVertices.flatMap((v) => [v.x, v.y]);

  let colorPrimary = '#38bdf8'; // Комнаты - голубой
  if (isApartmentTool) colorPrimary = '#fbbf24'; // Квартира - золотистый
  if (isOpeningTool) colorPrimary = '#a855f7'; // Проем - фиолетовый
  if (isPartitionTool) colorPrimary = '#94a3b8'; // Перегородка - серый

  return (
    <Layer listening={false}>
      {/* Направляющие лучи (Polar & Alignment) */}
      {renderGuideLines()}

      {/* Зафиксированные сегменты чертежа */}
      <Line
        points={confirmedPoints}
        stroke={colorPrimary}
        strokeWidth={3 / zoom}
        lineCap="round"
        lineJoin="round"
      />

      {/* Вершины чертежа */}
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

      {/* Окружность зафиксированной длины (CAD Tab) */}
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

      {/* Индикатор магнита (Node, Edge, Polar, Alignment) */}
      {renderSnapIndicator()}

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

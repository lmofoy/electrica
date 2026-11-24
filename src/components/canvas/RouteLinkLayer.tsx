import React from 'react';
import { Circle, Group, Layer, Line, Rect } from 'react-konva';
import type { ManualRoute, Point2D } from '../../types';
import {
  orthogonalLinkPoints,
  type RouteLinkAxis,
} from '../../core/electrical/routeLink';

interface RouteLinkLayerProps {
  route: ManualRoute | null;
  looseJunctions: Point2D[];
  from: Point2D | null;
  hover: Point2D | null;
  hoverTone: 'valid' | 'neutral' | 'invalid';
  axisFirst: RouteLinkAxis;
  color: string;
  zoom: number;
}

const toneColor = {
  valid: '#34d399',
  neutral: '#fbbf24',
  invalid: '#f87171',
} as const;

// Слой режима «Соединять»: свободные узлы и превью новой связи.
// Сам кабель рисует RoutingLayer, поэтому слой только смотрит и ничего не ловит.
export const RouteLinkLayer: React.FC<RouteLinkLayerProps> = ({
  route,
  looseJunctions,
  from,
  hover,
  hoverTone,
  axisFirst,
  color,
  zoom,
}) => {
  const box = 13 / zoom;
  const anchoredJunctions =
    route?.anchors
      .filter((anchor) => anchor.kind === 'junction')
      .map((anchor) => route.nodes[anchor.nodeIndex])
      .filter((point): point is Point2D => Boolean(point)) ?? [];
  const preview =
    from && hover ? orthogonalLinkPoints(from, hover, axisFirst) : [];
  const samePoint =
    from &&
    hover &&
    Math.abs(from.x - hover.x) < 0.5 &&
    Math.abs(from.y - hover.y) < 0.5;

  return (
    <Layer listening={false}>
      {preview.length >= 2 && !samePoint && (
        <>
          <Line
            points={preview.flatMap((point) => [point.x, point.y])}
            stroke={color}
            strokeWidth={2.5 / zoom}
            dash={[9 / zoom, 5 / zoom]}
            opacity={0.85}
            lineCap="round"
            lineJoin="round"
          />
          <Circle
            x={from!.x}
            y={from!.y}
            radius={6 / zoom}
            fill={color}
            stroke="#ffffff"
            strokeWidth={1.5 / zoom}
          />
          <Circle
            x={hover!.x}
            y={hover!.y}
            radius={7 / zoom}
            fill={toneColor[hoverTone]}
            opacity={0.9}
            stroke="#ffffff"
            strokeWidth={1.5 / zoom}
          />
        </>
      )}
      {preview.length < 2 && from && (
        <Circle
          x={from.x}
          y={from.y}
          radius={7 / zoom}
          stroke="#ffffff"
          strokeWidth={1.5 / zoom}
          dash={[4 / zoom, 3 / zoom]}
        />
      )}
      {!from && hover && (
        <Rect
          x={hover.x}
          y={hover.y}
          width={box}
          height={box}
          offsetX={box / 2}
          offsetY={box / 2}
          rotation={45}
          fill={toneColor[hoverTone]}
          opacity={0.85}
          stroke="#ffffff"
          strokeWidth={1.5 / zoom}
        />
      )}

      {anchoredJunctions.map((point, index) => (
        <Group key={`junction-${index}`} x={point.x} y={point.y}>
          <Rect
            width={box}
            height={box}
            offsetX={box / 2}
            offsetY={box / 2}
            rotation={45}
            fill="#fbbf24"
            stroke="#ffffff"
            strokeWidth={1.5 / zoom}
            shadowColor="#fbbf24"
            shadowBlur={6 / zoom}
          />
        </Group>
      ))}
      {looseJunctions.map((point, index) => (
        <Group key={`loose-${index}`} x={point.x} y={point.y}>
          <Rect
            width={box}
            height={box}
            offsetX={box / 2}
            offsetY={box / 2}
            rotation={45}
            fill="#fbbf24"
            opacity={0.8}
            stroke="#ffffff"
            strokeWidth={1.5 / zoom}
            dash={[3 / zoom, 2 / zoom]}
          />
        </Group>
      ))}
    </Layer>
  );
};

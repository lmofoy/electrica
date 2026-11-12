import React, { useRef, useState } from 'react';
import { Circle, Group, Layer, Rect } from 'react-konva';
import Konva from 'konva';
import type { ManualRoute, Point2D } from '../../types';
import {
  distance,
  projectPointOnSegment,
  snapToGrid,
} from '../../core/geometry/math';

interface ManualRouteLayerProps {
  route: ManualRoute;
  color: string;
  zoom: number;
  stagePos: Point2D;
  width: number;
  height: number;
  gridSnap: boolean;
  gridStepMm: number;
  selectedNode: number | null;
  onSelectNode: (index: number | null) => void;
  onInsert: (pathIndex: number, segmentIndex: number, point: Point2D) => void;
  onPreview: (nodeIndex: number, point: Point2D) => Point2D | null;
  onMove: (nodeIndex: number, point: Point2D) => void;
  onCancelPreview: () => void;
}

interface HoverSegment {
  pathIndex: number;
  segmentIndex: number;
  point: Point2D;
}

interface DragState {
  index: number;
  origin: Point2D;
  last: Point2D;
  moved: boolean;
}

function nearestSegment(
  route: ManualRoute,
  point: Point2D,
  toleranceMm: number
): HoverSegment | null {
  let best: (HoverSegment & { distance: number }) | null = null;
  route.paths.forEach((path, pathIndex) => {
    for (let i = 1; i < path.length; i++) {
      const start = route.nodes[path[i - 1]];
      const end = route.nodes[path[i]];
      const projection = projectPointOnSegment(point, start, end);
      if (projection.distance > toleranceMm) continue;
      if (best && best.distance <= projection.distance) continue;
      best = {
        pathIndex,
        segmentIndex: i - 1,
        point: projection.point,
        distance: projection.distance,
      };
    }
  });
  return best;
}

function nodeDegree(route: ManualRoute, nodeIndex: number): number {
  const neighbors = new Set<number>();
  for (const path of route.paths) {
    for (let i = 0; i < path.length; i++) {
      if (path[i] !== nodeIndex) continue;
      if (i > 0) neighbors.add(path[i - 1]);
      if (i < path.length - 1) neighbors.add(path[i + 1]);
    }
  }
  return neighbors.size;
}

// Редактор ручной трассы: подвижные углы цветные, закреплённые точки серые.
// Новую точку можно поставить только на линии (в пределах 10 px).
export const ManualRouteLayer: React.FC<ManualRouteLayerProps> = ({
  route,
  color,
  zoom,
  stagePos,
  width,
  height,
  gridSnap,
  gridStepMm,
  selectedNode,
  onSelectNode,
  onInsert,
  onPreview,
  onMove,
  onCancelPreview,
}) => {
  const [hover, setHover] = useState<HoverSegment | null>(null);
  // На время жеста маркеры рисуются по исходной трассе: превью может
  // переиндексировать вершины, и активный Konva-узел нельзя терять.
  const [frozenRoute, setFrozenRoute] = useState<ManualRoute | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const displayRoute = frozenRoute ?? route;
  const radius = 6 / zoom;
  const anchorRadius = 5 / zoom;
  const toleranceMm = 10 / zoom;

  const pointerMm = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ): Point2D | null => {
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - stagePos.x) / zoom,
      y: (pointer.y - stagePos.y) / zoom,
    };
  };

  const snapPoint = (point: Point2D): Point2D =>
    gridSnap ? snapToGrid(point, gridStepMm) : point;

  const anchorsByNode = new Map(
    displayRoute.anchors.map((anchor) => [anchor.nodeIndex, anchor] as const)
  );
  // Служебные изгибы участвуют в геометрии линии, но не являются точками
  // пользователя: маркеры для них не рисуются.
  const bendNodes = new Set(displayRoute.bendNodes ?? []);

  return (
    <Layer>
      <Rect
        x={-stagePos.x / zoom}
        y={-stagePos.y / zoom}
        width={width / zoom}
        height={height / zoom}
        fill="rgba(0, 0, 0, 0)"
        onClick={(e) => {
          e.cancelBubble = true;
          if (e.evt.button !== 0) return;
          const point = pointerMm(e);
          if (!point) return;
          const hit = nearestSegment(route, point, toleranceMm);
          if (hit) {
            onInsert(hit.pathIndex, hit.segmentIndex, point);
            setHover(null);
            return;
          }
          onSelectNode(null);
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          const point = pointerMm(e);
          if (!point) return;
          const hit = nearestSegment(route, point, toleranceMm);
          if (hit) {
            onInsert(hit.pathIndex, hit.segmentIndex, point);
            setHover(null);
            return;
          }
          onSelectNode(null);
        }}
        onMouseMove={(e) => {
          const point = pointerMm(e);
          setHover(point ? nearestSegment(route, point, toleranceMm) : null);
        }}
        onMouseLeave={() => setHover(null)}
      />

      {hover && (
        <Circle
          x={hover.point.x}
          y={hover.point.y}
          radius={5 / zoom}
          fill={color}
          opacity={0.7}
          stroke="#ffffff"
          strokeWidth={1 / zoom}
          listening={false}
        />
      )}

      {displayRoute.nodes.map((point, index) => {
        if (bendNodes.has(index)) return null;
        const anchor = anchorsByNode.get(index);
        const physical =
          anchor?.kind === 'panel' || anchor?.kind === 'device';
        // Щиток и приборы закреплены. Стык — обычная подвижная вершина.
        const draggable = !physical && nodeDegree(displayRoute, index) >= 2;

        return (
          <Group
            key={`node-${index}`}
            x={point.x}
            y={point.y}
            draggable={draggable}
            onMouseDown={(e) => {
              e.cancelBubble = true;
            }}
            onTouchStart={(e) => {
              e.cancelBubble = true;
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              setHover(null);
              setFrozenRoute(route);
              const origin = { x: point.x, y: point.y };
              dragRef.current = {
                index,
                origin,
                last: origin,
                moved: false,
              };
              onSelectNode(index);
            }}
            onDragMove={(e) => {
              const drag = dragRef.current;
              if (!drag || drag.index !== index) return;
              const raw = { x: e.target.x(), y: e.target.y() };
              const snapped = snapPoint(raw);
              const preview = onPreview(index, snapped);
              const shown = preview ?? snapped;
              e.target.position(shown);
              drag.last = shown;
              drag.moved = distance(shown, drag.origin) > 0.5;
            }}
            onDragEnd={(e) => {
              const drag = dragRef.current;
              dragRef.current = null;
              setFrozenRoute(null);
              if (!drag) return;
              if (!drag.moved) {
                e.target.position(drag.origin);
                onCancelPreview();
                return;
              }
              e.target.position(drag.last);
              onMove(index, drag.last);
            }}
            onClick={(e) => {
              e.cancelBubble = true;
              if (e.evt.button !== 0) return;
              onSelectNode(index);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onSelectNode(index);
            }}
          >
            {anchor?.kind === 'junction' ? (
              <Rect
                width={anchorRadius * 1.8}
                height={anchorRadius * 1.8}
                offsetX={anchorRadius * 0.9}
                offsetY={anchorRadius * 0.9}
                rotation={45}
                fill={color}
                stroke="#ffffff"
                strokeWidth={1 / zoom}
                shadowColor={color}
                shadowBlur={8 / zoom}
              />
            ) : physical ? (
              anchor.kind === 'panel' ? (
                <Rect
                  width={anchorRadius * 2}
                  height={anchorRadius * 2}
                  offsetX={anchorRadius}
                  offsetY={anchorRadius}
                  fill="#94a3b8"
                  stroke="#ffffff"
                  strokeWidth={1 / zoom}
                  shadowColor="#0f172a"
                  shadowBlur={4 / zoom}
                />
              ) : (
                <Circle
                  radius={anchorRadius}
                  fill="#94a3b8"
                  stroke="#ffffff"
                  strokeWidth={1 / zoom}
                  shadowColor="#0f172a"
                  shadowBlur={4 / zoom}
                />
              )
            ) : (
              <Circle
                radius={selectedNode === index ? radius * 1.35 : radius}
                fill={color}
                stroke="#ffffff"
                strokeWidth={1.5 / zoom}
                shadowColor={color}
                shadowBlur={8 / zoom}
              />
            )}
            {selectedNode === index && (
              <Circle
                radius={Math.max(radius, anchorRadius) * 2.1}
                stroke="#ffffff"
                strokeWidth={1 / zoom}
                dash={[4 / zoom, 3 / zoom]}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </Layer>
  );
};

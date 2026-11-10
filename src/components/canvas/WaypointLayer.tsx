import React, { useRef } from 'react';
import { Circle, Group, Layer, Rect, Text } from 'react-konva';
import type { CircuitLine, Point2D } from '../../types';
import { snapToGrid } from '../../core/geometry/math';

interface WaypointLayerProps {
  line: CircuitLine;
  color: string;
  zoom: number;
  stagePos: Point2D;
  width: number;
  height: number;
  cursorPosMm: Point2D;
  gridSnap: boolean;
  gridStepMm: number;
  onAdd: (point: Point2D) => void;
  onPreview: (index: number, point: Point2D) => void;
  onMove: (index: number, point: Point2D) => void;
  onRemove: (index: number) => void;
}

export const WaypointLayer: React.FC<WaypointLayerProps> = ({
  line,
  color,
  zoom,
  stagePos,
  width,
  height,
  cursorPosMm,
  gridSnap,
  gridStepMm,
  onAdd,
  onPreview,
  onMove,
  onRemove,
}) => {
  const dragMovedRef = useRef(false);
  const waypoints = line.waypoints ?? [];
  const radius = 7 / zoom;
  const snap = (point: Point2D) => gridSnap ? snapToGrid(point, gridStepMm) : point;

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
          const pointer = e.target.getStage()?.getPointerPosition();
          if (!pointer) return;
          onAdd(snap({
            x: (pointer.x - stagePos.x) / zoom,
            y: (pointer.y - stagePos.y) / zoom,
          }));
        }}
      />
      {waypoints.map((point, index) => (
        <Group
          key={`${line.id}-${index}`}
          name={`waypoint-${index}`}
          x={point.x}
          y={point.y}
          draggable
          onMouseDown={() => { dragMovedRef.current = false; }}
          onTouchStart={() => { dragMovedRef.current = false; }}
          onDragMove={(e) => {
            dragMovedRef.current = true;
            onPreview(index, snap({ x: e.target.x(), y: e.target.y() }));
          }}
          onDragEnd={(e) => {
            const next = snap({ x: e.target.x(), y: e.target.y() });
            e.target.position(next);
            onMove(index, next);
          }}
          onClick={(e) => {
            e.cancelBubble = true;
            if (e.evt.button !== 0 || dragMovedRef.current) return;
            onRemove(index);
          }}
          onTap={(e) => {
            e.cancelBubble = true;
            if (!dragMovedRef.current) onRemove(index);
          }}
        >
          <Circle
            radius={radius}
            fill={color}
            stroke="#ffffff"
            strokeWidth={1.5 / zoom}
            shadowColor={color}
            shadowBlur={8 / zoom}
          />
          <Text
            text={String(index + 1)}
            fontSize={9 / zoom}
            fontStyle="bold"
            fontFamily="Arial"
            fill="#ffffff"
            width={radius * 2}
            height={radius * 2}
            x={-radius}
            y={-radius}
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </Group>
      ))}
      <Circle
        x={cursorPosMm.x}
        y={cursorPosMm.y}
        radius={6 / zoom}
        stroke={color}
        strokeWidth={1.5 / zoom}
        dash={[4 / zoom, 3 / zoom]}
        opacity={0.6}
        listening={false}
      />
    </Layer>
  );
};

import React from 'react';
import { Circle, Layer, Line } from 'react-konva';
import type { ElectricalPanel } from '../../types';
import type { LineRoute } from '../../core/electrical/routing';
import { buildLineColorMap } from '../../core/electrical/lineColors';

interface RoutingLayerProps {
  panel: ElectricalPanel | null;
  routes: Map<string, LineRoute>;
  highlightedLineId: string | null;
  zoom: number;
  onSelectLine: (id: string | null) => void;
}

interface SegmentGeometry {
  lineId: string;
  color: string;
  points: number[];
  panelStart: { x: number; y: number } | null;
}

export const RoutingLayer: React.FC<RoutingLayerProps> = ({
  panel,
  routes,
  highlightedLineId,
  zoom,
  onSelectLine,
}) => {
  if (!panel || routes.size === 0) return null;

  const colors = buildLineColorMap(panel);
  const segments: SegmentGeometry[] = [];

  for (const line of panel.lines) {
    const route = routes.get(line.id);
    if (!route) continue;
    const color = colors.get(line.id) ?? '#38bdf8';
    route.paths.forEach((path, index) => {
      if (path.length < 2) return;
      segments.push({
        lineId: line.id,
        color,
        points: path.flatMap((point) => [point.x, point.y]),
        panelStart: index === 0 ? path[0] : null,
      });
    });
  }

  if (segments.length === 0) return null;

  const ordered = [
    ...segments.filter((segment) => segment.lineId !== highlightedLineId),
    ...segments.filter((segment) => segment.lineId === highlightedLineId),
  ];

  return (
    <Layer>
      {ordered.map((segment, index) => {
        const active = segment.lineId === highlightedLineId;
        const dimmed = highlightedLineId !== null && !active;
        const route = routes.get(segment.lineId);
        const floor = route?.mode === 'floor';
        const hit = (event: { cancelBubble: boolean }) => {
          event.cancelBubble = true;
          onSelectLine(active ? null : segment.lineId);
        };

        return (
          <React.Fragment key={`${segment.lineId}-${index}`}>
            <Line
              points={segment.points}
              name={`route-${segment.lineId}`}
              stroke={segment.color}
              strokeWidth={(active ? 3 : 1.6) / zoom}
              opacity={active ? 0.95 : dimmed ? 0.08 : 0.42}
              dash={floor ? [7 / zoom, 5 / zoom] : undefined}
              shadowColor={segment.color}
              shadowBlur={active ? 10 / zoom : 0}
              lineCap="round"
              lineJoin="round"
              perfectDrawEnabled={false}
              listening={!dimmed}
              hitStrokeWidth={12 / zoom}
              onClick={hit}
              onTap={hit}
            />
            {segment.panelStart && (
              <Circle
                x={segment.panelStart.x}
                y={segment.panelStart.y}
                radius={(active ? 3.6 : 2.2) / zoom}
                fill={segment.color}
                opacity={active ? 0.95 : dimmed ? 0.1 : 0.5}
                listening={false}
                name={`route-node-${segment.lineId}`}
              />
            )}
          </React.Fragment>
        );
      })}
    </Layer>
  );
};

import React from 'react';
import { Circle, Layer, Line } from 'react-konva';
import type { ElectricalPanel } from '../../types';
import type { DevicePose, ResolvedDevice } from '../../core/electrical/devices';
import { buildLineColorMap } from '../../core/electrical/lineColors';

interface RoutingLayerProps {
  panel: ElectricalPanel | null;
  panelPose: DevicePose | null;
  devices: ResolvedDevice[];
  highlightedLineId: string | null;
  zoom: number;
  onSelectLine: (id: string | null) => void;
}

interface LinkGeometry {
  lineId: string;
  color: string;
  points: number[];
}

export const RoutingLayer: React.FC<RoutingLayerProps> = ({
  panel,
  panelPose,
  devices,
  highlightedLineId,
  zoom,
  onSelectLine,
}) => {
  if (!panel || !panelPose) return null;

  const colors = buildLineColorMap(panel);
  const deviceById = new Map(devices.map((resolved) => [resolved.device.id, resolved]));

  const links: LinkGeometry[] = [];
  for (const line of panel.lines) {
    const color = colors.get(line.id) ?? '#38bdf8';
    for (const deviceId of line.deviceIds) {
      const resolved = deviceById.get(deviceId);
      const pose = resolved?.poses[0];
      if (!pose) continue;
      const from = panelPose.position;
      const to = pose.position;
      links.push({
        lineId: line.id,
        color,
        points: [from.x, from.y, to.x, from.y, to.x, to.y],
      });
    }
  }

  if (links.length === 0) return null;

  return (
    <Layer>
      {links.map((link, index) => {
        const active = link.lineId === highlightedLineId;
        const dimmed = highlightedLineId !== null && !active;
        const hit = (event: { cancelBubble: boolean }) => {
          event.cancelBubble = true;
          onSelectLine(active ? null : link.lineId);
        };

        return (
          <React.Fragment key={`${link.lineId}-${index}`}>
            <Line
              points={link.points}
              name={`route-${link.lineId}`}
              stroke={link.color}
              strokeWidth={(active ? 2.6 : 1.4) / zoom}
              opacity={active ? 0.95 : dimmed ? 0.1 : 0.45}
              dash={active ? [10 / zoom, 5 / zoom] : [5 / zoom, 5 / zoom]}
              shadowColor={link.color}
              shadowBlur={active ? 8 / zoom : 0}
              lineCap="round"
              listening={!dimmed}
              hitStrokeWidth={12 / zoom}
              onClick={hit}
              onTap={hit}
            />
            <Circle
              x={link.points[0]}
              y={link.points[1]}
              radius={(active ? 3.4 : 2) / zoom}
              fill={link.color}
              opacity={active ? 0.95 : dimmed ? 0.1 : 0.5}
              listening={false}
              name={`route-node-${link.lineId}`}
            />
          </React.Fragment>
        );
      })}
    </Layer>
  );
};

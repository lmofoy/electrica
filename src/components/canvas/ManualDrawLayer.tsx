import React from 'react';
import { Circle, Layer, Line } from 'react-konva';
import type { Point2D } from '../../types';
import {
  manualDrawConnectedDevices,
  manualDrawPreview,
  type ManualDrawAxis,
  type ManualDrawSession,
} from '../../core/electrical/manualDraw';

export type ManualDrawHoverKind = 'grid' | 'panel' | 'device' | 'junction' | 'segment';

export interface ManualDrawHover {
  point: Point2D;
  kind: ManualDrawHoverKind;
  deviceId?: string;
  connected?: boolean;
}

interface ManualDrawLayerProps {
  session: ManualDrawSession;
  color: string;
  zoom: number;
  hover: ManualDrawHover | null;
  axisFirst: ManualDrawAxis;
  tool: 'line' | 'junction';
}

const flat = (points: Point2D[]) => points.flatMap((point) => [point.x, point.y]);

function hoverStroke(hover: ManualDrawHover | null): string {
  if (!hover) return '#94a3b8';
  if (hover.kind === 'device') return hover.connected ? '#f59e0b' : '#34d399';
  if (hover.kind === 'junction') return '#f8fafc';
  if (hover.kind === 'segment') return '#fbbf24';
  return '#94a3b8';
}

export const ManualDrawLayer: React.FC<ManualDrawLayerProps> = ({
  session,
  color,
  zoom,
  hover,
  axisFirst,
  tool,
}) => {
  const connected = manualDrawConnectedDevices(session);
  const preview =
    tool === 'line'
      ? manualDrawPreview(session, hover?.point ?? null, axisFirst)
      : null;
  const active = session.active;
  const activeLast = active?.points[active.points.length - 1] ?? null;

  return (
    <Layer listening={false}>
      {session.chains.map((chain, index) => (
        <Line
          key={`manual-chain-${index}`}
          points={flat(chain.points)}
          stroke={color}
          strokeWidth={2.4 / zoom}
          opacity={0.95}
          lineCap="round"
          lineJoin="round"
          perfectDrawEnabled={false}
        />
      ))}

      {active && active.points.length >= 2 && (
        <Line
          points={flat(active.points)}
          stroke={color}
          strokeWidth={2.8 / zoom}
          lineCap="round"
          lineJoin="round"
          perfectDrawEnabled={false}
          shadowColor={color}
          shadowBlur={8 / zoom}
        />
      )}

      {preview && preview.length >= 2 && (
        <Line
          points={flat(preview)}
          stroke={color}
          strokeWidth={2 / zoom}
          dash={[7 / zoom, 5 / zoom]}
          opacity={0.85}
          lineCap="round"
          lineJoin="round"
          perfectDrawEnabled={false}
        />
      )}

      <Circle
        x={session.panelPoint.x}
        y={session.panelPoint.y}
        radius={6 / zoom}
        stroke={color}
        strokeWidth={2 / zoom}
        fill="rgba(2,6,23,0.85)"
      />

      {session.devices.map((device) => {
        const isConnected = connected.has(device.deviceId);
        return (
          <Circle
            key={`manual-device-${device.deviceId}`}
            x={device.point.x}
            y={device.point.y}
            radius={(isConnected ? 5 : 6.5) / zoom}
            stroke={isConnected ? color : '#f59e0b'}
            strokeWidth={(isConnected ? 2 : 1.6) / zoom}
            dash={isConnected ? undefined : [3 / zoom, 3 / zoom]}
            fill="rgba(2,6,23,0.7)"
            opacity={isConnected ? 0.95 : 0.8}
          />
        );
      })}

      {session.junctions.map((junction, index) => (
        <Circle
          key={`manual-junction-${index}`}
          x={junction.x}
          y={junction.y}
          radius={5 / zoom}
          stroke="#f8fafc"
          strokeWidth={2 / zoom}
          fill="rgba(248,250,252,0.18)"
        />
      ))}

      {activeLast && (
        <Circle
          x={activeLast.x}
          y={activeLast.y}
          radius={4.5 / zoom}
          fill={color}
          stroke="#0f172a"
          strokeWidth={1.5 / zoom}
        />
      )}

      {hover && (
        <Circle
          x={hover.point.x}
          y={hover.point.y}
          radius={5 / zoom}
          stroke={hoverStroke(hover)}
          strokeWidth={2 / zoom}
          fill="rgba(2,6,23,0.55)"
        />
      )}
    </Layer>
  );
};

import React from 'react';
import { Layer, Group, Circle, Line, Shape, Rect, Text } from 'react-konva';
import type { DeviceType, ElectricalPanel } from '../../types';
import type { ResolvedDevice, DevicePose } from '../../core/electrical/devices';
import { DEVICE_CATALOG } from '../../core/electrical/devices';
import {
  PANEL_SYMBOL_DEPTH_MM,
  PANEL_SYMBOL_WIDTH_MM,
} from '../../core/electrical/panel';

interface ElectricalLayerProps {
  devices: ResolvedDevice[];
  zoom: number;
  selectedDeviceId: string | null;
  preview: ResolvedDevice | null;
  panel: ElectricalPanel | null;
  panelPose: DevicePose | null;
  panelPreview: { position: { x: number; y: number }; rotationDeg: number } | null;
  deviceLineIds: Map<string, string>;
  lineColors: Map<string, string>;
  highlightedLineId: string | null;
}

const DEVICE_COLORS: Record<DeviceType, string> = {
  socket_single: '#38bdf8',
  socket_double: '#7dd3fc',
  socket_wet: '#22d3ee',
  switch_1k: '#fbbf24',
  switch_2k: '#f59e0b',
  light_ceiling: '#fde047',
};

const DeviceGlyph: React.FC<{
  type: DeviceType;
  zoom: number;
  color: string;
  highlighted: boolean;
}> = ({ type, zoom, color, highlighted }) => {
  const strokeWidth = 1.8 / zoom;

  if (type === 'light_ceiling') {
    const r = 8 / zoom;
    return (
      <Group>
        <Circle
          radius={r}
          fill="#0f172a"
          stroke={color}
          strokeWidth={strokeWidth}
          shadowColor={color}
          shadowBlur={highlighted ? 16 / zoom : 0}
        />
        <Line points={[-r * 0.7, -r * 0.7, r * 0.7, r * 0.7]} stroke={color} strokeWidth={strokeWidth} />
        <Line points={[-r * 0.7, r * 0.7, r * 0.7, -r * 0.7]} stroke={color} strokeWidth={strokeWidth} />
      </Group>
    );
  }

  if (type === 'switch_1k' || type === 'switch_2k') {
    const stem = 4 / zoom;
    const r = 4.5 / zoom;
    return (
      <Group>
        <Line points={[0, 0, 0, -stem]} stroke={color} strokeWidth={strokeWidth} />
        <Circle x={0} y={-stem - r} radius={r} fill="#0f172a" stroke={color} strokeWidth={strokeWidth} />
        <Line
          points={[0, -stem - r, 7 / zoom, -stem - r - 7 / zoom]}
          stroke={color}
          strokeWidth={strokeWidth}
        />
        {type === 'switch_2k' && (
          <Line
            points={[3 / zoom, -stem - r - 2 / zoom, 9 / zoom, -stem - r - 9 / zoom]}
            stroke={color}
            strokeWidth={strokeWidth}
          />
        )}
      </Group>
    );
  }

  // Розетки: полукруг на стене + штыри внутрь комнаты
  const r = 7 / zoom;
  const prongY = -r - 5 / zoom;
  const prongPairs =
    type === 'socket_double'
      ? [-4.5 / zoom, -1.5 / zoom, 1.5 / zoom, 4.5 / zoom]
      : [-2.5 / zoom, 2.5 / zoom];

  return (
    <Group>
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.arc(0, 0, r, Math.PI, 2 * Math.PI, false);
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        }}
        fill="#0f172a"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {prongPairs.map((x) => (
        <Line
          key={`prong-${x}`}
          points={[x, -r + 1 / zoom, x, prongY]}
          stroke={color}
          strokeWidth={strokeWidth}
        />
      ))}
      {type === 'socket_wet' && (
        <Circle x={0} y={-r * 0.45} radius={1.6 / zoom} fill={color} />
      )}
    </Group>
  );
};

const DeviceSymbol: React.FC<{
  resolved: ResolvedDevice;
  zoom: number;
  selected: boolean;
  lineColor: string | null;
  lineHighlighted: boolean;
  dimmed: boolean;
}> = ({ resolved, zoom, selected, lineColor, lineHighlighted, dimmed }) => {
  const color = DEVICE_COLORS[resolved.device.type];

  return (
    <Group>
      {resolved.poses.map((pose, index) => (
        <Group
          key={`${resolved.device.id}-${index}`}
          x={pose.position.x}
          y={pose.position.y}
          rotation={pose.rotationDeg}
        >
          {lineColor && (
            <Circle
              radius={11 / zoom}
              stroke={lineColor}
              strokeWidth={(lineHighlighted ? 2.4 : 1.2) / zoom}
              opacity={lineHighlighted ? 0.95 : dimmed ? 0.1 : 0.38}
              shadowColor={lineColor}
              shadowBlur={lineHighlighted ? 10 / zoom : 0}
            />
          )}
          {selected && (
            <Circle
              radius={13 / zoom}
              stroke="#38bdf8"
              strokeWidth={2 / zoom}
              fill="rgba(56, 189, 248, 0.15)"
              dash={[4 / zoom, 3 / zoom]}
            />
          )}
          <DeviceGlyph type={resolved.device.type} zoom={zoom} color={color} highlighted={selected} />
        </Group>
      ))}
    </Group>
  );
};

const PanelGlyph: React.FC<{ zoom: number; highlighted: boolean }> = ({
  zoom,
  highlighted,
}) => {
  const width = PANEL_SYMBOL_WIDTH_MM;
  const depth = PANEL_SYMBOL_DEPTH_MM;
  const strokeWidth = (highlighted ? 2.6 : 1.8) / zoom;
  const fontSize = 74 / zoom;
  const inset = 22 / zoom;

  return (
    <Group>
      <Rect
        x={-width / 2}
        y={-depth / 2}
        width={width}
        height={depth}
        fill="#0f172a"
        stroke="#38bdf8"
        strokeWidth={strokeWidth}
        cornerRadius={4 / zoom}
        shadowColor="#38bdf8"
        shadowBlur={highlighted ? 14 / zoom : 0}
      />
      <Rect
        x={-width / 2 + inset}
        y={-depth / 2 + inset}
        width={width - inset * 2}
        height={depth - inset * 2}
        stroke="#1e4a6b"
        strokeWidth={1 / zoom}
        cornerRadius={2 / zoom}
      />
      <Text
        text="ЩР"
        fontSize={fontSize}
        fontStyle="bold"
        fontFamily="Arial"
        fill="#7dd3fc"
        width={width}
        height={depth}
        align="center"
        verticalAlign="middle"
        x={-width / 2}
        y={-depth / 2}
        listening={false}
      />
    </Group>
  );
};

export const ElectricalLayer: React.FC<ElectricalLayerProps> = ({
  devices,
  zoom,
  selectedDeviceId,
  preview,
  panel,
  panelPose,
  panelPreview,
  deviceLineIds,
  lineColors,
  highlightedLineId,
}) => {
  return (
    <Layer listening={false}>
      {devices.map((resolved) => {
        const lineId = deviceLineIds.get(resolved.device.id) ?? null;
        return (
          <DeviceSymbol
            key={resolved.device.id}
            resolved={resolved}
            zoom={zoom}
            selected={resolved.device.id === selectedDeviceId}
            lineColor={lineId ? lineColors.get(lineId) ?? null : null}
            lineHighlighted={lineId !== null && lineId === highlightedLineId}
            dimmed={highlightedLineId !== null && lineId !== highlightedLineId}
          />
        );
      })}

      {preview &&
        preview.poses.map((pose, index) => (
          <Group
            key={`preview-${index}`}
            x={pose.position.x}
            y={pose.position.y}
            rotation={pose.rotationDeg}
            opacity={0.65}
          >
            <Circle
              radius={12 / zoom}
              stroke="#a3e635"
              strokeWidth={1.5 / zoom}
              dash={[5 / zoom, 4 / zoom]}
            />
            <DeviceGlyph
              type={preview.device.type}
              zoom={zoom}
              color={DEVICE_CATALOG[preview.device.type].group === 'light' ? '#fde047' : '#a3e635'}
              highlighted={false}
            />
          </Group>
        ))}
      {panel && panelPose && (
        <Group
          x={panelPose.position.x}
          y={panelPose.position.y}
          rotation={panelPose.rotationDeg}
        >
          <PanelGlyph zoom={zoom} highlighted={false} />
        </Group>
      )}

      {panelPreview && (
        <Group
          x={panelPreview.position.x}
          y={panelPreview.position.y}
          rotation={panelPreview.rotationDeg}
          opacity={0.6}
        >
          <PanelGlyph zoom={zoom} highlighted={false} />
        </Group>
      )}
    </Layer>
  );
};

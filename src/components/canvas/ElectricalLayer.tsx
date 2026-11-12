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
  assignLineId: string | null;
}

const GROUP_COLORS: Record<'socket' | 'switch' | 'light', string> = {
  socket: '#38bdf8',
  switch: '#fbbf24',
  light: '#fde047',
};

function deviceColor(type: DeviceType): string {
  const entry = DEVICE_CATALOG[type];
  if (entry.connection === 'provision') return '#a78bfa';
  if (entry.group === 'socket' && entry.ipRating !== 'IP20') return '#22d3ee';
  return GROUP_COLORS[entry.group];
}

const DeviceGlyph: React.FC<{
  type: DeviceType;
  zoom: number;
  color: string;
  highlighted: boolean;
}> = ({ type, zoom, color, highlighted }) => {
  const entry = DEVICE_CATALOG[type];
  const glyph = entry.glyph;
  const strokeWidth = 1.8 / zoom;
  const wet = entry.ipRating !== 'IP20';

  if (glyph === 'socket') {
    // Полукруг на стене + штыри внутрь комнаты: число пар = число гнёзд.
    const r = 7 / zoom;
    const centers =
      entry.outlets === 3
        ? [-6 / zoom, 0, 6 / zoom]
        : entry.outlets === 2
          ? [-3.75 / zoom, 3.75 / zoom]
          : [0];
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
        {centers.flatMap((cx) =>
          [-1.6 / zoom, 1.6 / zoom].map((dx) => (
            <Line
              key={`prong-${cx}-${dx}`}
              points={[cx + dx, -r + 1 / zoom, cx + dx, -r - 5 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
          ))
        )}
        {entry.connection === 'terminal' && (
          <Rect
            x={-2.6 / zoom}
            y={1 / zoom}
            width={5.2 / zoom}
            height={2.4 / zoom}
            cornerRadius={0.6 / zoom}
            fill={color}
          />
        )}
        {wet && <Circle x={0} y={-r * 0.45} radius={1.6 / zoom} fill={color} />}
      </Group>
    );
  }

  if (
    glyph === 'switch_key' ||
    glyph === 'switch_pass' ||
    glyph === 'switch_cross' ||
    glyph === 'switch_dimmer' ||
    glyph === 'switch_motion' ||
    glyph === 'switch_presence' ||
    glyph === 'switch_provision'
  ) {
    const stem = 4 / zoom;
    const r = 4.5 / zoom;
    const cy = -stem - r;
    const keys = entry.keys ?? 1;
    return (
      <Group>
        <Line points={[0, 0, 0, -stem]} stroke={color} strokeWidth={strokeWidth} />
        <Circle
          x={0}
          y={cy}
          radius={r}
          fill="#0f172a"
          stroke={color}
          strokeWidth={strokeWidth}
          dash={glyph === 'switch_provision' ? [2.5 / zoom, 2 / zoom] : undefined}
        />
        {glyph === 'switch_key' &&
          Array.from({ length: keys }, (_, index) => {
            const offset = ((index - (keys - 1) / 2) * 3.2) / zoom;
            return (
              <Line
                key={`key-${index}`}
                points={[
                  offset - 1.6 / zoom,
                  cy + 1.5 / zoom,
                  offset + 2.2 / zoom,
                  cy - 3 / zoom,
                ]}
                stroke={color}
                strokeWidth={strokeWidth}
              />
            );
          })}
        {glyph === 'switch_pass' && (
          <>
            <Line
              points={[-3 / zoom, cy + 3 / zoom, 3 / zoom, cy - 3 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <Line
              points={[-3 / zoom, cy + 3 / zoom, -1.2 / zoom, cy + 3 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <Line
              points={[-3 / zoom, cy + 3 / zoom, -3 / zoom, cy + 1.2 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <Line
              points={[3 / zoom, cy - 3 / zoom, 1.2 / zoom, cy - 3 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <Line
              points={[3 / zoom, cy - 3 / zoom, 3 / zoom, cy - 1.2 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
          </>
        )}
        {glyph === 'switch_cross' && (
          <>
            <Line
              points={[-3 / zoom, cy - 3 / zoom, 3 / zoom, cy + 3 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <Line
              points={[-3 / zoom, cy + 3 / zoom, 3 / zoom, cy - 3 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
          </>
        )}
        {glyph === 'switch_dimmer' && (
          <>
            <Line
              points={[-3 / zoom, cy + 3 / zoom, 3 / zoom, cy - 3 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <Shape
              sceneFunc={(ctx, shape) => {
                ctx.beginPath();
                ctx.moveTo(-1 / zoom, cy + 3.4 / zoom);
                ctx.lineTo(3 / zoom, cy + 3.4 / zoom);
                ctx.lineTo(3 / zoom, cy - 0.6 / zoom);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
              }}
              fill={color}
              stroke={color}
              strokeWidth={1 / zoom}
            />
          </>
        )}
        {(glyph === 'switch_motion' || glyph === 'switch_presence') && (
          <Shape
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              ctx.arc(0, cy, r + 2.5 / zoom, -Math.PI * 0.15, Math.PI * 0.65);
              ctx.strokeShape(shape);
            }}
            stroke={color}
            strokeWidth={strokeWidth}
            fillEnabled={false}
          />
        )}
        {(glyph === 'switch_presence' || glyph === 'switch_provision') && (
          <Circle x={0} y={cy} radius={1.4 / zoom} fill={color} />
        )}
      </Group>
    );
  }

  if (
    glyph === 'light_ceiling' ||
    glyph === 'light_surface' ||
    glyph === 'light_recessed' ||
    glyph === 'light_outdoor' ||
    glyph === 'light_provision'
  ) {
    const r = 8 / zoom;
    return (
      <Group>
        <Circle
          radius={r}
          fill="#0f172a"
          stroke={color}
          strokeWidth={strokeWidth}
          dash={glyph === 'light_provision' ? [3 / zoom, 2 / zoom] : undefined}
          shadowColor={color}
          shadowBlur={highlighted ? 16 / zoom : 0}
        />
        {glyph === 'light_ceiling' && (
          <>
            <Line points={[-r * 0.7, -r * 0.7, r * 0.7, r * 0.7]} stroke={color} strokeWidth={strokeWidth} />
            <Line points={[-r * 0.7, r * 0.7, r * 0.7, -r * 0.7]} stroke={color} strokeWidth={strokeWidth} />
          </>
        )}
        {glyph === 'light_surface' && (
          <Line points={[-r * 0.8, -r * 0.8, r * 0.8, -r * 0.8]} stroke={color} strokeWidth={strokeWidth} />
        )}
        {glyph === 'light_recessed' && (
          <Circle
            radius={r * 0.52}
            stroke={color}
            strokeWidth={strokeWidth}
            dash={[2 / zoom, 1.5 / zoom]}
          />
        )}
        {glyph === 'light_outdoor' &&
          Array.from({ length: 8 }, (_, index) => {
            const angle = (Math.PI / 4) * index;
            return (
              <Line
                key={`ray-${index}`}
                points={[
                  Math.cos(angle) * r * 1.15,
                  Math.sin(angle) * r * 1.15,
                  Math.cos(angle) * r * 1.6,
                  Math.sin(angle) * r * 1.6,
                ]}
                stroke={color}
                strokeWidth={strokeWidth}
              />
            );
          })}
        {glyph === 'light_provision' && <Circle radius={1.6 / zoom} fill={color} />}
      </Group>
    );
  }

  if (glyph === 'light_sconce' || glyph === 'light_wall_wet') {
    const stem = 3 / zoom;
    const r = 4.5 / zoom;
    return (
      <Group>
        <Line points={[0, 0, 0, -stem]} stroke={color} strokeWidth={strokeWidth} />
        <Shape
          sceneFunc={(ctx, shape) => {
            ctx.beginPath();
            ctx.arc(0, -stem, r, Math.PI, 2 * Math.PI, false);
            ctx.closePath();
            ctx.fillStrokeShape(shape);
          }}
          fill="#0f172a"
          stroke={color}
          strokeWidth={strokeWidth}
        />
        <Line
          points={[-r * 0.6, -stem - r * 0.6, -r * 1.3, -stem - r * 1.3]}
          stroke={color}
          strokeWidth={strokeWidth}
        />
        <Line
          points={[r * 0.6, -stem - r * 0.6, r * 1.3, -stem - r * 1.3]}
          stroke={color}
          strokeWidth={strokeWidth}
        />
        {glyph === 'light_wall_wet' && (
          <Circle x={0} y={-stem - r * 0.45} radius={1.5 / zoom} fill={color} />
        )}
      </Group>
    );
  }

  if (glyph === 'light_track') {
    const half = 8 / zoom;
    return (
      <Group>
        <Line
          points={[-half, -6 / zoom, half, -6 / zoom]}
          stroke={color}
          strokeWidth={strokeWidth}
        />
        {[-0.6, 0, 0.6].map((ratio) => (
          <Group key={`track-${ratio}`}>
            <Line
              points={[ratio * half, -6 / zoom, ratio * half, -2.5 / zoom]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <Circle x={ratio * half} y={-2.5 / zoom} radius={1.2 / zoom} fill={color} />
          </Group>
        ))}
      </Group>
    );
  }

  // Светодиодная лента — единственный оставшийся вариант каталога.
  const half = 9 / zoom;
  return (
    <Group>
      <Line
        points={[-half, 0, half, 0]}
        stroke={color}
        strokeWidth={strokeWidth}
        dash={[3 / zoom, 2 / zoom]}
      />
      <Line points={[-half, -2 / zoom, -half, 2 / zoom]} stroke={color} strokeWidth={strokeWidth} />
      <Line points={[half, -2 / zoom, half, 2 / zoom]} stroke={color} strokeWidth={strokeWidth} />
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
  assignHint: boolean;
}> = ({ resolved, zoom, selected, lineColor, lineHighlighted, dimmed, assignHint }) => {
  const color = deviceColor(resolved.device.type);

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
          {assignHint && (
            <Circle
              radius={13 / zoom}
              stroke="#a3e635"
              strokeWidth={1.5 / zoom}
              dash={[4 / zoom, 3 / zoom]}
              opacity={0.9}
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
  assignLineId,
}) => {
  const focusLineId = assignLineId ?? highlightedLineId;
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
            lineHighlighted={lineId !== null && lineId === focusLineId}
            dimmed={focusLineId !== null && lineId !== focusLineId}
            assignHint={assignLineId !== null && lineId === null}
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

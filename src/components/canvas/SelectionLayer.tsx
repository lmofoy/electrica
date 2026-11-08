import React from 'react';
import { Layer, Line, Circle, Rect, Group } from 'react-konva';
import type { FreePartition, Opening, Selection } from '../../types';
import type { ResolvedDevice } from '../../core/electrical/devices';
import type { DevicePose } from '../../core/electrical/devices';
import {
  PANEL_SYMBOL_DEPTH_MM,
  PANEL_SYMBOL_WIDTH_MM,
} from '../../core/electrical/panel';

interface SelectionLayerProps {
  selection: Selection | null;
  openings: Opening[];
  partitions: FreePartition[];
  devices: ResolvedDevice[];
  panelId: string | null;
  panelPose: DevicePose | null;
  zoom: number;
  onSelect: (selection: Selection) => void;
}

export const SelectionLayer: React.FC<SelectionLayerProps> = ({
  selection,
  openings,
  partitions,
  devices,
  panelId,
  panelPose,
  zoom,
  onSelect,
}) => {
  const isSelected = (kind: Selection['kind'], id: string) =>
    selection?.kind === kind && selection.id === id;

  return (
    <Layer>
      {/* Проёмы: невидимая широкая линия для попадания мышью */}
      {openings.map((opening) => {
        const selected = isSelected('opening', opening.id);
        return (
          <React.Fragment key={opening.id}>
            <Line
              points={[opening.p1.x, opening.p1.y, opening.p2.x, opening.p2.y]}
              stroke="rgba(2, 6, 23, 0.001)"
              strokeWidth={Math.max(opening.wallThicknessMm, 16 / zoom)}
              hitStrokeWidth={Math.max(opening.wallThicknessMm, 16 / zoom)}
              onClick={(e) => {
                e.cancelBubble = true;
                onSelect({ kind: 'opening', id: opening.id });
              }}
            />
            {selected && (
              <Line
                points={[opening.p1.x, opening.p1.y, opening.p2.x, opening.p2.y]}
                stroke="#38bdf8"
                strokeWidth={3 / zoom}
                lineCap="round"
                shadowColor="#38bdf8"
                shadowBlur={12 / zoom}
                opacity={0.9}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* Перегородки */}
      {partitions.map((partition) => {
        const selected = isSelected('partition', partition.id);
        return (
          <React.Fragment key={partition.id}>
            <Line
              points={[partition.p1.x, partition.p1.y, partition.p2.x, partition.p2.y]}
              stroke="rgba(2, 6, 23, 0.001)"
              strokeWidth={Math.max(partition.thicknessMm, 14 / zoom)}
              hitStrokeWidth={Math.max(partition.thicknessMm, 14 / zoom)}
              lineCap="round"
              onClick={(e) => {
                e.cancelBubble = true;
                onSelect({ kind: 'partition', id: partition.id });
              }}
            />
            {selected && (
              <Line
                points={[partition.p1.x, partition.p1.y, partition.p2.x, partition.p2.y]}
                stroke="#38bdf8"
                strokeWidth={3 / zoom}
                lineCap="round"
                shadowColor="#38bdf8"
                shadowBlur={12 / zoom}
                opacity={0.9}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* Электроприборы: зона попадания вокруг каждого зеркального символа */}
      {devices.map((resolved) => (
        <React.Fragment key={resolved.device.id}>
          {resolved.poses.map((pose, index) => (
            <Circle
              key={`${resolved.device.id}-hit-${index}`}
              x={pose.position.x}
              y={pose.position.y}
              radius={14 / zoom}
              fill="rgba(2, 6, 23, 0.001)"
              onClick={(e) => {
                e.cancelBubble = true;
                onSelect({ kind: 'device', id: resolved.device.id });
              }}
            />
          ))}
        </React.Fragment>
      ))}

      {/* Электрощиток */}
      {panelId && panelPose && (
        <Group
          x={panelPose.position.x}
          y={panelPose.position.y}
          rotation={panelPose.rotationDeg}
        >
          <Rect
            x={-PANEL_SYMBOL_WIDTH_MM / 2}
            y={-PANEL_SYMBOL_DEPTH_MM / 2}
            width={PANEL_SYMBOL_WIDTH_MM}
            height={PANEL_SYMBOL_DEPTH_MM}
            fill="rgba(2, 6, 23, 0.001)"
            onClick={(e) => {
              e.cancelBubble = true;
              onSelect({ kind: 'panel', id: panelId });
            }}
          />
          {isSelected('panel', panelId) && (
            <Rect
              x={-PANEL_SYMBOL_WIDTH_MM / 2}
              y={-PANEL_SYMBOL_DEPTH_MM / 2}
              width={PANEL_SYMBOL_WIDTH_MM}
              height={PANEL_SYMBOL_DEPTH_MM}
              stroke="#38bdf8"
              strokeWidth={3 / zoom}
              dash={[6 / zoom, 4 / zoom]}
              listening={false}
            />
          )}
        </Group>
      )}
    </Layer>
  );
};

import React, { useRef } from 'react';
import { Layer, Line, Circle, Rect, Group } from 'react-konva';
import type Konva from 'konva';
import type {
  FreePartition,
  MountingFrame,
  Opening,
  Point2D,
  RoomZone,
  Selection,
} from '../../types';
import type { ResolvedDevice } from '../../core/electrical/devices';
import type { DevicePose } from '../../core/electrical/devices';
import {
  deviceLineSlotCount,
  deviceTerminalPoint,
} from '../../core/electrical/devices';
import {
  PANEL_SYMBOL_DEPTH_MM,
  PANEL_SYMBOL_WIDTH_MM,
} from '../../core/electrical/panel';
import {
  FRAME_PLATE_DEPTH_MM,
  framePlateWidthMm,
  resolveFramePose,
} from '../../core/electrical/frames';

interface SelectionLayerProps {
  selection: Selection | null;
  listening: boolean;
  openings: Opening[];
  partitions: FreePartition[];
  devices: ResolvedDevice[];
  frames: MountingFrame[];
  rooms: RoomZone[];
  thickness: number;
  panelId: string | null;
  panelPose: DevicePose | null;
  zoom: number;
  onSelect: (selection: Selection) => void;
  /** Включает перетаскивание рамок и приборов (колбэки должны быть переданы). */
  canDrag?: boolean;
  onFrameDrag?: (id: string, point: Point2D, phase: 'move' | 'end') => void;
  onDeviceDrag?: (id: string, point: Point2D, phase: 'move' | 'end') => void;
}

type LayerDragEvent = Konva.KonvaEventObject<DragEvent>;

export const SelectionLayer: React.FC<SelectionLayerProps> = ({
  selection,
  listening,
  openings,
  partitions,
  devices,
  frames,
  rooms,
  thickness,
  panelId,
  panelPose,
  zoom,
  onSelect,
  canDrag = false,
  onFrameDrag,
  onDeviceDrag,
}) => {
  const isSelected = (kind: Selection['kind'], id: string) =>
    selection?.kind === kind && selection.id === id;

  // Konva dragstart срабатывает только после порога движения; флаг нужен,
  // чтобы клик, завершающий перетаскивание, не менял выделение.
  const draggingRef = useRef(false);

  const frameDraggable = Boolean(canDrag && onFrameDrag);
  const deviceDraggable = Boolean(canDrag && onDeviceDrag);

  // Мировая точка курсора в мм (не позиция узла: узлы двигаются вместе с указателем).
  const pointerMm = (e: LayerDragEvent): Point2D | null => {
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return {
      x: (pointer.x - stage.x()) / stage.scaleX(),
      y: (pointer.y - stage.y()) / stage.scaleY(),
    };
  };

  const handleDragStart = (e: LayerDragEvent) => {
    draggingRef.current = true;
    e.cancelBubble = true;
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = 'grabbing';
  };

  const handleDragMove = (
    e: LayerDragEvent,
    id: string,
    callback?: (id: string, point: Point2D, phase: 'move' | 'end') => void
  ) => {
    e.cancelBubble = true;
    const point = pointerMm(e);
    if (point) callback?.(id, point, 'move');
  };

  const handleDragEnd = (
    e: LayerDragEvent,
    id: string,
    restore: () => void,
    callback?: (id: string, point: Point2D, phase: 'move' | 'end') => void
  ) => {
    e.cancelBubble = true;
    const point = pointerMm(e);
    if (point) callback?.(id, point, 'end');
    // Hit-зоны прозрачные, поэтому возврат узла незаметен; превью рисует другой слой.
    restore();
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = '';
    // Сбрасываем флаг после того, как клик текущего жеста уже обработан.
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  };

  const handleHitClick = (
    e: Konva.KonvaEventObject<MouseEvent>,
    next: Selection
  ) => {
    if (draggingRef.current) return;
    if (e.evt.button !== 0) return;
    e.cancelBubble = true;
    onSelect(next);
  };

  const handleHitEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!canDrag || draggingRef.current) return;
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = 'move';
  };

  const handleHitLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Во время перетаскивания курсор не трогаем: его сбросит dragend.
    if (draggingRef.current) return;
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = '';
  };

  return (
    <Layer listening={listening}>
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
                if (e.evt.button !== 0) return;
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
                if (e.evt.button !== 0) return;
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

      {/* Рамки: попадание по плате — до приборов, чтобы механизмы оставались кликабельными */}
      {frames.map((frame) => {
        const pose = resolveFramePose(frame, rooms, partitions, thickness);
        if (!pose) return null;
        const width = framePlateWidthMm(frame.posts);
        const selected = isSelected('frame', frame.id);
        return (
          <Group
            key={`frame-${frame.id}`}
            x={pose.position.x}
            y={pose.position.y}
            rotation={pose.rotationDeg}
          >
            <Rect
              x={-width / 2}
              y={-FRAME_PLATE_DEPTH_MM / 2}
              width={width}
              height={FRAME_PLATE_DEPTH_MM}
              fill="rgba(2, 6, 23, 0.001)"
              draggable={frameDraggable}
              onClick={(e) => handleHitClick(e, { kind: 'frame', id: frame.id })}
              onMouseEnter={frameDraggable ? handleHitEnter : undefined}
              onMouseLeave={frameDraggable ? handleHitLeave : undefined}
              onDragStart={frameDraggable ? handleDragStart : undefined}
              onDragMove={
                frameDraggable
                  ? (e) => handleDragMove(e, frame.id, onFrameDrag)
                  : undefined
              }
              onDragEnd={
                frameDraggable
                  ? (e) =>
                      handleDragEnd(
                        e,
                        frame.id,
                        () => {
                          e.target.setAttrs({
                            x: -width / 2,
                            y: -FRAME_PLATE_DEPTH_MM / 2,
                          });
                        },
                        onFrameDrag
                      )
                  : undefined
              }
            />
            {selected && (
              <Rect
                x={-width / 2}
                y={-FRAME_PLATE_DEPTH_MM / 2}
                width={width}
                height={FRAME_PLATE_DEPTH_MM}
                stroke="#38bdf8"
                strokeWidth={1.6 / zoom}
                dash={[5 / zoom, 3 / zoom]}
                listening={false}
              />
            )}
          </Group>
        );
      })}

      {/* Электроприборы: зона попадания вокруг каждого зеркального символа */}
      {devices.map((resolved) => (
        <React.Fragment key={resolved.device.id}>
          {resolved.poses.map((pose, index) => (
            <React.Fragment key={`${resolved.device.id}-hit-${index}`}>
            <Circle
              x={pose.position.x}
              y={pose.position.y}
              radius={14 / zoom}
              fill="rgba(2, 6, 23, 0.001)"
              draggable={deviceDraggable}
              onClick={(e) =>
                handleHitClick(e, { kind: 'device', id: resolved.device.id })
              }
              onMouseEnter={deviceDraggable ? handleHitEnter : undefined}
              onMouseLeave={deviceDraggable ? handleHitLeave : undefined}
              onDragStart={deviceDraggable ? handleDragStart : undefined}
              onDragMove={
                deviceDraggable
                  ? (e) => handleDragMove(e, resolved.device.id, onDeviceDrag)
                  : undefined
              }
              onDragEnd={
                deviceDraggable
                  ? (e) =>
                      handleDragEnd(
                        e,
                        resolved.device.id,
                        () => {
                          e.target.setAttrs({
                            x: pose.position.x,
                            y: pose.position.y,
                          });
                        },
                        onDeviceDrag
                      )
                  : undefined
              }
            />
            {(() => {
              const slotCount = deviceLineSlotCount(resolved.device);
              if (slotCount < 2) return null;
              return Array.from({ length: slotCount }, (_, slot) => {
                const point = deviceTerminalPoint(pose, slot, slotCount);
                return (
                  <Circle
                    key={`${resolved.device.id}-terminal-${index}-${slot}`}
                    x={point.x}
                    y={point.y}
                    radius={7 / zoom}
                    fill="rgba(2, 6, 23, 0.001)"
                    onClick={(e) =>
                      handleHitClick(e, {
                        kind: 'device',
                        id: resolved.device.id,
                        slot,
                      })
                    }
                  />
                );
              });
            })()}
            </React.Fragment>
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
              if (e.evt.button !== 0) return;
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

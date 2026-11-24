import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Stage } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { GridLayer } from './GridLayer';
import { RoomsLayer } from './RoomsLayer';
import { WallsAndDimensionsLayer } from './WallsAndDimensionsLayer';
import { SelectionLayer } from './SelectionLayer';
import { RoutingLayer } from './RoutingLayer';
import { ElectricalLayer, type FramePreview } from './ElectricalLayer';
import { DraftingLayer } from './DraftingLayer';
import { ManualRouteLayer } from './ManualRouteLayer';
import { RouteLinkLayer } from './RouteLinkLayer';
import { RouteStopsPopover } from './RouteStopsPopover';
import { LineCompositionCard } from './LineCompositionCard';
import { CadFloatingInput } from './CadFloatingInput';
import { Rulers } from './Rulers';
import { snapToGrid, distance, polarToPoint, angleDeg, snapAngle } from '../../core/geometry/math';
import { findBestSnapAdvanced } from '../../core/geometry/snapping';
import { buildAutoLayout } from '../../core/geometry/autoLayout';
import {
  DEVICE_CATALOG,
  buildPlacementDimensions,
  findDevicePlacement,
  resolveDevice,
  type ResolvedDevice,
} from '../../core/electrical/devices';
import { resolvePanelPose } from '../../core/electrical/panel';
import { findFramePlacement } from '../../core/electrical/frames';
import { buildDeviceLineMap } from '../../core/electrical/lineAssignment';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { computeLineRoutes, materializeRouteForLine } from '../../core/electrical/routing';
import {
  manualRouteConnectedDeviceIds,
  moveManualRouteNode,
} from '../../core/electrical/manualRoute';
import {
  routeJunctionPlacementError,
  type RouteLinkAxis,
  type RouteLinkEndpoint,
} from '../../core/electrical/routeLink';
import { collectRoomElements, formatRoomDeletionPrompt } from '../../core/model/roomElements';
import type {
  DevicePartitionAnchor,
  DeviceRoomEdgeAnchor,
  ElectricalDevice,
  ManualRoute,
  MountingFrame,
  Point2D,
} from '../../types';
import { Home, PenTool, CircuitBoard } from 'lucide-react';

Konva.dragButtons = [0];

// Пустая линия: трассы ещё нет, но редактор монтажа должен открываться.
const EMPTY_ROUTE: ManualRoute = { nodes: [], paths: [], anchors: [] };

type RouteLinkTool = 'link' | 'junction';

interface RouteLinkSession {
  lineId: string;
  tool: RouteLinkTool;
  from: RouteLinkEndpoint | null;
  axisFirst: RouteLinkAxis;
}

interface RouteLinkHover {
  point: Point2D;
  endpoint: RouteLinkEndpoint | null;
  label: string;
}

export const CADCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Перетаскивание холста колесиком мыши (Middle Click Drag)
  const isMiddleDraggingRef = useRef(false);
  const dragStartPosRef = useRef({ clientX: 0, clientY: 0, stageX: 0, stageY: 0 });

  const {
    apartment,
    rooms,
    openings,
    freePartitions,
    devices,
    frames,
    panel,
    nodes,
    walls,
    selection,
    highlightedLineId,
    lineAssignLineId,
    settings,
    designMode,
    activeTool,
    activeDeviceType,
    deviceShared,
    activeFramePosts,
    activeFrameMounting,
    activeFrameSeatTypes,
    zoom,
    stagePos,
    gridSnap,
    gridStepMm,
    draftVertices,
    cursorPosMm,
    dynamicInput,
    activeSnap,
    setZoom,
    setStagePos,
    setCursorPosMm,
    setSelection,
    setActiveTool,
    setHighlightedLine,
    setLineAssignLine,
    cancelLineAssignment,
    assignDevicesToLine,
    unassignDevicesFromLines,
    setActiveSnap,
    addDraftVertex,
    popDraftVertex,
    finishDraft,
    cancelDraft,
    openDynamicInput,
    closeDynamicInput,
    setLockedLength,
    setDynamicInputValues,
    startApartmentDrawing,
    startRoomDrawing,
    addDevice,
    addFrame,
    moveFrame,
    moveDevice,
    placePanel,
    addToast,
    drawingStage,
    boundaryMode,
    activeStep,
    routeEditLineId,
    setRouteEditLine,
    moveLineRouteNode,
    insertLineRouteNode,
    removeLineRouteNode,
    removeLineRouteSegment,
    reorderLineRouteStops,
    resetLineRoute,
    addLineRouteJunction,
    linkLineRoute,
  } = useProjectStore();

  const autoLayout = useMemo(() => {
    if (boundaryMode !== 'auto') return null;
    return buildAutoLayout(
      rooms,
      freePartitions,
      openings,
      settings.defaultWallThicknessMm
    );
  }, [
    boundaryMode,
    rooms,
    freePartitions,
    openings,
    settings.defaultWallThicknessMm,
  ]);

  const resolvedDevices = useMemo(
    () =>
      devices
        .map((device) =>
          resolveDevice(
            device,
            rooms,
            freePartitions,
            settings.defaultWallThicknessMm
          )
        )
        .filter((device): device is ResolvedDevice => device !== null),
    [devices, rooms, freePartitions, settings.defaultWallThicknessMm]
  );

  const [routePreview, setRoutePreview] = useState<{
    lineId: string;
    route: ManualRoute | null;
    error: string | null;
    sourcePanel: typeof panel;
  } | null>(null);
  const [routeNodeSelection, setRouteNodeSelection] = useState<{
    lineId: string;
    index: number;
  } | null>(null);
  const [routeSegmentMode, setRouteSegmentMode] = useState<{
    lineId: string;
  } | null>(null);
  // Каждое соединение и узел сохраняются сразу: отдельного черновика,
  // который заменил бы трассу, больше нет.
  const [routeLink, setRouteLink] = useState<RouteLinkSession | null>(null);
  const [routeLinkHover, setRouteLinkHover] = useState<RouteLinkHover | null>(
    null
  );
  // Перенос прибора чужой линии: мини-карточка у места клика, не модальное окно.
  const [transferPrompt, setTransferPrompt] = useState<{
    deviceId: string;
    fromLineId: string;
    toLineId: string;
    left: number;
    top: number;
  } | null>(null);
  const routeEditing = activeTool === 'select' && designMode === 'electrical';

  // Превью и выделение живут вместе со своей линией и панелью: после смены
  // линии или отмены действия они просто перестают учитываться без сброса
  // через эффекты.
  const activeRoutePreview =
    routePreview && routePreview.lineId === routeEditLineId ? routePreview : null;
  const routePreviewRoute =
    activeRoutePreview && activeRoutePreview.sourcePanel === panel
      ? activeRoutePreview.route
      : null;
  const routePreviewError = activeRoutePreview?.error ?? null;
  const routeNodeSelectionIndex =
    routeNodeSelection && routeNodeSelection.lineId === routeEditLineId
      ? routeNodeSelection.index
      : null;
  const routeSegmentModeActive =
    routeSegmentMode !== null && routeSegmentMode.lineId === routeEditLineId;

  const previewPanel = useMemo(() => {
    if (!panel || !routePreviewRoute || !routeEditing || !routeEditLineId) return panel;
    return {
      ...panel,
      lines: panel.lines.map((line) =>
        line.id === routeEditLineId
          ? { ...line, manualRoute: routePreviewRoute }
          : line
      ),
    };
  }, [panel, routePreviewRoute, routeEditing, routeEditLineId]);

  const lineColorMap = useMemo(() => buildLineColorMap(panel), [panel]);
  const lineRoutes = useMemo(
    () =>
      computeLineRoutes({
        panel: previewPanel,
        devices,
        rooms,
        partitions: freePartitions,
        nodes,
        walls,
        settings,
      }),
    [previewPanel, devices, rooms, freePartitions, nodes, walls, settings]
  );
  const deviceLineMap = useMemo(() => buildDeviceLineMap(panel), [panel]);
  const deviceLineIds = useMemo(
    () =>
      new Map(
        [...deviceLineMap].map(([deviceId, line]) => [deviceId, line.id] as const)
      ),
    [deviceLineMap]
  );

  const assignLine = useMemo(
    () => panel?.lines.find((line) => line.id === lineAssignLineId) ?? null,
    [panel, lineAssignLineId]
  );
  const activeTransferPrompt =
    transferPrompt && assignLine && transferPrompt.toLineId === assignLine.id
      ? transferPrompt
      : null;

  const routeEditLine = useMemo(
    () => routeEditing ? panel?.lines.find((line) => line.id === routeEditLineId) ?? null : null,
    [panel, routeEditLineId, routeEditing]
  );

  const activeRouteLink =
    routeLink && routeEditLine && routeLink.lineId === routeEditLine.id
      ? routeLink
      : null;

  const routeEditRoute = useMemo(() => {
    if (!routeEditLine || !panel) return null;
    if (routePreviewRoute) return routePreviewRoute;
    return materializeRouteForLine(
      {
        panel,
        devices,
        rooms,
        partitions: freePartitions,
        nodes,
        walls,
        settings,
      },
      routeEditLine.id
    );
  }, [
    routeEditLine,
    routePreviewRoute,
    panel,
    devices,
    rooms,
    freePartitions,
    nodes,
    walls,
    settings,
  ]);

  // База перетаскивания фиксируется на весь жест: превью считается от неё,
  // а не от предыдущего превью, иначе правки накапливались бы.
  const routeDragBaseRef = useRef<{
    lineId: string;
    panel: typeof panel;
    route: ManualRoute;
  } | null>(null);

  const selectRouteNode = useCallback(
    (index: number | null) => {
      if (index === null || !routeEditLine) {
        setRouteNodeSelection(null);
        return;
      }
      setRouteNodeSelection({ lineId: routeEditLine.id, index });
    },
    [routeEditLine]
  );

  const previewRouteNode = useCallback(
    (nodeIndex: number, point: Point2D): Point2D | null => {
      if (!routeEditLine) return null;
      const stored = routeDragBaseRef.current;
      const base =
        stored && stored.lineId === routeEditLine.id && stored.panel === panel
          ? stored.route
          : routeEditRoute;
      if (!base) return null;
      routeDragBaseRef.current = { lineId: routeEditLine.id, panel, route: base };
      const result = moveManualRouteNode(base, nodeIndex, point);
      setRoutePreview({
        lineId: routeEditLine.id,
        sourcePanel: panel,
        route: result.ok ? result.route : base,
        error: result.ok ? null : result.error,
      });
      return result.ok ? result.route.nodes[result.nodeIndex] ?? null : null;
    },
    [routeEditLine, routeEditRoute, panel]
  );

  const commitRouteNode = useCallback(
    (nodeIndex: number, point: Point2D) => {
      if (!routeEditLine) return;
      routeDragBaseRef.current = null;
      setRoutePreview(null);
      const newIndex = moveLineRouteNode(routeEditLine.id, nodeIndex, point);
      if (newIndex !== null) {
        setRouteNodeSelection({ lineId: routeEditLine.id, index: newIndex });
      }
    },
    [routeEditLine, moveLineRouteNode]
  );

  const cancelRoutePreview = useCallback(() => {
    routeDragBaseRef.current = null;
    setRoutePreview(null);
  }, []);

  const insertRouteNode = useCallback(
    (pathIndex: number, segmentIndex: number, point: Point2D) => {
      if (!routeEditLine) return;
      setRoutePreview(null);
      insertLineRouteNode(
        routeEditLine.id,
        pathIndex,
        segmentIndex,
        point,
        10 / zoom
      );
    },
    [routeEditLine, insertLineRouteNode, zoom]
  );

  const resetRoute = useCallback(() => {
    if (!routeEditLine) return;
    routeDragBaseRef.current = null;
    setRoutePreview(null);
    setRouteNodeSelection(null);
    setRouteSegmentMode(null);
    resetLineRoute(routeEditLine.id);
  }, [routeEditLine, resetLineRoute]);

  const reorderRouteStops = useCallback(
    (branchIndex: number, fromIndex: number, toIndex: number) => {
      if (!routeEditLine) return;
      routeDragBaseRef.current = null;
      setRoutePreview(null);
      // После перестановки индексы вершин меняются: выделение сбрасываем.
      setRouteNodeSelection(null);
      reorderLineRouteStops(routeEditLine.id, branchIndex, fromIndex, toIndex);
    },
    [routeEditLine, reorderLineRouteStops]
  );

  const removeRouteNode = useCallback(
    (nodeIndex: number) => {
      if (!routeEditLine) return;
      routeDragBaseRef.current = null;
      setRoutePreview(null);
      if (removeLineRouteNode(routeEditLine.id, nodeIndex)) {
        setRouteNodeSelection(null);
      }
    },
    [routeEditLine, removeLineRouteNode]
  );

  const removeRouteSegment = useCallback(
    (pathIndex: number, segmentIndex: number) => {
      if (!routeEditLine) return;
      routeDragBaseRef.current = null;
      setRoutePreview(null);
      setRouteNodeSelection(null);
      removeLineRouteSegment(routeEditLine.id, pathIndex, segmentIndex);
    },
    [routeEditLine, removeLineRouteSegment]
  );

  const toggleRouteSegmentMode = useCallback(() => {
    if (!routeEditLine) return;
    routeDragBaseRef.current = null;
    setRoutePreview(null);
    setRouteNodeSelection(null);
    setRouteSegmentMode((prev) =>
      prev && prev.lineId === routeEditLine.id ? null : { lineId: routeEditLine.id }
    );
  }, [routeEditLine]);

  const closeRouteEditor = useCallback(() => {
    setRouteSegmentMode(null);
    setRouteEditLine(null);
  }, [setRouteEditLine]);

  const toggleDeviceAssignment = useCallback(
    (deviceId: string) => {
      if (!assignLine) return;
      if (assignLine.deviceIds.includes(deviceId)) {
        unassignDevicesFromLines([deviceId]);
        return;
      }
      const owner = deviceLineMap.get(deviceId);
      if (owner && owner.id !== assignLine.id) {
        const pointer = stageRef.current?.getPointerPosition();
        setTransferPrompt({
          deviceId,
          fromLineId: owner.id,
          toLineId: assignLine.id,
          left: Math.min(Math.max(pointer?.x ?? dimensions.width / 2, 160), dimensions.width - 160),
          top: Math.min(Math.max((pointer?.y ?? 96) + 14, 48), dimensions.height - 140),
        });
        return;
      }
      assignDevicesToLine(assignLine.id, [deviceId]);
    },
    [
      assignLine,
      assignDevicesToLine,
      unassignDevicesFromLines,
      deviceLineMap,
      dimensions.width,
      dimensions.height,
    ]
  );

  const confirmDeviceTransfer = useCallback(() => {
    if (!transferPrompt) return;
    const fromLine = panel?.lines.find((line) => line.id === transferPrompt.fromLineId);
    const toLine = panel?.lines.find((line) => line.id === transferPrompt.toLineId);
    const device = devices.find((candidate) => candidate.id === transferPrompt.deviceId);
    if (!toLine) {
      setTransferPrompt(null);
      return;
    }
    assignDevicesToLine(toLine.id, [transferPrompt.deviceId]);
    addToast(
      `«${device?.name ?? 'Прибор'}» перенесён из «${fromLine?.name ?? 'линии'}» в «${toLine.name}».`,
      'success'
    );
    setTransferPrompt(null);
  }, [transferPrompt, panel, devices, assignDevicesToLine, addToast]);

  const devicePreview = useMemo<{ resolved: ResolvedDevice | null; error: string | null }>(() => {
    if (activeTool !== 'place_device') return { resolved: null, error: null };
    if (rooms.length === 0) {
      return { resolved: null, error: 'Сначала создайте комнату в режиме «Архитектура».' };
    }

    const thickness = settings.defaultWallThicknessMm;
    const placement = findDevicePlacement(
      activeDeviceType,
      cursorPosMm,
      rooms,
      freePartitions,
      thickness,
      deviceShared
    );
    if (!placement.ok) return { resolved: null, error: placement.error };

    const catalog = DEVICE_CATALOG[activeDeviceType];
    const draft: ElectricalDevice = {
      id: 'device-preview',
      type: activeDeviceType,
      name: catalog.label,
      anchor: placement.anchor,
      heightFromFloorMm: catalog.defaultHeightMm,
      powerWatts: catalog.defaultPowerWatts,
      shared: placement.isShared,
    };
    const resolved = resolveDevice(draft, rooms, freePartitions, thickness);
    return {
      resolved,
      error: resolved ? null : 'Не удалось построить символ прибора.',
    };
  }, [
    activeTool,
    activeDeviceType,
    cursorPosMm,
    rooms,
    freePartitions,
    deviceShared,
    settings.defaultWallThicknessMm,
  ]);

  const framePreview = useMemo<{ preview: FramePreview | null; error: string | null }>(() => {
    if (activeTool !== 'place_frame') return { preview: null, error: null };
    if (rooms.length === 0) {
      return { preview: null, error: 'Сначала создайте комнату в режиме «Архитектура».' };
    }
    const placement = findFramePlacement(
      cursorPosMm,
      activeFramePosts,
      rooms,
      freePartitions,
      settings.defaultWallThicknessMm
    );
    if (!placement.ok) return { preview: null, error: placement.error };
    return {
      preview: {
        anchor: placement.anchor,
        position: placement.position,
        rotationDeg: placement.rotationDeg,
        posts: activeFramePosts,
        mounting: activeFrameMounting,
      },
      error: null,
    };
  }, [
    activeTool,
    cursorPosMm,
    activeFramePosts,
    activeFrameMounting,
    rooms,
    freePartitions,
    settings.defaultWallThicknessMm,
  ]);

  const frameBlockSummary = `${activeFrameMounting === 'flush' ? 'скрытая' : 'накладная'} · ${activeFrameSeatTypes
    .slice(0, activeFramePosts)
    .map((type) => (type ? DEVICE_CATALOG[type].shortLabel : 'заглушка'))
    .join(' · ')}`;

  // Перетаскивание с плана: превью на новом месте, фиксация — на отпускании.
  const [elementDrag, setElementDrag] = useState<{
    frame: FramePreview | null;
    device: ResolvedDevice | null;
  }>({ frame: null, device: null });

  const handleElementDrag = useCallback(
    (
      target: { kind: 'frame' | 'device'; id: string },
      point: Point2D,
      phase: 'move' | 'end'
    ) => {
      const thickness = settings.defaultWallThicknessMm;
      const placeFrame = (frame: MountingFrame) => {
        const placement = findFramePlacement(
          point,
          frame.posts,
          rooms,
          freePartitions,
          thickness
        );
        const preview: FramePreview | null = placement.ok
          ? {
              anchor: placement.anchor,
              position: placement.position,
              rotationDeg: placement.rotationDeg,
              posts: frame.posts,
              mounting: frame.mounting,
            }
          : null;
        return {
          preview,
          devicePreview: null as ResolvedDevice | null,
          commit: () => {
            if (!placement.ok) {
              addToast(placement.error, 'error');
              return false;
            }
            setSelection({ kind: 'frame', id: frame.id });
            return moveFrame(frame.id, placement.anchor);
          },
        };
      };

      let result: {
        preview: FramePreview | null;
        devicePreview: ResolvedDevice | null;
        commit: () => boolean;
      } | null = null;

      if (target.kind === 'frame') {
        const frame = frames.find((candidate) => candidate.id === target.id);
        if (frame) result = placeFrame(frame);
      } else {
        const device = devices.find((candidate) => candidate.id === target.id);
        if (device) {
          // Механизм не двигается отдельно: тянем его подрозетник целиком.
          const frame = device.frameId
            ? frames.find((candidate) => candidate.id === device.frameId)
            : undefined;
          if (frame) {
            result = placeFrame(frame);
          } else {
            const placement = findDevicePlacement(
              device.type,
              point,
              rooms,
              freePartitions,
              thickness,
              device.shared
            );
            const preview = placement.ok
              ? resolveDevice(
                  { ...device, anchor: placement.anchor },
                  rooms,
                  freePartitions,
                  thickness
                )
              : null;
            result = {
              preview: null,
              devicePreview: preview,
              commit: () => {
                if (!placement.ok) {
                  addToast(placement.error, 'error');
                  return false;
                }
                setSelection({ kind: 'device', id: device.id });
                return moveDevice(device.id, placement.anchor);
              },
            };
          }
        }
      }

      if (!result) return;
      if (phase === 'end') {
        setElementDrag({ frame: null, device: null });
        result.commit();
        return;
      }
      setElementDrag({ frame: result.preview, device: result.devicePreview });
    },
    [
      frames,
      devices,
      rooms,
      freePartitions,
      settings.defaultWallThicknessMm,
      moveFrame,
      moveDevice,
      addToast,
      setSelection,
    ]
  );

  const canDragElements =
    activeTool === 'select' && !routeEditLine && !assignLine;

  const placementDims = useMemo(() => {
    if (activeTool !== 'place_device' || !devicePreview.resolved) return [];
    return buildPlacementDimensions(
      activeDeviceType,
      cursorPosMm,
      rooms,
      freePartitions,
      settings.defaultWallThicknessMm
    );
  }, [
    activeTool,
    devicePreview.resolved,
    activeDeviceType,
    cursorPosMm,
    rooms,
    freePartitions,
    settings.defaultWallThicknessMm,
  ]);

  const panelPose = useMemo(
    () =>
      panel
        ? resolvePanelPose(
            panel,
            rooms,
            freePartitions,
            settings.defaultWallThicknessMm
          )
        : null,
    [panel, rooms, freePartitions, settings.defaultWallThicknessMm]
  );

  const routeLinkDevicePoints = useMemo(() => {
    if (!routeEditLine) return [];
    const points: Array<{ deviceId: string; name: string; point: Point2D }> = [];
    for (const deviceId of routeEditLine.deviceIds) {
      const resolved = resolvedDevices.find(
        (entry) => entry.device.id === deviceId
      );
      const pose = resolved?.poses[0];
      if (pose) {
        points.push({ deviceId, name: resolved.device.name, point: pose.position });
      }
    }
    return points;
  }, [routeEditLine, resolvedDevices]);

  const beginRouteLink = useCallback(
    (tool: RouteLinkTool) => {
      if (!routeEditLine) return;
      routeDragBaseRef.current = null;
      setRoutePreview(null);
      setRouteSegmentMode(null);
      setRouteNodeSelection(null);
      setRouteLinkHover(null);
      setRouteLink({
        lineId: routeEditLine.id,
        tool,
        from: null,
        axisFirst: 'h',
      });
    },
    [routeEditLine]
  );

  const exitRouteLink = useCallback(() => {
    setRouteLink(null);
    setRouteLinkHover(null);
  }, []);

  const snapRouteLink = useCallback(
    (raw: Point2D): RouteLinkHover => {
      const tolerance = 16 / zoom;
      const candidates: Array<{
        distance: number;
        priority: number;
        endpoint: RouteLinkEndpoint;
        label: string;
      }> = [];
      const push = (
        point: Point2D,
        endpoint: RouteLinkEndpoint,
        label: string,
        priority: number
      ) => {
        const span = distance(raw, point);
        if (span <= tolerance) {
          candidates.push({ distance: span, priority, endpoint, label });
        }
      };

      if (panelPose) {
        push(panelPose.position, { kind: 'panel', point: panelPose.position }, 'щиток', 0);
      }
      for (const device of routeLinkDevicePoints) {
        push(
          device.point,
          { kind: 'device', point: device.point, deviceId: device.deviceId },
          device.name,
          1
        );
      }
      for (const junction of routeEditLine?.routeJunctions ?? []) {
        push(junction, { kind: 'junction', point: junction }, 'узел', 2);
      }
      if (routeEditRoute) {
        const anchorsByNode = new Map(
          routeEditRoute.anchors.map((anchor) => [anchor.nodeIndex, anchor] as const)
        );
        routeEditRoute.nodes.forEach((point, index) => {
          const anchor = anchorsByNode.get(index);
          // Щиток и приборы берутся из живого положения, а не из снимка трассы.
          if (anchor?.kind === 'panel' || anchor?.kind === 'device') return;
          if (anchor?.kind === 'junction') {
            push(point, { kind: 'junction', point }, 'узел', 2);
          } else {
            push(point, { kind: 'point', point }, 'точка трассы', 3);
          }
        });
      }

      candidates.sort(
        (a, b) => a.distance - b.distance || a.priority - b.priority
      );
      const best = candidates[0];
      if (best) {
        return {
          point: best.endpoint.point,
          endpoint: best.endpoint,
          label: best.label,
        };
      }
      return {
        point: gridSnap ? snapToGrid(raw, gridStepMm) : raw,
        endpoint: null,
        label: activeRouteLink?.tool === 'junction' ? 'новый узел' : 'свободная точка',
      };
    },
    [
      activeRouteLink,
      panelPose,
      routeLinkDevicePoints,
      routeEditLine,
      routeEditRoute,
      zoom,
      gridSnap,
      gridStepMm,
    ]
  );

  const handleRouteLinkClick = useCallback(
    (hover: RouteLinkHover) => {
      if (!activeRouteLink || !routeEditLine) return;
      if (activeRouteLink.tool === 'junction') {
        if (hover.endpoint) {
          addToast('Узел ставится в свободной точке комнаты.', 'info');
          return;
        }
        const placementError = routeJunctionPlacementError(
          hover.point,
          rooms,
          freePartitions
        );
        if (placementError) {
          addToast(placementError, 'error');
          return;
        }
        addLineRouteJunction(routeEditLine.id, hover.point);
        return;
      }

      if (!hover.endpoint) {
        addToast(
          activeRouteLink.from
            ? 'Выберите второй конец: щиток, прибор или узел.'
            : 'Начните связь со щитка, прибора или узла.',
          'info'
        );
        return;
      }
      const endpoint = hover.endpoint;
      if (!activeRouteLink.from) {
        setRouteLink((prev) => (prev ? { ...prev, from: endpoint } : prev));
        return;
      }
      if (distance(activeRouteLink.from.point, endpoint.point) < 0.5) {
        setRouteLink((prev) => (prev ? { ...prev, from: null } : prev));
        return;
      }
      const result = linkLineRoute(
        routeEditLine.id,
        activeRouteLink.from,
        endpoint,
        activeRouteLink.axisFirst
      );
      if (result.ok) {
        setRouteLink((prev) => (prev ? { ...prev, from: null } : prev));
      } else {
        addToast(result.error, 'error');
      }
    },
    [
      activeRouteLink,
      routeEditLine,
      rooms,
      freePartitions,
      addLineRouteJunction,
      linkLineRoute,
      addToast,
    ]
  );

  const handleRouteLinkKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!activeRouteLink) return false;
      if (e.ctrlKey || e.metaKey) return false;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeRouteLink.from) {
          setRouteLink((prev) => (prev ? { ...prev, from: null } : prev));
        } else {
          exitRouteLink();
        }
        return true;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        exitRouteLink();
        return true;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setRouteLink((prev) =>
          prev
            ? { ...prev, axisFirst: prev.axisFirst === 'h' ? 'v' : 'h' }
            : prev
        );
        return true;
      }
      return false;
    },
    [activeRouteLink, exitRouteLink]
  );

  useEffect(() => {
    if (routeEditLine) {
      setHighlightedLine(routeEditLine.id);
      return;
    }
    if (selection?.kind === 'device') {
      setHighlightedLine(deviceLineMap.get(selection.id)?.id ?? null);
      return;
    }
    if (selection !== null) setHighlightedLine(null);
  }, [selection, deviceLineMap, routeEditLine, setHighlightedLine]);

  const panelPreview = useMemo<{
    position: Point2D;
    rotationDeg: number;
    error: string | null;
  } | null>(() => {
    if (activeTool !== 'place_panel') return null;
    if (rooms.length === 0) {
      return {
        position: cursorPosMm,
        rotationDeg: 0,
        error: 'Сначала создайте комнату в режиме «Архитектура».',
      };
    }
    const placement = findDevicePlacement(
      'socket_single',
      cursorPosMm,
      rooms,
      freePartitions,
      settings.defaultWallThicknessMm,
      false
    );
    if (!placement.ok) {
      return {
        position: cursorPosMm,
        rotationDeg: 0,
        error: placement.error,
      };
    }
    return {
      position: placement.position,
      rotationDeg: placement.rotationDeg,
      error: null,
    };
  }, [
    activeTool,
    cursorPosMm,
    rooms,
    freePartitions,
    settings.defaultWallThicknessMm,
  ]);

  const autoPrioritySegments = useMemo(() => {
    if (!autoLayout) return [];
    return autoLayout.footprintRings.flatMap((ring) =>
      ring.map((point, index) => ({
        p1: point,
        p2: ring[(index + 1) % ring.length],
      }))
    );
  }, [autoLayout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [activeStep]);

  useEffect(() => {
    const stopPanning = () => { isMiddleDraggingRef.current = false; };
    window.addEventListener('mouseup', stopPanning);
    window.addEventListener('blur', stopPanning);
    return () => {
      window.removeEventListener('mouseup', stopPanning);
      window.removeEventListener('blur', stopPanning);
    };
  }, []);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number): Point2D => {
      return {
        x: (screenX - stagePos.x) / zoom,
        y: (screenY - stagePos.y) / zoom,
      };
    },
    [stagePos, zoom]
  );

  // Зум колесиком
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.12;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.min(Math.max(newScale, 0.02), 1.5);

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    setZoom(clampedScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
  };

  // Клик на колесико мыши (button = 1) для панорамирования
  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || activeTool === 'pan') {
      e.evt.preventDefault();
      isMiddleDraggingRef.current = true;
      dragStartPosRef.current = {
        clientX: e.evt.clientX,
        clientY: e.evt.clientY,
        stageX: stagePos.x,
        stageY: stagePos.y,
      };
    }
  };

  // Движение мыши с расчетом магнитных привязок
  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isMiddleDraggingRef.current) {
      const dx = e.evt.clientX - dragStartPosRef.current.clientX;
      const dy = e.evt.clientY - dragStartPosRef.current.clientY;
      setStagePos({
        x: dragStartPosRef.current.stageX + dx,
        y: dragStartPosRef.current.stageY + dy,
      });
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    if (activeRouteLink) {
      const snapped = snapRouteLink(screenToWorld(pointer.x, pointer.y));
      setCursorPosMm(snapped.point);
      setRouteLinkHover((current) => {
        if (
          current &&
          current.label === snapped.label &&
          current.endpoint?.kind === snapped.endpoint?.kind &&
          current.endpoint?.deviceId === snapped.endpoint?.deviceId &&
          distance(current.point, snapped.point) < 0.01
        ) {
          return current;
        }
        return snapped;
      });
      return;
    }

    let worldPos = screenToWorld(pointer.x, pointer.y);
    const rawWorldPos = worldPos;

    const isDrawing =
      activeTool === 'draw_apartment' ||
      activeTool === 'draw_room' ||
      activeTool === 'draw_opening' ||
      activeTool === 'draw_partition';

    // В режиме черчения привязки работают ВСЕГДА, даже до первой точки!
    if (isDrawing) {
      const snap = findBestSnapAdvanced(rawWorldPos, {
        apartment,
        rooms,
        openings,
        freePartitions,
        draftVertices,
        zoom,
        defaultWallThicknessMm: settings.defaultWallThicknessMm,
        precomputedWallMesh: autoLayout?.wallMesh,
        prioritySegments: autoPrioritySegments,
      });

      setActiveSnap(snap);

      // Курсор ПРЫГАЕТ на вычисленную точку привязки (Узел, Polar, Alignment, Edge или Сетка 100)
      if (dynamicInput.lockedLength === null) {
        worldPos = snap.point;
      }
    } else if (activeTool === 'place_frame') {
      // Рамка садится на стену: берём уже привязанную к стене точку, а не курсор.
      const placement = findFramePlacement(
        worldPos,
        activeFramePosts,
        rooms,
        freePartitions,
        settings.defaultWallThicknessMm
      );
      if (placement.ok) worldPos = placement.position;
    } else if (gridSnap) {
      worldPos = snapToGrid(worldPos, gridStepMm);
    }

    setCursorPosMm(worldPos);
  };
  const handleMouseUp = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || isMiddleDraggingRef.current) {
      isMiddleDraggingRef.current = false;
    }
  };

  // Клик для фиксации точки / выбора / постановки прибора
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0 || activeTool === 'pan') return;

    const stage = stageRef.current;
    if (!stage) return;

    if (activeRouteLink) {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      handleRouteLinkClick(
        routeLinkHover ?? snapRouteLink(screenToWorld(pointer.x, pointer.y))
      );
      return;
    }

    if (activeTool === 'select') {
      if (routeEditLine) return;
      if (e.target === stage && !assignLine) {
        setSelection(null);
        setHighlightedLine(null);
      }
      return;
    }

    if (activeTool === 'place_panel') {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      let clickPoint = screenToWorld(pointer.x, pointer.y);
      if (gridSnap) clickPoint = snapToGrid(clickPoint, gridStepMm);

      const placement = findDevicePlacement(
        'socket_single',
        clickPoint,
        rooms,
        freePartitions,
        settings.defaultWallThicknessMm,
        false
      );
      if (!placement.ok) {
        addToast(placement.error, 'error');
        return;
      }
      placePanel(placement.anchor as DeviceRoomEdgeAnchor | DevicePartitionAnchor);
      return;
    }

    if (activeTool === 'place_device') {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      let clickPoint = screenToWorld(pointer.x, pointer.y);
      if (gridSnap) clickPoint = snapToGrid(clickPoint, gridStepMm);

      const placement = findDevicePlacement(
        activeDeviceType,
        clickPoint,
        rooms,
        freePartitions,
        settings.defaultWallThicknessMm,
        deviceShared
      );
      if (!placement.ok) {
        addToast(placement.error, 'error');
        return;
      }
      addDevice(activeDeviceType, placement.anchor, deviceShared);
      return;
    }

    if (activeTool === 'place_frame') {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      let clickPoint = screenToWorld(pointer.x, pointer.y);
      if (gridSnap) clickPoint = snapToGrid(clickPoint, gridStepMm);

      const placement = findFramePlacement(
        clickPoint,
        activeFramePosts,
        rooms,
        freePartitions,
        settings.defaultWallThicknessMm
      );
      if (!placement.ok) {
        addToast(placement.error, 'error');
        return;
      }
      // Инструмент остаётся активным: блоки ставятся подряд в одной
      // конфигурации (монтаж, состав мест, высота).
      addFrame(placement.anchor);
      return;
    }

    const isDrawing =
      activeTool === 'draw_apartment' ||
      activeTool === 'draw_room' ||
      activeTool === 'draw_opening' ||
      activeTool === 'draw_partition';
    if (!isDrawing) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    let clickPoint = screenToWorld(pointer.x, pointer.y);

    // Если есть активный магнит — фиксируем точно его координаты
    if (activeSnap.isSnapped && dynamicInput.lockedLength === null) {
      clickPoint = activeSnap.point;
    } else if (gridSnap && dynamicInput.lockedLength === null) {
      clickPoint = snapToGrid(clickPoint, gridStepMm);
    }

    const isLinearTool = activeTool === 'draw_opening' || activeTool === 'draw_partition';

    // Проем и перегородка — это отрезок: второй клик сразу завершает элемент
    if (isLinearTool) {
      if (draftVertices.length === 0) {
        addDraftVertex(clickPoint);
        return;
      }
      addDraftVertex(clickPoint);
      finishDraft();
      return;
    }

    // Первая вершина контура
    if (draftVertices.length === 0) {
      addDraftVertex(clickPoint);
      return;
    }

    const firstVertex = draftVertices[0];
    const lastVertex = draftVertices[draftVertices.length - 1];

    // Проверка клика в первую вершину (замыкание)
    const distToFirst = distance(clickPoint, firstVertex);
    if (draftVertices.length >= 2 && distToFirst < 30 / zoom && dynamicInput.lockedLength === null) {
      finishDraft();
      return;
    }

    // ПРИОРИТЕТ 1: Если есть ЛЮБОЙ активный магнит — он 100% приоритетнее шага 100!
    if (activeSnap.isSnapped && dynamicInput.lockedLength === null) {
      addDraftVertex(activeSnap.point);
      return;
    }

    // Если длина зафиксирована через Tab/Enter
    if (dynamicInput.lockedLength !== null) {
      const angle =
        dynamicInput.lockedAngle !== null
          ? dynamicInput.lockedAngle
          : snapAngle(angleDeg(lastVertex, clickPoint), 6);
      const fixedVertex = polarToPoint(lastVertex, dynamicInput.lockedLength, angle);
      addDraftVertex(fixedVertex);
      return;
    }

    // Только при свободном черчении без привязки применяется шаг 100 мм
    const angle = snapAngle(angleDeg(lastVertex, clickPoint), 6);
    const dist = distance(lastVertex, clickPoint);
    const steppedDist = Math.max(100, Math.round(dist / 100) * 100);
    const snappedVertex = polarToPoint(lastVertex, steppedDist, angle);
    addDraftVertex(snappedVertex);
  };

  // Горячие клавиши
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;

      if (handleRouteLinkKeyDown(e)) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ' || e.code === 'KeyY') {
          e.preventDefault();
          const history = useProjectStore.temporal.getState();
          if (e.code === 'KeyY' || e.shiftKey) history.redo();
          else history.undo();
        }
        return;
      }
      if (e.altKey) return;
      if (e.code === 'KeyV' || e.code === 'KeyH') {
        e.preventDefault();
        useProjectStore.getState().setActiveTool(e.code === 'KeyV' ? 'select' : 'pan');
        return;
      }
      const isDrawing =
        activeTool === 'draw_apartment' ||
        activeTool === 'draw_room' ||
        activeTool === 'draw_opening' ||
        activeTool === 'draw_partition';

      const isLinearTool = activeTool === 'draw_opening' || activeTool === 'draw_partition';
      const minPointsToFinish = isLinearTool ? 2 : 3;

      if (e.key === 'Tab' && isDrawing && !isLinearTool && draftVertices.length > 0) {
        e.preventDefault();
        openDynamicInput('length');
        return;
      }

      if (e.key === 'Escape') {
        if (transferPrompt) {
          setTransferPrompt(null);
          return;
        }
        if (routeEditLineId && routeSegmentModeActive) {
          setRouteSegmentMode(null);
          return;
        }
        if (routeEditLineId) {
          setRouteSegmentMode(null);
          setRouteEditLine(null);
          return;
        }
        if (lineAssignLineId) {
          cancelLineAssignment();
          return;
        }
        if (dynamicInput.isOpen || dynamicInput.lockedLength !== null) {
          closeDynamicInput();
        } else if (draftVertices.length > 0) {
          cancelDraft();
        } else if (
          activeTool === 'place_frame' ||
          activeTool === 'place_device' ||
          activeTool === 'place_panel'
        ) {
          // Из инструмента размещения — в выбор, выделение не сбрасываем.
          useProjectStore.getState().setActiveTool('select');
        } else {
          useProjectStore.getState().setActiveTool('select');
          setSelection(null);
          setHighlightedLine(null);
        }
        return;
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !isDrawing &&
        routeEditLineId &&
        routeNodeSelectionIndex !== null
      ) {
        e.preventDefault();
        if (removeLineRouteNode(routeEditLineId, routeNodeSelectionIndex)) {
          setRouteNodeSelection(null);
        }
        return;
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !isDrawing &&
        !routeEditLineId &&
        activeTool !== 'place_device' &&
        activeTool !== 'place_panel' &&
        activeTool !== 'place_frame' &&
        selection
      ) {
        e.preventDefault();
        const state = useProjectStore.getState();

        if (selection.kind === 'panel') {
          state.deletePanel();
          return;
        }
        if (selection.kind === 'opening') {
          state.deleteOpening(selection.id);
          return;
        }
        if (selection.kind === 'partition') {
          state.deletePartition(selection.id);
          return;
        }
        if (selection.kind === 'device') {
          state.deleteDevice(selection.id);
          return;
        }
        if (selection.kind === 'frame') {
          state.deleteFrame(selection.id);
          return;
        }

        const room = state.rooms.find((candidate) => candidate.id === selection.id);
        if (!room) return;
        const elements = collectRoomElements(
          room.id,
          state.rooms,
          state.walls,
          state.freePartitions,
          state.openings,
          state.devices,
          state.settings.defaultWallThicknessMm
        );
        if (window.confirm(formatRoomDeletionPrompt(room.name, elements))) {
          state.deleteRoom(room.id);
        }
        return;
      }

      if (e.key === 'Backspace' && isDrawing && draftVertices.length > 0 && !dynamicInput.isOpen) {
        e.preventDefault();
        popDraftVertex();
        return;
      }

      if (e.key === 'Enter' && assignLine && !isDrawing) {
        e.preventDefault();
        setTransferPrompt(null);
        setLineAssignLine(null);
        addToast('Состав линии сохранён.', 'success');
        return;
      }

      if (
        e.key === 'Enter' &&
        isDrawing &&
        draftVertices.length >= minPointsToFinish &&
        !dynamicInput.isOpen
      ) {
        e.preventDefault();
        finishDraft();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTool,
    draftVertices.length,
    dynamicInput.isOpen,
    dynamicInput.lockedLength,
    openDynamicInput,
    closeDynamicInput,
    cancelDraft,
    popDraftVertex,
    finishDraft,
    setSelection,
    setHighlightedLine,
    selection,
    lineAssignLineId,
    setLineAssignLine,
    cancelLineAssignment,
    assignLine,
    transferPrompt,
    addToast,
    routeEditLineId,
    setRouteEditLine,
    routeSegmentModeActive,
    routeNodeSelectionIndex,
    removeLineRouteNode,
    handleRouteLinkKeyDown,
    activeFramePosts,
  ]);

  const lastVertex = draftVertices.length > 0 ? draftVertices[draftVertices.length - 1] : null;
  const activeDeviceCatalog = DEVICE_CATALOG[activeDeviceType];
  const routeLinkConnectedCount = routeEditRoute
    ? manualRouteConnectedDeviceIds(routeEditRoute).size
    : 0;
  const routeLinkAnchoredJunctions =
    routeEditRoute?.anchors.filter((anchor) => anchor.kind === 'junction').length ?? 0;
  const routeLinkJunctionCount =
    routeLinkAnchoredJunctions + (routeEditLine?.routeJunctions?.length ?? 0);
  const routeLinkHint = !activeRouteLink
    ? ''
    : activeRouteLink.tool === 'junction'
      ? 'Клик внутри комнаты — поставить узел. В стены и перегородки ставить нельзя; Esc — выйти.'
      : activeRouteLink.from
        ? 'Первый конец выбран. Кликните второй конец: щиток, прибор или узел. Tab — сторона ступеньки, Esc — отменить связь.'
        : 'Кликните щиток, прибор или узел — начало связи. Связи можно добавлять в любом порядке; Tab — сторона ступеньки, Esc — выйти.';
  const routeLinkHoverTone: 'valid' | 'neutral' | 'invalid' = !activeRouteLink
    ? 'neutral'
    : activeRouteLink.tool === 'junction'
      ? routeLinkHover?.endpoint
        ? 'invalid'
        : routeLinkHover &&
            routeJunctionPlacementError(
              routeLinkHover.point,
              rooms,
              freePartitions
            )
          ? 'invalid'
          : 'valid'
      : routeLinkHover?.endpoint
        ? 'valid'
        : 'neutral';

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden bg-slate-950 select-none ${
        activeTool === 'select' && !routeEditLine ? 'cursor-default' : 'cursor-crosshair'
      }`}
    >
      <Rulers
        width={dimensions.width}
        height={dimensions.height}
        zoom={zoom}
        stagePos={stagePos}
        cursorPosMm={cursorPosMm}
      />

      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleStageClick}
        scaleX={zoom}
        scaleY={zoom}
        x={stagePos.x}
        y={stagePos.y}
      >
        <RoomsLayer
          listening={activeTool === 'select' && !assignLine && !routeEditLine}
          apartment={apartment}
          rooms={rooms}
          selectedRoomId={selection?.kind === 'room' ? selection.id : null}
          onSelectRoom={(id) => setSelection({ kind: 'room', id })}
          zoom={zoom}
          boundaryMode={boundaryMode}
          autoLayout={autoLayout}
          grid={
            <GridLayer
              width={dimensions.width}
              height={dimensions.height}
              zoom={zoom}
              stagePos={stagePos}
            />
          }
        />

        <WallsAndDimensionsLayer
          apartment={apartment}
          rooms={rooms}
          openings={openings}
          freePartitions={freePartitions}
          settings={settings}
          zoom={zoom}
          boundaryMode={boundaryMode}
          autoLayout={autoLayout}
        />

        <RoutingLayer
          listening={activeTool === 'select' && !assignLine && !routeEditLine}
          panel={panel}
          routes={lineRoutes}
          highlightedLineId={highlightedLineId}
          hiddenLineId={null}
          zoom={zoom}
          onSelectLine={setHighlightedLine}
        />

        <SelectionLayer
          listening={activeTool === 'select' && (!routeEditLine || Boolean(assignLine))}
          selection={selection}
          openings={openings}
          partitions={freePartitions}
          devices={resolvedDevices}
          frames={frames}
          rooms={rooms}
          thickness={settings.defaultWallThicknessMm}
          panelId={panel?.id ?? null}
          panelPose={panelPose}
          zoom={zoom}
          canDrag={canDragElements}
          onFrameDrag={(id, point, phase) =>
            handleElementDrag({ kind: 'frame', id }, point, phase)
          }
          onDeviceDrag={(id, point, phase) =>
            handleElementDrag({ kind: 'device', id }, point, phase)
          }
          onSelect={(next) => {
            if (assignLine && next.kind === 'device') {
              toggleDeviceAssignment(next.id);
              return;
            }
            setSelection(next);
          }}
        />

        <ElectricalLayer
          devices={resolvedDevices}
          zoom={zoom}
          selectedDeviceId={selection?.kind === 'device' ? selection.id : null}
          preview={devicePreview.resolved}
          panel={panel}
          panelPose={panelPose}
          deviceLineIds={deviceLineIds}
          lineColors={lineColorMap}
          highlightedLineId={highlightedLineId}
          assignLineId={lineAssignLineId}
          frames={frames}
          rooms={rooms}
          partitions={freePartitions}
          thickness={settings.defaultWallThicknessMm}
          selectedFrameId={selection?.kind === 'frame' ? selection.id : null}
          framePreview={framePreview.preview}
          frameDragPreview={elementDrag.frame}
          deviceDragPreview={elementDrag.device}
          panelPreview={
            panelPreview && !panelPreview.error
              ? { position: panelPreview.position, rotationDeg: panelPreview.rotationDeg }
              : null
          }
        />

        <DraftingLayer
          draftVertices={draftVertices}
          cursorPosMm={cursorPosMm}
          dynamicInput={dynamicInput}
          activeSnap={activeSnap}
          zoom={zoom}
          isApartmentTool={activeTool === 'draw_apartment'}
          isOpeningTool={activeTool === 'draw_opening'}
          isPartitionTool={activeTool === 'draw_partition'}
          placementDims={placementDims}
        />
        {routeEditLine && routeEditRoute && !activeRouteLink && (
          <ManualRouteLayer
            key={routeEditLine.id}
            route={routeEditRoute}
            color={lineColorMap.get(routeEditLine.id) ?? '#38bdf8'}
            zoom={zoom}
            stagePos={stagePos}
            width={dimensions.width}
            height={dimensions.height}
            gridSnap={gridSnap}
            gridStepMm={gridStepMm}
            selectedNode={routeNodeSelectionIndex}
            onSelectNode={selectRouteNode}
            onInsert={insertRouteNode}
            onPreview={previewRouteNode}
            onMove={commitRouteNode}
            onCancelPreview={cancelRoutePreview}
            eraseMode={routeSegmentModeActive}
            onRemoveSegment={removeRouteSegment}
          />
        )}
        {activeRouteLink && routeEditLine && (
          <RouteLinkLayer
            route={routeEditRoute}
            looseJunctions={routeEditLine.routeJunctions ?? []}
            from={activeRouteLink.from?.point ?? null}
            hover={routeLinkHover?.point ?? null}
            hoverTone={routeLinkHoverTone}
            axisFirst={activeRouteLink.axisFirst}
            color={lineColorMap.get(routeEditLine.id) ?? '#38bdf8'}
            zoom={zoom}
          />
        )}
      </Stage>

      {assignLine && panel && !routeEditLine && !activeRouteLink && (
        <LineCompositionCard
          line={assignLine}
          panel={panel}
          devices={devices}
          rooms={rooms}
          partitions={freePartitions}
          bounds={dimensions}
          onClose={() => {
            setTransferPrompt(null);
            setLineAssignLine(null);
            addToast('Состав линии сохранён.', 'success');
          }}
        />
      )}

      {assignLine && activeTransferPrompt && (
        <div
          className="absolute z-40 w-64 -translate-x-1/2 rounded-xl border bg-slate-900/98 shadow-2xl backdrop-blur-md p-3 space-y-2"
          style={{
            left: activeTransferPrompt.left,
            top: activeTransferPrompt.top,
            borderColor: lineColorMap.get(assignLine.id) ?? '#38bdf8',
          }}
        >
          <div className="text-[11px] text-slate-200 leading-snug">
            «{devices.find((d) => d.id === activeTransferPrompt.deviceId)?.name ?? 'Прибор'}» уже в линии «
            {panel?.lines.find((line) => line.id === activeTransferPrompt.fromLineId)?.name ?? 'другой'}».
            Перенести в «{assignLine.name}»?
          </div>
          {panel?.lines.find((line) => line.id === activeTransferPrompt.fromLineId)
            ?.manualRoute && (
            <div className="text-[9px] text-amber-300 leading-snug">
              У старой линии ручная трасса — она будет пересчитана без этого прибора.
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={confirmDeviceTransfer}
              className="flex-1 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
            >
              Перенести
            </button>
            <button
              onClick={() => setTransferPrompt(null)}
              className="flex-1 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold transition"
            >
              Оставить
            </button>
          </div>
        </div>
      )}

      {activeRouteLink && routeEditLine && (
        <div
          className="absolute top-9 left-9 right-3 z-30 flex flex-wrap items-start gap-2.5 px-3 py-2 rounded-xl border bg-slate-900/95 shadow-2xl backdrop-blur-md"
          style={{ borderColor: lineColorMap.get(routeEditLine.id) ?? '#38bdf8' }}
        >
          <span
            className="mt-1 w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: lineColorMap.get(routeEditLine.id) ?? '#38bdf8' }}
          />
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-white truncate max-w-[320px]">
              Соединение трассы: {routeEditLine.name}
            </div>
            <div className="text-[9px] text-slate-300">
              Подключено к щитку: {routeLinkConnectedCount} /{' '}
              {routeEditLine.deviceIds.length}
              {' · '}узлов: {routeLinkJunctionCount}
              {' · '}ступенька:{' '}
              {activeRouteLink.axisFirst === 'h'
                ? 'сначала горизонталь'
                : 'сначала вертикаль'}
            </div>
            <div className="text-[9px] text-slate-400 max-w-[760px]">
              {routeLinkHint}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => beginRouteLink('link')}
              className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-bold transition ${
                activeRouteLink.tool === 'link'
                  ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title="Соединить две точки: щиток, прибор или узел"
            >
              Связь
            </button>
            <button
              onClick={() => beginRouteLink('junction')}
              className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-bold transition ${
                activeRouteLink.tool === 'junction'
                  ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title="Поставить узел в любой свободной точке комнаты"
            >
              Узел
            </button>
            <button
              onClick={exitRouteLink}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-bold transition"
            >
              Готово
            </button>
          </div>
        </div>
      )}

      {routeEditLine && !activeRouteLink && (
        <RouteStopsPopover
          line={routeEditLine}
          route={routeEditRoute ?? EMPTY_ROUTE}
          color={lineColorMap.get(routeEditLine.id) ?? '#38bdf8'}
          devices={devices}
          selectedNode={routeNodeSelectionIndex}
          bounds={dimensions}
          cableLengthMm={lineRoutes.get(routeEditLine.id)?.cableLengthMm ?? 0}
          error={routePreviewError}
          onSelectNode={selectRouteNode}
          onReorder={reorderRouteStops}
          onRemoveNode={removeRouteNode}
          onReset={resetRoute}
          onBeginRouteLink={beginRouteLink}
          onClose={closeRouteEditor}
          segmentMode={routeSegmentModeActive}
          onToggleSegmentMode={toggleRouteSegmentMode}
        />
      )}

      {activeStep === 'plan' &&
        boundaryMode === 'auto' &&
        rooms.length === 0 &&
        activeTool !== 'draw_room' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="bg-slate-900/90 border border-slate-700/80 p-8 rounded-2xl shadow-2xl backdrop-blur-md max-w-md text-center pointer-events-auto">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 mx-auto flex items-center justify-center mb-4">
              <PenTool size={28} />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Начните с первой комнаты</h2>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              Очертите чистовой контур комнаты — стены построятся наружу автоматически.
              Следующие комнаты привязывайте к внешней грани существующей стены.
            </p>
            <button
              onClick={() => startRoomDrawing()}
              className="w-full py-3 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-sm shadow-lg shadow-sky-950/40 transition flex items-center justify-center gap-2 cursor-pointer"
            >
              Начертить первую комнату
            </button>
          </div>
        </div>
      )}

      {activeStep === 'plan' &&
        boundaryMode === 'manual' &&
        !apartment &&
        activeTool !== 'draw_apartment' &&
        drawingStage === 'boundary' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <div className="bg-slate-900/90 border border-slate-700/80 p-8 rounded-2xl shadow-2xl backdrop-blur-md max-w-md text-center pointer-events-auto">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center mb-4">
                <Home size={28} />
              </div>
              <h2 className="text-lg font-bold text-white mb-2">Начните с контура квартиры</h2>
              <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                Очертите внешние границы помещения. Толщина наружных стен будет построена наружу от чистового пола.
              </p>
              <button
                onClick={() => startApartmentDrawing()}
                className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-950/40 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                ⚡ Начертить контур квартиры
              </button>
            </div>
          </div>
        )}

      {activeStep === 'plan' && designMode === 'electrical' && rooms.length === 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="pointer-events-auto w-[340px] rounded-xl border border-slate-700/80 bg-slate-900/95 backdrop-blur-md px-4 py-3 text-center shadow-2xl">
            <p className="text-sm font-bold text-white mb-1">Сначала разметьте план</p>
            <p className="text-[11px] text-slate-400 leading-snug">
              Приборы и щиток ставятся на стены комнат. Нарисуйте комнату инструментом
              «Комната» слева.
            </p>
          </div>
        </div>
      )}

      {activeStep === 'plan' &&
        designMode === 'electrical' &&
        rooms.length > 0 &&
        !panel &&
        activeTool !== 'place_panel' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-sky-500/40 bg-slate-900/95 backdrop-blur-md px-4 py-2.5 shadow-2xl">
              <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                <CircuitBoard size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-sky-200">
                  Поставьте щиток — укажите стену
                </div>
                <div className="text-[10px] text-slate-400 leading-snug">
                  Щиток — начало всех линий.
                </div>
              </div>
              <button
                onClick={() => setActiveTool('place_panel')}
                className="shrink-0 py-1.5 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs transition cursor-pointer"
              >
                Выбрать стену
              </button>
            </div>
          </div>
        )}

      {activeTool === 'place_frame' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="rounded-xl border border-sky-500/40 bg-slate-900/95 backdrop-blur-md px-4 py-2 shadow-2xl text-center">
            <div className="text-xs font-bold text-sky-200">
              Кликните по стене, чтобы поставить подрозетник
            </div>
            <div className="text-[10px] text-slate-400 leading-snug">
              {framePreview.error ??
                `Блок на ${activeFramePosts} ${activeFramePosts === 1 ? 'место' : 'места'} (${frameBlockSummary}) встанет на ближайшую стену. Esc — выйти.`}
            </div>
          </div>
        </div>
      )}

      {draftVertices.length > 0 && (
        <CadFloatingInput
          width={dimensions.width}
          height={dimensions.height}
          lastVertex={lastVertex}
          cursorPosMm={cursorPosMm}
          stagePos={stagePos}
          zoom={zoom}
          dynamicInput={dynamicInput}
          onCommitVertex={(vertex) => addDraftVertex(vertex)}
          onUpdateInput={setDynamicInputValues}
          onUnlock={() => {
            setLockedLength(null);
            closeDynamicInput();
          }}
        />
      )}

      {/* Статусная панель */}
      <div className="absolute bottom-3 left-9 z-30 flex items-center gap-4 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400 backdrop-blur-sm pointer-events-none">
        <span>
          X: <strong className="text-sky-400">{Math.round(cursorPosMm.x).toLocaleString('ru-RU')}</strong> мм
        </span>
        <span>
          Y: <strong className="text-emerald-400">{Math.round(cursorPosMm.y).toLocaleString('ru-RU')}</strong> мм
        </span>
        <span className="text-slate-600">|</span>
        <span>
          Шаг черчения: <strong className="text-amber-400">100 мм</strong>
        </span>
        <span className="text-slate-600">|</span>
        {designMode === 'electrical' ? (
          <>
            <span>
              {activeTool === 'place_panel' ? (
                <>
                  Модуль: <strong className="text-sky-400">Электрощиток</strong>
                </>
              ) : activeTool === 'place_frame' ? (
                <>
                  Подрозетник:{' '}
                  <strong className="text-sky-400">
                    {activeFramePosts} {activeFramePosts === 1 ? 'место' : 'места'}
                  </strong>
                  <span className="text-slate-400"> · {frameBlockSummary}</span>
                </>
              ) : (
                <>
                  Прибор:{' '}
                  <strong className="text-sky-400">{activeDeviceCatalog.label}</strong>
                  {deviceShared && activeDeviceCatalog.mounting === 'wall' && (
                    <span className="text-amber-400"> · сквозной</span>
                  )}
                </>
              )}
            </span>
            {activeTool === 'place_panel' && (
              <>
                <span className="text-slate-600">|</span>
                <span className={panelPreview?.error ? 'text-rose-400' : 'text-emerald-400'}>
                  {panelPreview?.error ?? 'ЛКМ — поставить на стену, Esc — выйти'}
                </span>
              </>
            )}
            {activeTool === 'place_device' && (
              <>
                <span className="text-slate-600">|</span>
                <span className={devicePreview.error ? 'text-rose-400' : 'text-emerald-400'}>
                  {devicePreview.error ?? 'ЛКМ — поставить, Esc — выйти'}
                </span>
              </>
            )}
            {activeTool === 'place_frame' && (
              <>
                <span className="text-slate-600">|</span>
                <span className={framePreview.error ? 'text-rose-400' : 'text-emerald-400'}>
                  {framePreview.error ?? 'Кликните по стене, чтобы поставить подрозетник · Esc — выйти'}
                </span>
              </>
            )}
          </>
        ) : (
          <span className="text-slate-400">
            Магнит:{' '}
            {activeSnap.isSnapped ? (
              <span className="text-emerald-400 font-bold">{activeSnap.label}</span>
            ) : (
              'Сетка'
            )}
          </span>
        )}
      </div>
    </div>
  );
};

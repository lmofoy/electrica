import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Stage } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { GridLayer } from './GridLayer';
import { RoomsLayer } from './RoomsLayer';
import { WallsAndDimensionsLayer } from './WallsAndDimensionsLayer';
import { SelectionLayer } from './SelectionLayer';
import { RoutingLayer } from './RoutingLayer';
import { ElectricalLayer } from './ElectricalLayer';
import { DraftingLayer } from './DraftingLayer';
import { ManualRouteLayer } from './ManualRouteLayer';
import { ManualDrawLayer, type ManualDrawHover } from './ManualDrawLayer';
import { RouteStopsPopover } from './RouteStopsPopover';
import { CadFloatingInput } from './CadFloatingInput';
import { Rulers } from './Rulers';
import { snapToGrid, distance, polarToPoint, angleDeg, snapAngle } from '../../core/geometry/math';
import { findBestSnapAdvanced } from '../../core/geometry/snapping';
import { buildAutoLayout } from '../../core/geometry/autoLayout';
import {
  DEVICE_CATALOG,
  findDevicePlacement,
  resolveDevice,
  type ResolvedDevice,
} from '../../core/electrical/devices';
import { resolvePanelPose } from '../../core/electrical/panel';
import { buildDeviceLineMap } from '../../core/electrical/lineAssignment';
import { buildLineColorMap } from '../../core/electrical/lineColors';
import { computeLineRoutes, materializeRouteForLine } from '../../core/electrical/routing';
import { moveManualRouteNode } from '../../core/electrical/manualRoute';
import {
  addManualDrawJunction,
  appendManualDrawDevice,
  appendManualDrawPoint,
  cancelManualDrawChain,
  createManualDrawSession,
  fixManualDrawChain,
  manualDrawConnectedDevices,
  manualDrawJunctionSnap,
  manualDrawRoute,
  popManualDrawPoint,
  removeLastManualDrawChain,
  startManualDrawChain,
  type ManualDrawAxis,
  type ManualDrawSession,
} from '../../core/electrical/manualDraw';
import { collectRoomElements, formatRoomDeletionPrompt } from '../../core/model/roomElements';
import type {
  DevicePartitionAnchor,
  DeviceRoomEdgeAnchor,
  ElectricalDevice,
  ManualRoute,
  Point2D,
} from '../../types';
import { Home, PenTool } from 'lucide-react';

Konva.dragButtons = [0];

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
    setHighlightedLine,
    setLineAssignLine,
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
    placePanel,
    addToast,
    drawingStage,
    boundaryMode,
    activeView,
    routeEditLineId,
    setRouteEditLine,
    moveLineRouteNode,
    insertLineRouteNode,
    removeLineRouteNode,
    reorderLineRouteStops,
    resetLineRoute,
    setLineManualRoute,
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
  // Список порядка открыт по умолчанию. Состояние привязано к своей линии:
  // при смене линии список снова открыт, без сброса через эффект.
  const [stopsPanel, setStopsPanel] = useState<{
    lineId: string | null;
    open: boolean;
  }>({ lineId: null, open: true });
  // Черновик ручной трассировки живёт только в компоненте: в проект и историю
  // он попадает одним действием на «Готово».
  const [manualDraw, setManualDraw] = useState<{
    lineId: string;
    session: ManualDrawSession;
    axisFirst: ManualDrawAxis;
    tool: 'line' | 'junction';
    hover: ManualDrawHover | null;
  } | null>(null);
  const [manualDrawConfirm, setManualDrawConfirm] = useState(false);
  const routeEditing = activeTool === 'select' && designMode === 'electrical';
  const stopsPanelOpen =
    stopsPanel.lineId === routeEditLineId ? stopsPanel.open : true;

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

  const routeEditLine = useMemo(
    () => routeEditing ? panel?.lines.find((line) => line.id === routeEditLineId) ?? null : null,
    [panel, routeEditLineId, routeEditing]
  );

  const activeManualDraw =
    manualDraw && routeEditLine && manualDraw.lineId === routeEditLine.id
      ? manualDraw
      : null;

  const routeEditRoute = useMemo(() => {
    if (!routeEditLine || !panel || activeManualDraw) return null;
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
    activeManualDraw,
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

  const addDevicesFromRoute = useCallback(() => {
    if (!routeEditLine) return;
    routeDragBaseRef.current = null;
    setRoutePreview(null);
    setRouteNodeSelection(null);
    setRouteEditLine(null);
    setLineAssignLine(routeEditLine.id);
  }, [routeEditLine, setRouteEditLine, setLineAssignLine]);

  const toggleDeviceAssignment = useCallback(
    (deviceId: string) => {
      if (!assignLine) return;
      if (assignLine.deviceIds.includes(deviceId)) {
        unassignDevicesFromLines([deviceId]);
      } else {
        assignDevicesToLine(assignLine.id, [deviceId]);
      }
    },
    [assignLine, assignDevicesToLine, unassignDevicesFromLines]
  );

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

  const manualDrawDeviceNames = useMemo(() => {
    const names: Record<string, string> = {};
    if (!routeEditLine) return names;
    for (const deviceId of routeEditLine.deviceIds) {
      const device = devices.find((candidate) => candidate.id === deviceId);
      if (device) names[deviceId] = device.name;
    }
    return names;
  }, [routeEditLine, devices]);

  const updateManualDrawSession = useCallback((session: ManualDrawSession) => {
    setManualDraw((prev) => (prev ? { ...prev, session } : prev));
  }, []);

  const beginManualDraw = useCallback(() => {
    setManualDrawConfirm(false);
    if (!routeEditLine) return;
    if (!panelPose) {
      addToast('Щиток не размещён на плане: ручную трассу начать нельзя.', 'error');
      return;
    }
    if (routeEditLine.deviceIds.length === 0) {
      addToast('В линии нет приборов — соединять нечего.', 'error');
      return;
    }
    const devicePoints: { deviceId: string; point: Point2D }[] = [];
    for (const deviceId of routeEditLine.deviceIds) {
      const resolved = resolvedDevices.find(
        (entry) => entry.device.id === deviceId
      );
      const pose = resolved?.poses[0];
      if (!pose) {
        addToast('Часть приборов линии не найдена на плане.', 'error');
        return;
      }
      devicePoints.push({ deviceId, point: pose.position });
    }
    setLineManualRoute(routeEditLine.id, undefined);
    setManualDraw({
      lineId: routeEditLine.id,
      session: createManualDrawSession(panelPose.position, devicePoints),
      axisFirst: 'h',
      tool: 'line',
      hover: null,
    });
  }, [routeEditLine, panelPose, resolvedDevices, setLineManualRoute, addToast]);

  const exitManualDraw = useCallback(() => {
    if (!activeManualDraw) return;
    const hasWork =
      activeManualDraw.session.chains.length > 0 ||
      activeManualDraw.session.active !== null;
    if (
      hasWork &&
      !window.confirm('Выйти из ручной трассировки? Черновик будет потерян.')
    ) {
      return;
    }
    setManualDraw(null);
  }, [activeManualDraw]);

  const snapManualDraw = useCallback(
    (raw: Point2D): ManualDrawHover => {
      if (!activeManualDraw) return { point: raw, kind: 'grid' };
      const session = activeManualDraw.session;
      const tolerance = 16 / zoom;
      if (activeManualDraw.tool === 'junction') {
        const snap = manualDrawJunctionSnap(session, raw, tolerance);
        if (snap) return { point: snap.point, kind: 'segment' };
      }
      if (distance(raw, session.panelPoint) <= tolerance) {
        return { point: session.panelPoint, kind: 'panel' };
      }
      let bestDevice: {
        deviceId: string;
        point: Point2D;
        distance: number;
      } | null = null;
      for (const device of session.devices) {
        const span = distance(raw, device.point);
        if (span <= tolerance && (!bestDevice || span < bestDevice.distance)) {
          bestDevice = { deviceId: device.deviceId, point: device.point, distance: span };
        }
      }
      if (bestDevice) {
        return {
          point: bestDevice.point,
          kind: 'device',
          deviceId: bestDevice.deviceId,
          connected: manualDrawConnectedDevices(session).has(bestDevice.deviceId),
        };
      }
      for (const junction of session.junctions) {
        if (distance(raw, junction) <= tolerance) {
          return { point: junction, kind: 'junction' };
        }
      }
      return {
        point: gridSnap ? snapToGrid(raw, gridStepMm) : raw,
        kind: 'grid',
      };
    },
    [activeManualDraw, zoom, gridSnap, gridStepMm]
  );

  const toggleManualDrawTool = useCallback(() => {
    setManualDraw((prev) =>
      prev
        ? {
            ...prev,
            tool: prev.tool === 'line' ? 'junction' : 'line',
            hover: null,
          }
        : prev
    );
  }, []);

  const handleManualDrawClick = useCallback(
    (snap: ManualDrawHover) => {
      if (!activeManualDraw) return;
      const { session, tool, axisFirst } = activeManualDraw;

      if (tool === 'junction') {
        const result = addManualDrawJunction(session, snap.point, 16 / zoom);
        if (!result.ok) {
          addToast(result.error, 'error');
          return;
        }
        updateManualDrawSession(result.session);
        addToast('Узел поставлен: от него можно вести ветвь.', 'success');
        return;
      }

      if (!session.active) {
        if (
          snap.kind !== 'panel' &&
          snap.kind !== 'device' &&
          snap.kind !== 'junction'
        ) {
          addToast('Начните цепь от щитка, подключённого прибора или узла.', 'info');
          return;
        }
        const result = startManualDrawChain(session, {
          kind: snap.kind,
          point: snap.point,
          deviceId: snap.deviceId,
        });
        if (!result.ok) {
          addToast(result.error, 'error');
          return;
        }
        updateManualDrawSession(result.session);
        return;
      }

      if (
        snap.kind === 'panel' ||
        snap.kind === 'junction' ||
        (snap.kind === 'device' && snap.connected)
      ) {
        addToast(
          'Вершина уже используется: цепь заканчивается на приборе, а ветвь начинайте от узла.',
          'error'
        );
        return;
      }

      if (snap.kind === 'device' && snap.deviceId) {
        const result = appendManualDrawDevice(session, snap.deviceId, axisFirst);
        if (!result.ok) {
          addToast(result.error, 'error');
          return;
        }
        updateManualDrawSession(result.session);
        return;
      }

      const result = appendManualDrawPoint(session, snap.point, axisFirst);
      if (!result.ok) {
        addToast(result.error, 'error');
        return;
      }
      updateManualDrawSession(result.session);
    },
    [activeManualDraw, zoom, addToast, updateManualDrawSession]
  );

  const fixManualDrawActiveChain = useCallback(() => {
    if (!activeManualDraw) return;
    const result = fixManualDrawChain(activeManualDraw.session);
    if (!result.ok) {
      addToast(result.error, 'error');
      return;
    }
    updateManualDrawSession(result.session);
    addToast('Цепь зафиксирована. Начните следующую от прибора, узла или щитка.', 'success');
  }, [activeManualDraw, updateManualDrawSession, addToast]);

  const removeManualDrawLastChain = useCallback(() => {
    if (!activeManualDraw) return;
    if (activeManualDraw.session.active) {
      addToast('Сначала зафиксируйте или отмените текущую цепь.', 'info');
      return;
    }
    const result = removeLastManualDrawChain(activeManualDraw.session);
    if (!result.ok) {
      addToast(result.error, 'error');
      return;
    }
    updateManualDrawSession(result.session);
  }, [activeManualDraw, updateManualDrawSession, addToast]);

  const saveManualDrawRoute = useCallback(() => {
    if (!activeManualDraw) return;
    const result = manualDrawRoute(activeManualDraw.session, {
      deviceNames: manualDrawDeviceNames,
    });
    if (!result.ok) {
      addToast(result.error, 'error');
      return;
    }
    setLineManualRoute(activeManualDraw.lineId, result.route);
    setManualDraw(null);
    addToast(
      result.warnings.length > 0
        ? `Ручная трасса сохранена. ${result.warnings.join(' ')}`
        : 'Ручная трасса сохранена.',
      result.warnings.length > 0 ? 'info' : 'success'
    );
  }, [activeManualDraw, manualDrawDeviceNames, setLineManualRoute, addToast]);

  const handleManualDrawKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!activeManualDraw) return false;

      if (e.ctrlKey || e.metaKey) {
        if (e.code !== 'KeyZ') return false;
        e.preventDefault();
        if (activeManualDraw.session.active) {
          const result = popManualDrawPoint(activeManualDraw.session);
          if (result.ok) updateManualDrawSession(result.session);
        } else {
          const result = removeLastManualDrawChain(activeManualDraw.session);
          if (result.ok) updateManualDrawSession(result.session);
          else addToast('Убирать нечего: цепей ещё нет.', 'info');
        }
        return true;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeManualDraw.tool === 'junction') {
          setManualDraw((prev) =>
            prev ? { ...prev, tool: 'line', hover: null } : prev
          );
          return true;
        }
        if (activeManualDraw.session.active) {
          const result = cancelManualDrawChain(activeManualDraw.session);
          if (result.ok) updateManualDrawSession(result.session);
          return true;
        }
        exitManualDraw();
        return true;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        fixManualDrawActiveChain();
        return true;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        setManualDraw((prev) =>
          prev
            ? { ...prev, axisFirst: prev.axisFirst === 'h' ? 'v' : 'h' }
            : prev
        );
        return true;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (!activeManualDraw.session.active) {
          addToast('Нет активной цепи: начните её от щитка, прибора или узла.', 'info');
          return true;
        }
        const result = popManualDrawPoint(activeManualDraw.session);
        if (!result.ok) {
          addToast(result.error, 'error');
          return true;
        }
        updateManualDrawSession(result.session);
        return true;
      }

      return false;
    },
    [
      activeManualDraw,
      updateManualDrawSession,
      exitManualDraw,
      fixManualDrawActiveChain,
      addToast,
    ]
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
  }, [activeView]);

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

    if (activeManualDraw) {
      const snapped = snapManualDraw(screenToWorld(pointer.x, pointer.y));
      setCursorPosMm(snapped.point);
      setManualDraw((prev) => {
        if (!prev) return prev;
        const current = prev.hover;
        if (
          current &&
          current.kind === snapped.kind &&
          current.deviceId === snapped.deviceId &&
          current.connected === snapped.connected &&
          distance(current.point, snapped.point) < 0.01
        ) {
          return prev;
        }
        return { ...prev, hover: snapped };
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

    if (activeManualDraw) {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      handleManualDrawClick(snapManualDraw(screenToWorld(pointer.x, pointer.y)));
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

  const handleStageDoubleClick = () => {
    if (activeManualDraw) fixManualDrawActiveChain();
  };

  // Горячие клавиши
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;

      if (handleManualDrawKeyDown(e)) return;

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
        if (routeEditLineId) {
          setRouteEditLine(null);
          return;
        }
        if (lineAssignLineId) {
          setLineAssignLine(null);
          return;
        }
        if (dynamicInput.isOpen || dynamicInput.lockedLength !== null) {
          closeDynamicInput();
        } else if (draftVertices.length > 0) {
          cancelDraft();
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
    routeEditLineId,
    setRouteEditLine,
    routeNodeSelectionIndex,
    removeLineRouteNode,
    handleManualDrawKeyDown,
  ]);

  const lastVertex = draftVertices.length > 0 ? draftVertices[draftVertices.length - 1] : null;
  const activeDeviceCatalog = DEVICE_CATALOG[activeDeviceType];
  const manualDrawConnectedCount = activeManualDraw
    ? manualDrawConnectedDevices(activeManualDraw.session).size
    : 0;
  const manualDrawHint = !activeManualDraw
    ? ''
    : activeManualDraw.tool === 'junction'
      ? 'Клик по проложенной линии — поставить узел. Его можно ставить сколько угодно; Esc — вернуться к рисованию.'
      : activeManualDraw.session.active
        ? 'Клик — следующая точка или прибор. Enter или двойной клик — зафиксировать цепь. Tab — ось ступеньки. Backspace — убрать точку. Esc — отменить цепь.'
        : 'Клик — старт цепи: щиток, подключённый прибор или узел. За каждый клик добавляется точка со ступенькой под 90°. Esc — выйти.';

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
        onDblClick={handleStageDoubleClick}
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
          hiddenLineId={activeManualDraw?.lineId ?? null}
          zoom={zoom}
          onSelectLine={setHighlightedLine}
        />

        <SelectionLayer
          listening={activeTool === 'select' && !routeEditLine}
          selection={selection}
          openings={openings}
          partitions={freePartitions}
          devices={resolvedDevices}
          panelId={panel?.id ?? null}
          panelPose={panelPose}
          zoom={zoom}
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
        />
        {routeEditLine && routeEditRoute && (
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
          />
        )}
        {activeManualDraw && routeEditLine && (
          <ManualDrawLayer
            session={activeManualDraw.session}
            color={lineColorMap.get(routeEditLine.id) ?? '#38bdf8'}
            zoom={zoom}
            hover={activeManualDraw.hover}
            axisFirst={activeManualDraw.axisFirst}
            tool={activeManualDraw.tool}
          />
        )}
      </Stage>

      {assignLine && (
        <div className="absolute top-9 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3 py-2 rounded-xl border bg-slate-900/95 shadow-2xl backdrop-blur-md"
          style={{ borderColor: lineColorMap.get(assignLine.id) ?? '#38bdf8' }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: lineColorMap.get(assignLine.id) ?? '#38bdf8' }}
          />
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-white truncate max-w-[220px]">
              Назначение: {assignLine.name}
            </div>
            <div className="text-[9px] text-slate-400">
              приборов в линии: {assignLine.deviceIds.length} · клик — добавить/убрать · Esc — выйти
            </div>
          </div>
          <button
            onClick={() => setLineAssignLine(null)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
          >
            Готово
          </button>
        </div>
      )}

      {routeEditLine && !activeManualDraw && (
        <div className="absolute top-9 left-9 right-3 z-30 flex flex-wrap items-center gap-2.5 px-3 py-2 rounded-xl border bg-slate-900/95 shadow-2xl backdrop-blur-md"
          style={{ borderColor: lineColorMap.get(routeEditLine.id) ?? '#38bdf8' }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: lineColorMap.get(routeEditLine.id) ?? '#38bdf8' }}
          />
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-white truncate max-w-[260px]">
              Ручная трасса: {routeEditLine.name} · {routeEditLine.manualRoute ? 'ручная' : 'авто'}
            </div>
            <div className="text-[9px] text-slate-400">
              Точек: {routeEditRoute ? routeEditRoute.nodes.length - (routeEditRoute.bendNodes?.length ?? 0) : 0} · Кабель: {((lineRoutes.get(routeEditLine.id)?.cableLengthMm ?? 0) / 1000).toFixed(1)} м
              {' · '}потолок {settings.ceilingHeightMm} мм · пол {settings.floorLevelMm} мм
            </div>
            <div className="text-[9px] text-slate-400">
              Перетаскивание — свободное в 2D, линия возвращается к соседям ступеньками под 90° без новых точек · наклонная — скольжение вдоль линии · клик по линии — вставить точку · Delete — удалить точку: участок до соседних точек перестроится под 90° · Esc — выйти
            </div>
            <div className="text-[9px] text-slate-500">
              «Список» — порядок точек и приборов по ветвям: перетащите строку, и кабель пойдёт строго в этом порядке. Щиток и приборы закреплены, стык подвижен. Цветные маркеры — подвижные точки, серые — точки подключения. Изгибы под 90° точками не считаются.
            </div>
            {routePreviewError && (
              <div className="text-[9px] text-rose-400 font-semibold max-w-[520px]">
                {routePreviewError}
              </div>
            )}
          </div>
          <button
            onClick={() =>
              setStopsPanel({ lineId: routeEditLineId, open: !stopsPanelOpen })
            }
            className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-bold transition ${
              stopsPanelOpen
                ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
            title="Список порядка: точки и приборы по ветвям, перетаскивание меняет порядок подключения"
          >
            Список
          </button>
          <button
            onClick={() => setManualDrawConfirm(true)}
            className="shrink-0 px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-bold transition"
            title="Удалить текущую трассу и нарисовать её заново вручную"
          >
            Проложить вручную
          </button>
          <button
            onClick={resetRoute}
            disabled={!routeEditLine.manualRoute && !routeEditLine.waypoints?.length}
            className="shrink-0 px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold transition"
          >
            Сбросить к авто
          </button>
          <button
            onClick={() => setRouteEditLine(null)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
          >
            Готово
          </button>
        </div>
      )}

      {activeManualDraw && routeEditLine && (
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
              Ручная трассировка: {routeEditLine.name}
            </div>
            <div className="text-[9px] text-slate-300">
              Приборы: {manualDrawConnectedCount} / {activeManualDraw.session.devices.length}
              {' · '}цепей: {activeManualDraw.session.chains.length}
              {activeManualDraw.session.active ? ' · текущая цепь не зафиксирована' : ''}
              {' · '}ступенька: {activeManualDraw.axisFirst === 'h' ? 'сначала горизонталь' : 'сначала вертикаль'}
            </div>
            <div className="text-[9px] text-slate-400 max-w-[760px]">
              {manualDrawHint}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              onClick={toggleManualDrawTool}
              className={`shrink-0 px-2 py-1 rounded-lg border text-[10px] font-bold transition ${
                activeManualDraw.tool === 'junction'
                  ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title="Поставить узел на уже проложенной линии"
            >
              Узел
            </button>
            <button
              onClick={fixManualDrawActiveChain}
              disabled={!activeManualDraw.session.active}
              className="shrink-0 px-2 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold transition"
            >
              Зафиксировать цепь
            </button>
            <button
              onClick={removeManualDrawLastChain}
              disabled={
                activeManualDraw.session.active !== null ||
                activeManualDraw.session.chains.length === 0
              }
              className="shrink-0 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-[10px] font-bold transition"
            >
              Убрать цепь
            </button>
            <button
              onClick={saveManualDrawRoute}
              disabled={activeManualDraw.session.chains.length === 0}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-[10px] font-bold transition"
            >
              Готово
            </button>
            <button
              onClick={exitManualDraw}
              className="shrink-0 px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold transition"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {manualDrawConfirm && routeEditLine && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm px-6"
          onClick={() => setManualDrawConfirm(false)}
        >
          <div
            className="w-full max-w-[440px] rounded-2xl border border-amber-500/40 bg-slate-900 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-sm font-bold text-white mb-2">
              Проложить трассу вручную?
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Текущая трасса линии «{routeEditLine.name}» будет удалена вместе с её
              точками и узлами. Приборы останутся в линии. После сохранения линия
              будет прокладываться только вручную; вернуть автотрассу можно кнопкой
              «Сбросить к авто».
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setManualDrawConfirm(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold transition"
              >
                Отмена
              </button>
              <button
                onClick={beginManualDraw}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold transition"
              >
                Удалить и начать
              </button>
            </div>
          </div>
        </div>
      )}

      {routeEditLine && routeEditRoute && stopsPanelOpen && (
        <RouteStopsPopover
          line={routeEditLine}
          route={routeEditRoute}
          color={lineColorMap.get(routeEditLine.id) ?? '#38bdf8'}
          devices={devices}
          selectedNode={routeNodeSelectionIndex}
          bounds={dimensions}
          onSelectNode={selectRouteNode}
          onReorder={reorderRouteStops}
          onRemoveNode={removeRouteNode}
          onReset={resetRoute}
          onAddDevices={addDevicesFromRoute}
          onClose={() => setStopsPanel({ lineId: routeEditLineId, open: false })}
        />
      )}

      {boundaryMode === 'auto' && rooms.length === 0 && activeTool !== 'draw_room' && (
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
              Начертить комнату
            </button>
          </div>
        </div>
      )}

      {boundaryMode === 'manual' &&
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

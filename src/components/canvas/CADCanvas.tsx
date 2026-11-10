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
import { WaypointLayer } from './WaypointLayer';
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
import { computeLineRoutes } from '../../core/electrical/routing';
import { collectRoomElements, formatRoomDeletionPrompt } from '../../core/model/roomElements';
import type {
  DevicePartitionAnchor,
  DeviceRoomEdgeAnchor,
  ElectricalDevice,
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
    shafts,
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
    activeBoundaryTool,
    activeView,
    routeEditLineId,
    setRouteEditLine,
    addLineWaypoint,
    moveLineWaypoint,
    removeLineWaypoint,
    clearLineWaypoints,
  } = useProjectStore();

  const autoLayout = useMemo(() => {
    if (boundaryMode !== 'auto') return null;
    return buildAutoLayout(
      rooms,
      shafts,
      freePartitions,
      openings,
      settings.defaultWallThicknessMm
    );
  }, [
    boundaryMode,
    rooms,
    shafts,
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

  const [waypointPreview, setWaypointPreview] = useState<{
    lineId: string;
    index: number;
    point: Point2D;
    sourcePanel: typeof panel;
  } | null>(null);
  const routeEditing = activeTool === 'select' && designMode === 'electrical';
  if (waypointPreview && (waypointPreview.sourcePanel !== panel || waypointPreview.lineId !== routeEditLineId || !routeEditing)) {
    setWaypointPreview(null);
  }
  const previewPanel = useMemo(() => {
    if (!panel || !waypointPreview || !routeEditing || waypointPreview.lineId !== routeEditLineId) return panel;
    return {
      ...panel,
      lines: panel.lines.map((line) => line.id === waypointPreview.lineId
        ? {
            ...line,
            waypoints: line.waypoints?.map((point, index) =>
              index === waypointPreview.index ? waypointPreview.point : point
            ),
          }
        : line),
    };
  }, [panel, waypointPreview, routeEditing, routeEditLineId]);

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

    let worldPos = screenToWorld(pointer.x, pointer.y);
    const rawWorldPos = worldPos;

    const isDrawing =
      activeTool === 'draw_apartment' ||
      activeTool === 'draw_room' ||
      activeTool === 'draw_shaft' ||
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
      activeTool === 'draw_shaft' ||
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
        activeTool === 'draw_shaft' ||
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
  ]);

  const lastVertex = draftVertices.length > 0 ? draftVertices[draftVertices.length - 1] : null;
  const activeDeviceCatalog = DEVICE_CATALOG[activeDeviceType];

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
          shafts={shafts}
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
          isApartmentTool={activeTool === 'draw_apartment' && activeBoundaryTool === 'add'}
          isShaftTool={activeTool === 'draw_shaft' || (activeTool === 'draw_apartment' && activeBoundaryTool === 'subtract')}
          isOpeningTool={activeTool === 'draw_opening'}
          isPartitionTool={activeTool === 'draw_partition'}
        />
        {routeEditLine && (
          <WaypointLayer
            key={routeEditLine.id}
            line={routeEditLine}
            color={lineColorMap.get(routeEditLine.id) ?? '#38bdf8'}
            zoom={zoom}
            stagePos={stagePos}
            width={dimensions.width}
            height={dimensions.height}
            cursorPosMm={cursorPosMm}
            gridSnap={gridSnap}
            gridStepMm={gridStepMm}
            onAdd={(point) => addLineWaypoint(routeEditLine.id, point)}
            onPreview={(index, point) => setWaypointPreview({ lineId: routeEditLine.id, index, point, sourcePanel: panel })}
            onMove={(index, point) => {
              setWaypointPreview(null);
              moveLineWaypoint(routeEditLine.id, index, point);
            }}
            onRemove={(index) => removeLineWaypoint(routeEditLine.id, index)}
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

      {routeEditLine && (
        <div className="absolute top-9 left-9 right-3 z-30 flex flex-wrap items-center gap-2.5 px-3 py-2 rounded-xl border bg-slate-900/95 shadow-2xl backdrop-blur-md"
          style={{ borderColor: lineColorMap.get(routeEditLine.id) ?? '#38bdf8' }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: lineColorMap.get(routeEditLine.id) ?? '#38bdf8' }}
          />
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-white truncate max-w-[220px]">
              Контрольные точки трассы: {routeEditLine.name}
            </div>
            <div className="text-[9px] text-slate-400">
              Точек: {routeEditLine.waypoints?.length ?? 0} · Кабель: {((lineRoutes.get(routeEditLine.id)?.cableLengthMm ?? 0) / 1000).toFixed(1)} м
            </div>
            <div className="text-[9px] text-slate-400">
              Клик — добавить · перетаскивание — передвинуть · клик на точку — удалить · Esc — выйти
            </div>
          </div>
          <button
            onClick={() => clearLineWaypoints(routeEditLine.id)}
            disabled={!routeEditLine.waypoints?.length}
            className="shrink-0 px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold transition"
          >
            Очистить
          </button>
          <button
            onClick={() => setRouteEditLine(null)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[10px] font-bold transition"
          >
            Готово
          </button>
        </div>
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
                onClick={() => {
                  useProjectStore.getState().setBoundaryTool('add');
                  startApartmentDrawing();
                }}
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

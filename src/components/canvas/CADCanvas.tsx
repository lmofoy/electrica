import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Stage } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { GridLayer } from './GridLayer';
import { RoomsLayer } from './RoomsLayer';
import { WallsAndDimensionsLayer } from './WallsAndDimensionsLayer';
import { DraftingLayer } from './DraftingLayer';
import { CadFloatingInput } from './CadFloatingInput';
import { Rulers } from './Rulers';
import { snapToGrid, distance, polarToPoint, angleDeg, snapAngle } from '../../core/geometry/math';
import { findBestSnapAdvanced } from '../../core/geometry/snapping';
import { buildAutoLayout } from '../../core/geometry/autoLayout';
import type { Point2D } from '../../types';
import { Home, PenTool } from 'lucide-react';

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
    selectedRoomId,
    settings,
    activeTool,
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
    setSelectedRoomId,
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
    drawingStage,
    boundaryMode,
    activeBoundaryTool,
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
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
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

  // Клик для фиксации точки
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0 || activeTool === 'pan' || activeTool === 'select') return;

    const isDrawing =
      activeTool === 'draw_apartment' ||
      activeTool === 'draw_room' ||
      activeTool === 'draw_shaft' ||
      activeTool === 'draw_opening' ||
      activeTool === 'draw_partition';
    if (!isDrawing) return;

    const stage = stageRef.current;
    if (!stage) return;
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
        if (dynamicInput.isOpen || dynamicInput.lockedLength !== null) {
          closeDynamicInput();
        } else if (draftVertices.length > 0) {
          cancelDraft();
        } else {
          setSelectedRoomId(null);
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
    setSelectedRoomId,
  ]);

  const lastVertex = draftVertices.length > 0 ? draftVertices[draftVertices.length - 1] : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-slate-950 select-none cursor-crosshair"
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
        <GridLayer
          width={dimensions.width}
          height={dimensions.height}
          zoom={zoom}
          stagePos={stagePos}
        />

        <RoomsLayer
          apartment={apartment}
          rooms={rooms}
          shafts={shafts}
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          zoom={zoom}
          boundaryMode={boundaryMode}
          autoLayout={autoLayout}
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
      </Stage>

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
        <span className="text-slate-400">
          Магнит: {activeSnap.isSnapped ? <span className="text-emerald-400 font-bold">{activeSnap.label}</span> : 'Сетка'}
        </span>
      </div>
    </div>
  );
};

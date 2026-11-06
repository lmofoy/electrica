import React, { useRef, useState, useEffect, useCallback } from 'react';
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
import type { Point2D } from '../../types';

export const CADCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  const {
    rooms,
    shafts,
    selectedRoomId,
    activeTool,
    zoom,
    stagePos,
    gridSnap,
    gridStepMm,
    draftVertices,
    cursorPosMm,
    dynamicInput,
    setZoom,
    setStagePos,
    setCursorPosMm,
    setSelectedRoomId,
    addDraftVertex,
    popDraftVertex,
    finishDraft,
    cancelDraft,
    openDynamicInput,
    closeDynamicInput,
    setLockedLength,
    setDynamicInputValues,
  } = useProjectStore();

  // Отслеживание размера окна
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

  // Перевод координат экрана -> мировые миллиметры
  const screenToWorld = useCallback(
    (screenX: number, screenY: number): Point2D => {
      return {
        x: (screenX - stagePos.x) / zoom,
        y: (screenY - stagePos.y) / zoom,
      };
    },
    [stagePos, zoom]
  );

  // Обработка колесика мыши (Зум относительно позиции курсора)
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.12;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.min(Math.max(newScale, 0.02), 1.5); // зум от 0.02 до 1.5

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

  // Движение мыши по холсту
  const handleMouseMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    let worldPos = screenToWorld(pointer.x, pointer.y);

    if (gridSnap && dynamicInput.lockedLength === null) {
      worldPos = snapToGrid(worldPos, gridStepMm);
    }

    setCursorPosMm(worldPos);
  };

  // Клик по холсту для построения
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Если клик был для перетаскивания холста — игнорируем
    if (activeTool === 'pan' || e.evt.button === 1 || e.evt.button === 2) return;

    const isDrawing = activeTool === 'draw_room' || activeTool === 'draw_shaft';
    if (!isDrawing) return;

    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    let clickPoint = screenToWorld(pointer.x, pointer.y);
    if (gridSnap && dynamicInput.lockedLength === null) {
      clickPoint = snapToGrid(clickPoint, gridStepMm);
    }

    // Если это первая вершина
    if (draftVertices.length === 0) {
      addDraftVertex(clickPoint);
      return;
    }

    // Если уже есть вершины
    const firstVertex = draftVertices[0];
    const lastVertex = draftVertices[draftVertices.length - 1];

    // Проверяем, не кликнули ли в первую вершину (замыкание)
    const distToFirst = distance(clickPoint, firstVertex);
    if (draftVertices.length >= 2 && distToFirst < 30 / zoom && dynamicInput.lockedLength === null) {
      finishDraft();
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

    // Обычное добавление вершины с привязкой угла
    const angle = snapAngle(angleDeg(lastVertex, clickPoint), 6);
    const dist = distance(lastVertex, clickPoint);
    const snappedVertex = polarToPoint(lastVertex, dist, angle);
    addDraftVertex(snappedVertex);
  };

  // Обработка горячих клавиш (Tab, Esc, Backspace, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isDrawing = activeTool === 'draw_room' || activeTool === 'draw_shaft';

      // Нажатие Tab переключает на параметрический ввод длины
      if (e.key === 'Tab' && isDrawing && draftVertices.length > 0) {
        e.preventDefault();
        openDynamicInput('length');
        return;
      }

      // Отмена текущей операции (Escape)
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

      // Удаление последней вершины (Backspace)
      if (e.key === 'Backspace' && isDrawing && draftVertices.length > 0 && !dynamicInput.isOpen) {
        e.preventDefault();
        popDraftVertex();
        return;
      }

      // Завершение контура по нажатию Enter, если точек >= 3
      if (e.key === 'Enter' && isDrawing && draftVertices.length >= 3 && !dynamicInput.isOpen) {
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
      {/* Линейки */}
      <Rulers
        width={dimensions.width}
        height={dimensions.height}
        zoom={zoom}
        stagePos={stagePos}
        cursorPosMm={cursorPosMm}
      />

      {/* Konva Stage */}
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        draggable={activeTool === 'pan'}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onClick={handleStageClick}
        onDragEnd={(e) => {
          if (activeTool === 'pan') {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        scaleX={zoom}
        scaleY={zoom}
        x={stagePos.x}
        y={stagePos.y}
      >
        {/* Сетка */}
        <GridLayer
          width={dimensions.width}
          height={dimensions.height}
          zoom={zoom}
          stagePos={stagePos}
        />

        {/* Комнаты и шахты */}
        <RoomsLayer
          rooms={rooms}
          shafts={shafts}
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          zoom={zoom}
        />

        {/* Стены и размеры в мм */}
        <WallsAndDimensionsLayer rooms={rooms} zoom={zoom} />

        {/* Слой активного черчения */}
        <DraftingLayer
          draftVertices={draftVertices}
          cursorPosMm={cursorPosMm}
          dynamicInput={dynamicInput}
          zoom={zoom}
          isShaftTool={activeTool === 'draw_shaft'}
        />
      </Stage>

      {/* Всплывающий параметрический ввод (Tab -> Length -> Enter -> Angle -> Enter) */}
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

      {/* Информационная полоса внизу холста */}
      <div className="absolute bottom-3 left-9 z-30 flex items-center gap-4 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400 backdrop-blur-sm pointer-events-none">
        <span>
          X: <strong className="text-sky-400">{Math.round(cursorPosMm.x).toLocaleString('ru-RU')}</strong> мм
        </span>
        <span>
          Y: <strong className="text-emerald-400">{Math.round(cursorPosMm.y).toLocaleString('ru-RU')}</strong> мм
        </span>
        <span className="text-slate-600">|</span>
        <span>
          Масштаб: <strong className="text-amber-400">{Math.round(zoom * 100)}%</strong>
        </span>
        <span className="text-slate-600">|</span>
        <span className="text-slate-500">
          Сетка: {gridSnap ? `${gridStepMm} мм` : 'Выкл'}
        </span>
      </div>
    </div>
  );
};

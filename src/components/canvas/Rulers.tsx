import React, { useRef, useEffect } from 'react';
import type { Point2D } from '../../types';

interface RulersProps {
  width: number;
  height: number;
  zoom: number;
  stagePos: Point2D;
  cursorPosMm: Point2D;
}

export const Rulers: React.FC<RulersProps> = ({
  width,
  height,
  zoom,
  stagePos,
  cursorPosMm,
}) => {
  const topCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);

  const rulerThickness = 24;

  // Отрисовка верхней линейки (Ось X)
  useEffect(() => {
    const canvas = topCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, rulerThickness);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, rulerThickness);

    // Градуировка в мм
    let stepMm = 100;
    if (zoom < 0.05) stepMm = 1000;
    else if (zoom < 0.1) stepMm = 500;

    const startMm = -stagePos.x / zoom;
    const endMm = startMm + width / zoom;
    const firstTickMm = Math.floor(startMm / stepMm) * stepMm;

    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = '#334155';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    for (let mm = firstTickMm; mm <= endMm; mm += stepMm) {
      const screenX = mm * zoom + stagePos.x;
      const isMeter = mm % 1000 === 0;
      const tickHeight = isMeter ? 12 : 5;

      ctx.beginPath();
      ctx.moveTo(screenX, rulerThickness);
      ctx.lineTo(screenX, rulerThickness - tickHeight);
      ctx.stroke();

      if (isMeter) {
        ctx.fillText(`${mm / 1000}м`, screenX, 10);
      }
    }

    // Красная засечка позиции курсора
    const cursorScreenX = cursorPosMm.x * zoom + stagePos.x;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorScreenX, 0);
    ctx.lineTo(cursorScreenX, rulerThickness);
    ctx.stroke();
  }, [width, zoom, stagePos, cursorPosMm]);

  // Отрисовка левой линейки (Ось Y)
  useEffect(() => {
    const canvas = leftCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, rulerThickness, height);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, rulerThickness, height);

    let stepMm = 100;
    if (zoom < 0.05) stepMm = 1000;
    else if (zoom < 0.1) stepMm = 500;

    const startMm = -stagePos.y / zoom;
    const endMm = startMm + height / zoom;
    const firstTickMm = Math.floor(startMm / stepMm) * stepMm;

    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = '#334155';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';

    for (let mm = firstTickMm; mm <= endMm; mm += stepMm) {
      const screenY = mm * zoom + stagePos.y;
      const isMeter = mm % 1000 === 0;
      const tickWidth = isMeter ? 12 : 5;

      ctx.beginPath();
      ctx.moveTo(rulerThickness, screenY);
      ctx.lineTo(rulerThickness - tickWidth, screenY);
      ctx.stroke();

      if (isMeter) {
        ctx.save();
        ctx.translate(10, screenY + 3);
        ctx.fillText(`${mm / 1000}м`, 0, 0);
        ctx.restore();
      }
    }

    // Красная засечка позиции курсора
    const cursorScreenY = cursorPosMm.y * zoom + stagePos.y;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, cursorScreenY);
    ctx.lineTo(rulerThickness, cursorScreenY);
    ctx.stroke();
  }, [height, zoom, stagePos, cursorPosMm]);

  return (
    <>
      {/* Угловой квадрат (0, 0) */}
      <div
        style={{ width: rulerThickness, height: rulerThickness }}
        className="absolute top-0 left-0 bg-slate-900 border-r border-b border-slate-700/60 z-30 flex items-center justify-center text-[8px] font-mono text-slate-500 select-none"
      >
        мм
      </div>

      {/* Верхняя линейка */}
      <canvas
        ref={topCanvasRef}
        width={width}
        height={rulerThickness}
        style={{ left: rulerThickness, top: 0, height: rulerThickness }}
        className="absolute z-20 border-b border-slate-700/60 pointer-events-none"
      />

      {/* Левая линейка */}
      <canvas
        ref={leftCanvasRef}
        width={rulerThickness}
        height={height}
        style={{ left: 0, top: rulerThickness, width: rulerThickness }}
        className="absolute z-20 border-r border-slate-700/60 pointer-events-none"
      />
    </>
  );
};

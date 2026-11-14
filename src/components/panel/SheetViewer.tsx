import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  A3_HEIGHT_MM,
  A3_WIDTH_MM,
  SHEET_FRAME,
  type SheetRect,
} from '../../core/electrical/sheetLayout';

// -------------------------------------------------------------
// Общая оболочка печатного листа A3: затемнение, зум, печать,
// рамка и заголовок. Содержимое листа передаётся дочерними
// SVG-элементами (таблица, рейки, штамп).
// -------------------------------------------------------------

const PX_PER_MM = 4;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;
const DEFAULT_ZOOM = 0.9;

const INK = '#0f172a';
const MUTED = '#475569';

interface SheetViewerProps {
  toolbarTitle: string;
  toolbarSubtitle: string;
  sheetTitle: string;
  sheetSubtitle: string;
  titleY?: number;
  subtitleY?: number;
  frame?: SheetRect;
  printTitle: string;
  dialogLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const SheetViewer: React.FC<SheetViewerProps> = ({
  toolbarTitle,
  toolbarSubtitle,
  sheetTitle,
  sheetSubtitle,
  titleY = 13.2,
  subtitleY = 18.4,
  frame = SHEET_FRAME,
  printTitle,
  dialogLabel,
  onClose,
  children,
}) => {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const zoomBy = (delta: number) =>
    setZoom((value) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((value + delta) * 100) / 100))
    );

  const handlePrint = () => {
    const previousTitle = document.title;
    const restore = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restore);
    };
    document.title = printTitle;
    window.addEventListener('afterprint', restore);
    window.print();
  };

  return createPortal(
    <div
      className="sheet-print-host fixed inset-0 z-[60] flex flex-col bg-slate-950/95"
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
    >
      <div className="sheet-print-toolbar flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2 text-slate-200">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{toolbarTitle}</div>
          <div className="text-[10px] text-slate-500 truncate">{toolbarSubtitle}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="hidden sm:block text-[9px] text-slate-500 mr-1">
            A3 · печать через браузер, без потери качества
          </span>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-bold transition"
            title="Печать или сохранение в PDF (A3, 420×297 мм)"
          >
            <Printer size={14} />
            <span className="hidden sm:inline">Печать / PDF</span>
          </button>
          <button
            onClick={() => zoomBy(-ZOOM_STEP)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
            title="Уменьшить"
            aria-label="Уменьшить масштаб"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={() => setZoom(DEFAULT_ZOOM)}
            className="w-12 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] font-mono text-slate-300 hover:border-slate-600 transition"
            title="Сбросить масштаб"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => zoomBy(ZOOM_STEP)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
            title="Увеличить"
            aria-label="Увеличить масштаб"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={onClose}
            className="ml-1 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition"
            title="Закрыть лист (Esc)"
            aria-label="Закрыть лист"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="sheet-print-scroll flex-1 overflow-auto p-4 flex items-start justify-center">
        <div
          className="sheet-print-page shrink-0 bg-white shadow-2xl ring-1 ring-slate-700"
          style={{
            width: A3_WIDTH_MM * PX_PER_MM * zoom,
            height: A3_HEIGHT_MM * PX_PER_MM * zoom,
          }}
        >
          <svg
            viewBox={`0 0 ${A3_WIDTH_MM} ${A3_HEIGHT_MM}`}
            width="100%"
            height="100%"
            style={{ display: 'block', fontFamily: '"Inter", "Segoe UI", Arial, sans-serif' }}
          >
            <rect x={0} y={0} width={A3_WIDTH_MM} height={A3_HEIGHT_MM} fill="#ffffff" />
            <rect
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              fill="none"
              stroke={INK}
              strokeWidth={0.7}
            />
            <text x={frame.x + 7.5} y={titleY} fontSize={4.1} fontWeight={700} fill={INK}>
              {sheetTitle}
            </text>
            <text x={frame.x + 7.5} y={subtitleY} fontSize={2} fill={MUTED}>
              {sheetSubtitle}
            </text>
            {children}
          </svg>
        </div>
      </div>
    </div>,
    document.body
  );
};

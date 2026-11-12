import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { PanelCalculation as PanelCalculationModel } from '../../core/electrical/calculation';
import {
  buildCalculationSheet,
  type CalculationCell,
  type CalculationSheetLayout,
  type CalculationTone,
} from '../../core/electrical/calculationLayout';
import { A3_HEIGHT_MM, A3_WIDTH_MM } from '../../core/electrical/sheetLayout';

interface PanelCalculationProps {
  calculation: PanelCalculationModel;
  onClose: () => void;
}

const PX_PER_MM = 4;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;
const DEFAULT_ZOOM = 0.9;

const INK = '#0f172a';
const MUTED = '#475569';
const HEADER_FILL = '#f1f5f9';

const CELL_TONE: Record<CalculationTone, string> = {
  normal: INK,
  muted: MUTED,
  ok: '#15803d',
  warning: '#b45309',
  error: '#b91c1c',
};

const BOX_TONE: Record<
  CalculationTone,
  { fill: string; stroke: string; text: string }
> = {
  normal: { fill: '#f8fafc', stroke: '#cbd5e1', text: INK },
  muted: { fill: '#f8fafc', stroke: '#cbd5e1', text: MUTED },
  ok: { fill: '#f0fdf4', stroke: '#15803d', text: '#166534' },
  warning: { fill: '#fffbeb', stroke: '#b45309', text: '#92400e' },
  error: { fill: '#fef2f2', stroke: '#b91c1c', text: '#991b1b' },
};

function cellAnchorX(cell: CalculationCell): number {
  if (cell.align === 'start') return cell.x + 1.1;
  if (cell.align === 'end') return cell.x + cell.width - 1.1;
  return cell.x + cell.width / 2;
}

const TableHeader: React.FC<{ layout: CalculationSheetLayout }> = ({ layout }) => {
  const { table } = layout;
  const headers = table.columns.reduce<
    { column: (typeof table.columns)[number]; x: number }[]
  >((acc, column) => {
    const previous = acc[acc.length - 1];
    const x = previous ? previous.x + previous.column.width : table.x;
    acc.push({ column, x });
    return acc;
  }, []);
  return (
    <g>
      <rect
        x={table.x}
        y={table.y}
        width={table.width}
        height={table.headerHeight}
        fill={HEADER_FILL}
      />
      {headers.map(({ column, x }) => {
        const center = x + column.width / 2;
        const startY = table.y + (column.label.length === 1 ? 5.6 : 3.2);
        return (
          <g key={column.id}>
            {column.label.map((label, index) => (
              <text
                key={`${column.id}-${index}`}
                x={center}
                y={startY + index * 2.7}
                textAnchor="middle"
                fontSize={1.55}
                fontWeight={600}
                fill={INK}
              >
                {label}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
};

const TableRows: React.FC<{ layout: CalculationSheetLayout }> = ({ layout }) => {
  const { table } = layout;
  return (
    <g>
      {table.rows.map((row, rowIndex) => (
        <g key={`${row.kind}-${rowIndex}`}>
          <rect
            x={table.x}
            y={row.y}
            width={table.width}
            height={row.height}
            fill={row.fill}
          />
          {row.cells.map((cell) => {
            const hasSub = Boolean(cell.sub);
            const mainY = row.y + row.height / 2 + (hasSub ? -0.7 : cell.fontSize * 0.35);
            const subY = row.y + row.height / 2 + cell.subFontSize + 0.35;
            return (
              <g key={cell.columnId}>
                <text
                  x={cellAnchorX(cell)}
                  y={mainY}
                  textAnchor={cell.align}
                  fontSize={cell.fontSize}
                  fontWeight={cell.bold ? 700 : 400}
                  fill={CELL_TONE[cell.tone]}
                >
                  {cell.text}
                </text>
                {hasSub && (
                  <text
                    x={cellAnchorX(cell)}
                    y={subY}
                    textAnchor={cell.align}
                    fontSize={cell.subFontSize}
                    fill={MUTED}
                  >
                    {cell.sub}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
      <rect
        x={table.x}
        y={table.y}
        width={table.width}
        height={table.bottom - table.y}
        fill="none"
        stroke={INK}
        strokeWidth={0.5}
      />
      {table.lines.map((line, index) => (
        <line
          key={`table-line-${index}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={INK}
          strokeWidth={line.weight}
        />
      ))}
    </g>
  );
};

const DocumentBlock: React.FC<{ layout: CalculationSheetLayout }> = ({ layout }) => {
  const { document: block } = layout;
  const { rect } = block;
  const footerY = rect.y + 45;
  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="#ffffff"
        stroke={INK}
        strokeWidth={0.7}
      />
      {block.grid.map((line, index) => (
        <line
          key={`document-line-${index}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={INK}
          strokeWidth={line.weight}
        />
      ))}
      <text x={rect.x + 4} y={rect.y + 6.5} fontSize={3.2} fontWeight={700} fill={INK}>
        {block.title}
      </text>
      <text x={rect.x + 4} y={rect.y + 11.5} fontSize={1.9} fill={MUTED}>
        групповых линий и ввода
      </text>
      <text
        x={rect.x + rect.width - 4}
        y={rect.y + 6.5}
        textAnchor="end"
        fontSize={2.4}
        fontWeight={700}
        fill={INK}
      >
        {block.designation}
      </text>
      <text
        x={rect.x + rect.width - 4}
        y={rect.y + 11.5}
        textAnchor="end"
        fontSize={1.7}
        fill={MUTED}
      >
        {block.objectTitle}
      </text>
      {block.roles.map((role) => (
        <g key={role.id}>
          <text
            x={role.labelRect.x + 2}
            y={role.labelRect.y + 3.6}
            fontSize={1.6}
            fill={INK}
          >
            {role.label}
          </text>
          {role.date && (
            <text
              x={role.dateRect.x + role.dateRect.width / 2}
              y={role.dateRect.y + 3.6}
              textAnchor="middle"
              fontSize={1.4}
              fill={INK}
            >
              {role.date}
            </text>
          )}
        </g>
      ))}
      <text x={rect.x + 4} y={footerY} fontSize={1.8} fontWeight={700} fill={INK}>
        {block.organization} · {block.stage}
      </text>
      <text
        x={rect.x + rect.width - 4}
        y={footerY}
        textAnchor="end"
        fontSize={1.6}
        fill={INK}
      >
        Лист {block.sheet} из {block.sheetTotal}
      </text>
      <text x={rect.x + 4} y={footerY + 4.2} fontSize={1.35} fill={MUTED}>
        {block.basis}
      </text>
      <text
        x={rect.x + rect.width - 4}
        y={footerY + 4.2}
        textAnchor="end"
        fontSize={1.4}
        fill={MUTED}
      >
        {block.date}
      </text>
    </g>
  );
};

export const PanelCalculation: React.FC<PanelCalculationProps> = ({
  calculation,
  onClose,
}) => {
  const layout = useMemo(() => buildCalculationSheet(calculation), [calculation]);
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
    document.title = `Расчёт нагрузок ${calculation.panelName} — A3`;
    window.addEventListener('afterprint', restore);
    window.print();
  };

  const notesX = layout.notesBlock.x;
  const notesY = layout.notesBlock.y;

  return createPortal(
    <div
      className="calc-print-host fixed inset-0 z-[60] flex flex-col bg-slate-950/95"
      role="dialog"
      aria-modal="true"
      aria-label={`Расчётная таблица: ${calculation.panelName}`}
    >
      <div className="calc-print-toolbar flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2 text-slate-200">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">
            Расчётная таблица · {calculation.panelName}
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            {layout.statusText} · {calculation.rows.length} линий · {calculation.supply.voltageLabel}
          </div>
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
            title="Закрыть таблицу (Esc)"
            aria-label="Закрыть таблицу"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="calc-print-scroll flex-1 overflow-auto p-4 flex items-start justify-center">
        <div
          className="calc-print-page shrink-0 bg-white shadow-2xl ring-1 ring-slate-700"
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
              x={layout.frame.x}
              y={layout.frame.y}
              width={layout.frame.width}
              height={layout.frame.height}
              fill="none"
              stroke={INK}
              strokeWidth={0.7}
            />

            <text x={layout.frame.x + 7.5} y={layout.titleY} fontSize={4.1} fontWeight={700} fill={INK}>
              {layout.title}
            </text>
            <text x={layout.frame.x + 7.5} y={layout.subtitleY} fontSize={2} fill={MUTED}>
              {layout.subtitle}
            </text>

            {layout.headerBoxes.map((box) => {
              const tone = BOX_TONE[box.tone];
              return (
                <g key={box.title}>
                  <rect
                    x={box.rect.x}
                    y={box.rect.y}
                    width={box.rect.width}
                    height={box.rect.height}
                    rx={1.2}
                    fill={tone.fill}
                    stroke={tone.stroke}
                    strokeWidth={0.35}
                  />
                  <text
                    x={box.rect.x + 2}
                    y={box.rect.y + 4.2}
                    fontSize={1.8}
                    fontWeight={700}
                    fill={tone.text}
                  >
                    {box.title}
                  </text>
                  {box.lines.map((line, index) => (
                    <text
                      key={`${box.title}-${index}`}
                      x={box.rect.x + 2}
                      y={box.rect.y + 7.9 + index * 3}
                      fontSize={1.65}
                      fill={index === 0 ? tone.text : MUTED}
                    >
                      {line}
                    </text>
                  ))}
                </g>
              );
            })}

            <TableHeader layout={layout} />
            <TableRows layout={layout} />

            <rect
              x={layout.notesBlock.x}
              y={layout.notesBlock.y}
              width={layout.notesBlock.width}
              height={layout.notesBlock.height}
              fill="none"
              stroke={INK}
              strokeWidth={0.7}
            />
            <text
              x={notesX + 3}
              y={notesY + 5.8}
              fontSize={2.8}
              fontWeight={700}
              fill={INK}
            >
              {layout.notesTitle}
            </text>
            <line
              x1={notesX + 2}
              y1={notesY + 7.2}
              x2={notesX + layout.notesBlock.width - 2}
              y2={notesY + 7.2}
              stroke={INK}
              strokeWidth={0.25}
            />
            {layout.notesLines.map((line, index) => (
              <text
                key={index}
                x={notesX + 2.5}
                y={notesY + 11.5 + index * 4.35}
                fontSize={1.8}
                fill={INK}
              >
                {line}
              </text>
            ))}

            <DocumentBlock layout={layout} />
          </svg>
        </div>
      </div>
    </div>,
    document.body
  );
};

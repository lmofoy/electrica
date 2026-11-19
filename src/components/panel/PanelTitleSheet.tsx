import React, { useMemo } from 'react';
import type { RoomZone } from '../../types';
import type { PanelSchematic } from '../../core/electrical/schematic';
import type { PanelSpecification } from '../../core/electrical/specification';
import {
  buildTitleSheet,
  type TitleSheetTable,
} from '../../core/electrical/titleSheet';
import { SheetViewer } from './SheetViewer';
import { SheetDocumentBlock } from './SheetDocumentBlock';

interface PanelTitleSheetProps {
  schematic: PanelSchematic;
  specification: PanelSpecification;
  rooms: RoomZone[];
  deviceCount: number;
  onClose: () => void;
}

const INK = '#0f172a';
const MUTED = '#475569';
const HEADER_FILL = '#f1f5f9';
const ROW_FILL = '#f8fafc';

function cellAnchorX(
  x: number,
  width: number,
  align: TitleSheetTable['columns'][number]['align']
): number {
  if (align === 'start') return x + 2;
  if (align === 'end') return x + width - 2;
  return x + width / 2;
}

const Table: React.FC<{ table: TitleSheetTable }> = ({ table }) => {
  const { rect } = table;
  const columns = table.columns.reduce<{ column: TitleSheetTable['columns'][number]; x: number }[]>(
    (acc, column) => {
      const previous = acc[acc.length - 1];
      acc.push({ column, x: previous ? previous.x + previous.column.width : rect.x });
      return acc;
    },
    []
  );
  const headerTextY = rect.y + table.headerHeight / 2 + 0.65;

  return (
    <g>
      <text x={rect.x} y={rect.y - 2.4} fontSize={2.9} fontWeight={700} fill={INK}>
        {table.title}
      </text>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="#ffffff"
        stroke={INK}
        strokeWidth={0.5}
      />
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={table.headerHeight}
        fill={HEADER_FILL}
      />
      {columns.map(({ column, x }) => (
        <text
          key={column.id}
          x={cellAnchorX(x, column.width, column.align)}
          y={headerTextY}
          textAnchor={column.align}
          fontSize={1.85}
          fontWeight={600}
          fill={INK}
        >
          {column.label}
        </text>
      ))}
      {table.rows.map((row, rowIndex) => {
        const rowY = rect.y + table.headerHeight + table.rowHeight * rowIndex;
        return (
          <g key={`row-${rowIndex}`}>
            {rowIndex % 2 === 1 && (
              <rect
                x={rect.x}
                y={rowY}
                width={rect.width}
                height={table.rowHeight}
                fill={ROW_FILL}
              />
            )}
            {row.cells.map((text, cellIndex) => {
              const placed = columns[cellIndex];
              if (!placed) return null;
              const isLabel = table.id === 'params' && cellIndex === 0;
              const isValue = table.id === 'params' && cellIndex === 1;
              const isRefCode = table.id === 'refs' && cellIndex === 0;
              return (
                <text
                  key={`${rowIndex}-${cellIndex}`}
                  x={cellAnchorX(placed.x, placed.column.width, placed.column.align)}
                  y={rowY + table.rowHeight / 2 + table.fontSize * 0.35}
                  textAnchor={placed.column.align}
                  fontSize={table.fontSize}
                  fontWeight={isValue || isRefCode ? 600 : undefined}
                  fill={isLabel ? MUTED : INK}
                >
                  {text}
                </text>
              );
            })}
          </g>
        );
      })}
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

export const PanelTitleSheet: React.FC<PanelTitleSheetProps> = ({
  schematic,
  specification,
  rooms,
  deviceCount,
  onClose,
}) => {
  const layout = useMemo(
    () => buildTitleSheet({ schematic, specification, rooms, deviceCount }),
    [schematic, specification, rooms, deviceCount]
  );

  const { header } = layout;
  const notesX = layout.notesBlock.x;
  const notesY = layout.notesBlock.y;

  return (
    <SheetViewer
      toolbarTitle={`Титульный лист · ${schematic.panelName}`}
      toolbarSubtitle={`ЭС-00 · ${schematic.supply.voltageLabel} · ${schematic.groups.length} групп`}
      sheetTitle=""
      sheetSubtitle=""
      printTitle={`Титульный лист — ЭС-00`}
      dialogLabel={`Титульный лист комплекта: ${schematic.panelName}`}
      onClose={onClose}
    >
      <text
        x={layout.frame.x + layout.frame.width / 2}
        y={33}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        letterSpacing={0.25}
        fill={INK}
      >
        {header.title}
      </text>
      <text
        x={layout.frame.x + layout.frame.width / 2}
        y={43}
        textAnchor="middle"
        fontSize={3.2}
        fill={MUTED}
      >
        {header.subtitle}
      </text>
      <text x={header.rule.x1} y={51.5} fontSize={2.6} fill={INK}>
        {header.objectLine}
      </text>
      <line
        x1={header.rule.x1}
        y1={header.rule.y1}
        x2={header.rule.x2}
        y2={header.rule.y2}
        stroke="#cbd5e1"
        strokeWidth={header.rule.weight}
      />
      {header.introLines.map((line, index) => (
        <text
          key={`intro-${index}`}
          x={header.rule.x1}
          y={62 + index * 5}
          fontSize={2.4}
          fill={index === header.introLines.length - 1 ? MUTED : INK}
        >
          {line}
        </text>
      ))}

      <Table table={layout.params} />
      <Table table={layout.sheets} />
      <Table table={layout.refs} />

      <rect
        x={layout.notesBlock.x}
        y={layout.notesBlock.y}
        width={layout.notesBlock.width}
        height={layout.notesBlock.height}
        fill="none"
        stroke={INK}
        strokeWidth={0.7}
      />
      <text x={notesX + 3} y={notesY + 5.8} fontSize={2.8} fontWeight={700} fill={INK}>
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
          key={`note-${index}`}
          x={notesX + 2.5}
          y={notesY + 12.5 + index * 5.2}
          fontSize={1.95}
          fill={INK}
        >
          {line}
        </text>
      ))}

      <SheetDocumentBlock block={layout.document} />
    </SheetViewer>
  );
};

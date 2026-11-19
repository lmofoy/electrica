import React from 'react';
import type { CableJournalSheet } from '../../core/electrical/cableJournalLayout';
import { SheetViewer } from './SheetViewer';
import { SheetDocumentBlock } from './SheetDocumentBlock';

// Печатный лист ЭС-07 «Кабельный журнал».
const INK = '#0f172a';
const MUTED = '#475569';
const HEADER_FILL = '#f1f5f9';

interface PanelCableJournalProps {
  sheet: CableJournalSheet;
  onClose: () => void;
}

export const PanelCableJournal: React.FC<PanelCableJournalProps> = ({
  sheet,
  onClose,
}) => {
  const columnX: number[] = [];
  let cursor = sheet.table.x;
  for (const column of sheet.columns) {
    columnX.push(cursor);
    cursor += column.width;
  }
  const alignX = (index: number) => {
    const column = sheet.columns[index];
    if (column.align === 'start') return columnX[index] + 1.2;
    if (column.align === 'end') return columnX[index] + column.width - 1.2;
    return columnX[index] + column.width / 2;
  };
  const textAnchor = (index: number) =>
    sheet.columns[index].align === 'start'
      ? 'start'
      : sheet.columns[index].align === 'end'
        ? 'end'
        : 'middle';

  return (
    <SheetViewer
      toolbarTitle={`Кабельный журнал · ${sheet.document.objectTitle}`}
      toolbarSubtitle={sheet.subtitle}
      sheetTitle={sheet.title}
      sheetSubtitle={sheet.subtitle}
      printTitle={`Кабельный журнал ${sheet.document.objectTitle} — ЭС-07`}
      dialogLabel={`Кабельный журнал: ${sheet.document.objectTitle}`}
      onClose={onClose}
    >
      <rect
        x={sheet.table.x}
        y={sheet.table.y}
        width={sheet.table.width}
        height={sheet.table.headerHeight}
        fill={HEADER_FILL}
      />
      {sheet.columns.map((column, index) => (
        <text
          key={`head-${column.id}`}
          x={alignX(index)}
          y={sheet.table.y + 7.2}
          fontSize={1.45}
          fontWeight={600}
          textAnchor={textAnchor(index)}
          fill={INK}
        >
          {column.label}
        </text>
      ))}

      {sheet.table.rows.map((row, rowIndex) => (
        <g key={`row-${rowIndex}`}>
          <rect
            x={sheet.table.x}
            y={row.y}
            width={sheet.table.width}
            height={row.height}
            fill={row.fill}
          />
          {row.cells.map((cell, cellIndex) => {
            const hasSub = Boolean(cell.sub);
            return (
              <g key={`cell-${rowIndex}-${cellIndex}`}>
                <text
                  x={alignX(cellIndex)}
                  y={row.y + row.height / 2 + (hasSub ? -0.5 : 0.55)}
                  fontSize={1.5}
                  textAnchor={textAnchor(cellIndex)}
                  fill={INK}
                >
                  {cell.text}
                </text>
                {hasSub && (
                  <text
                    x={alignX(cellIndex)}
                    y={row.y + row.height / 2 + 1.9}
                    fontSize={1.25}
                    textAnchor={textAnchor(cellIndex)}
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
        x={sheet.table.x}
        y={sheet.table.y}
        width={sheet.table.width}
        height={sheet.table.bottom - sheet.table.y}
        fill="none"
        stroke={INK}
        strokeWidth={0.5}
      />
      {sheet.table.lines.map((line, index) => (
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

      <text
        x={sheet.totalsLine.x}
        y={sheet.totalsLine.y}
        fontSize={1.7}
        fontWeight={600}
        fill={INK}
      >
        {sheet.totalsLine.text}
      </text>

      <rect
        x={sheet.notesBlock.x}
        y={sheet.notesBlock.y}
        width={sheet.notesBlock.width}
        height={sheet.notesBlock.height}
        fill="none"
        stroke={INK}
        strokeWidth={0.7}
      />
      <text
        x={sheet.notesBlock.x + 3}
        y={sheet.notesBlock.y + 5.8}
        fontSize={2.8}
        fontWeight={700}
        fill={INK}
      >
        {sheet.notesTitle}
      </text>
      <line
        x1={sheet.notesBlock.x + 2}
        y1={sheet.notesBlock.y + 7.2}
        x2={sheet.notesBlock.x + sheet.notesBlock.width - 2}
        y2={sheet.notesBlock.y + 7.2}
        stroke={INK}
        strokeWidth={0.25}
      />
      {sheet.notesLines.map((line, index) => (
        <text
          key={`note-${index}`}
          x={sheet.notesBlock.x + 2.5}
          y={sheet.notesBlock.y + 11.5 + index * 4.35}
          fontSize={1.75}
          fill={INK}
        >
          {line}
        </text>
      ))}

      <SheetDocumentBlock block={sheet.document} />
    </SheetViewer>
  );
};

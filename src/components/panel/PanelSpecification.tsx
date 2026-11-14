import React, { useMemo } from 'react';
import type { PanelSpecification as PanelSpecificationModel } from '../../core/electrical/specification';
import {
  buildSpecificationSheet,
  type SpecificationCell,
  type SpecificationSheetLayout,
  type SpecificationRow,
} from '../../core/electrical/specificationLayout';
import { SheetViewer } from './SheetViewer';
import { SheetDocumentBlock } from './SheetDocumentBlock';

interface PanelSpecificationProps {
  specification: PanelSpecificationModel;
  onClose: () => void;
}

const INK = '#0f172a';
const MUTED = '#475569';
const HEADER_FILL = '#f1f5f9';

const BOX_TONE = {
  normal: { fill: '#f8fafc', stroke: '#cbd5e1', text: INK },
  ok: { fill: '#f0fdf4', stroke: '#15803d', text: '#166534' },
  warning: { fill: '#fffbeb', stroke: '#b45309', text: '#92400e' },
  error: { fill: '#fef2f2', stroke: '#b91c1c', text: '#991b1b' },
} as const;

function cellAnchorX(cell: SpecificationCell): number {
  if (cell.align === 'start') return cell.x + 1.1;
  if (cell.align === 'end') return cell.x + cell.width - 1.1;
  return cell.x + cell.width / 2;
}

const HeaderBoxes: React.FC<{ layout: SpecificationSheetLayout }> = ({ layout }) => (
  <g>
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
  </g>
);

const TableHeader: React.FC<{ layout: SpecificationSheetLayout }> = ({ layout }) => {
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
        const startY = table.y + (column.label.length === 1 ? 5.4 : 3.4);
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

const TableRow: React.FC<{ row: SpecificationRow; tableX: number; tableWidth: number }> = ({
  row,
  tableX,
  tableWidth,
}) => {
  if (row.kind === 'section') {
    return (
      <g>
        <rect x={tableX} y={row.y} width={tableWidth} height={row.height} fill={row.fill} />
        <text
          x={tableX + 2}
          y={row.y + row.height / 2 + 0.7}
          fontSize={1.8}
          fontWeight={700}
          fill={INK}
        >
          {row.label}
        </text>
      </g>
    );
  }
  return (
    <g>
      <rect x={tableX} y={row.y} width={tableWidth} height={row.height} fill={row.fill} />
      {row.cells.map((cell) => {
        const hasSub = Boolean(cell.sub);
        const mainY =
          row.y + row.height / 2 + (hasSub ? -0.4 : cell.fontSize * 0.35);
        return (
          <g key={cell.columnId}>
            <text
              x={cellAnchorX(cell)}
              y={mainY}
              textAnchor={cell.align}
              fontSize={cell.fontSize}
              fill={cell.muted ? MUTED : INK}
            >
              {cell.text}
            </text>
            {hasSub && (
              <text
                x={cellAnchorX(cell)}
                y={row.y + row.height / 2 + cell.subFontSize + 0.7}
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
  );
};

const Table: React.FC<{ layout: SpecificationSheetLayout }> = ({ layout }) => {
  const { table } = layout;
  return (
    <g>
      <TableHeader layout={layout} />
      {table.rows.map((row, index) => (
        <TableRow
          key={`${row.kind}-${index}`}
          row={row}
          tableX={table.x}
          tableWidth={table.width}
        />
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

export const PanelSpecification: React.FC<PanelSpecificationProps> = ({
  specification,
  onClose,
}) => {
  const layout = useMemo(
    () => buildSpecificationSheet(specification),
    [specification]
  );
  const notesX = layout.notesBlock.x;
  const notesY = layout.notesBlock.y;

  return (
    <SheetViewer
      toolbarTitle={`Спецификация · ${specification.panelName}`}
      toolbarSubtitle={`${specification.items.length} позиций · кабель ${specification.totals.cableMeters} м · ${specification.statusText}`}
      sheetTitle={layout.title}
      sheetSubtitle={layout.subtitle}
      printTitle={`Спецификация ${specification.panelName} — ЭС-03`}
      dialogLabel={`Спецификация оборудования: ${specification.panelName}`}
      onClose={onClose}
    >
      <HeaderBoxes layout={layout} />
      <Table layout={layout} />

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
          key={index}
          x={notesX + 2.5}
          y={notesY + 11.5 + index * 4.35}
          fontSize={1.8}
          fill={INK}
        >
          {line}
        </text>
      ))}

      <SheetDocumentBlock block={layout.document} />
    </SheetViewer>
  );
};

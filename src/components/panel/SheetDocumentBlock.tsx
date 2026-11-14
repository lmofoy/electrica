import React from 'react';
import type { SheetDocumentBlock as SheetDocumentBlockModel } from '../../core/electrical/sheetDocument';

const INK = '#0f172a';
const MUTED = '#475569';

interface SheetDocumentBlockProps {
  block: SheetDocumentBlockModel;
}

// Основная надпись ЭС-03/ЭС-04 в миллиметровых координатах листа.
export const SheetDocumentBlock: React.FC<SheetDocumentBlockProps> = ({ block }) => {
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
      {block.subtitle && (
        <text x={rect.x + 4} y={rect.y + 11.5} fontSize={1.7} fill={MUTED}>
          {block.subtitle}
        </text>
      )}
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
          <text x={role.labelRect.x + 2} y={role.labelRect.y + 3.6} fontSize={1.6} fill={INK}>
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

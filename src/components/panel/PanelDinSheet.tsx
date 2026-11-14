import React, { useMemo } from 'react';
import type { ElectricalPanel, RoomZone } from '../../types';
import type {
  PanelDinSheet as PanelDinSheetModel,
  DinSheetZoneSpan,
  DinTone,
} from '../../core/electrical/dinLayout';
import { buildDinSheetLayout, dinZoneColor } from '../../core/electrical/dinLayout';
import { SheetViewer } from './SheetViewer';
import { SheetDocumentBlock } from './SheetDocumentBlock';

interface PanelDinSheetProps {
  panel: ElectricalPanel;
  rooms?: RoomZone[];
  onClose: () => void;
}

const INK = '#0f172a';
const MUTED = '#475569';

const TONE: Record<DinTone | 'free', { fill: string; stroke: string; text: string }> = {
  input: { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' },
  protection: { fill: '#fef3c7', stroke: '#d97706', text: '#92400e' },
  line: { fill: '#e2e8f0', stroke: '#475569', text: '#0f172a' },
  free: { fill: '#ffffff', stroke: '#94a3b8', text: MUTED },
};

function clip(text: string, widthMm: number, fontSize: number): string {
  const maxChars = Math.max(3, Math.floor((widthMm - 1.5) / (fontSize * 0.58)));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

const ZoneBand: React.FC<{ railY: number; zone: DinSheetZoneSpan; first: boolean }> = ({
  railY,
  zone,
  first,
}) => {
  const color = dinZoneColor(zone.colorIndex, zone.zoneId);
  return (
    <g>
      <rect
        x={zone.x}
        y={railY - 1.6}
        width={Math.max(0.8, zone.width)}
        height={0.75}
        fill={color}
      />
      {zone.width >= 9 && (
        <text x={zone.x + 0.5} y={railY - 2.2} fontSize={1.35} fontWeight={600} fill={INK}>
          {clip(zone.name, zone.width, 1.35)}
        </text>
      )}
      {!first && (
        <line
          x1={zone.x}
          y1={railY - 4.8}
          x2={zone.x}
          y2={railY + 20.5}
          stroke={color}
          strokeWidth={0.3}
          strokeDasharray="1 0.9"
        />
      )}
    </g>
  );
};

const Rails: React.FC<{ sheet: PanelDinSheetModel }> = ({ sheet }) => (
  <g>
    <rect
      x={sheet.enclosureRect.x}
      y={sheet.enclosureRect.y}
      width={sheet.enclosureRect.width}
      height={sheet.enclosureRect.height}
      fill="#f8fafc"
      stroke={INK}
      strokeWidth={0.6}
    />
    {sheet.rails.map((rail) => (
      <g key={rail.index}>
        <rect
          x={rail.x}
          y={rail.y}
          width={rail.width}
          height={rail.height}
          fill="#ffffff"
          stroke="#94a3b8"
          strokeWidth={0.3}
        />
        {rail.zones.map((zone, zoneIndex) => (
          <ZoneBand
            key={`${rail.index}-${zone.zoneId}-${zoneIndex}`}
            railY={rail.y}
            zone={zone}
            first={zoneIndex === 0}
          />
        ))}
        {Array.from({ length: rail.modules }, (_, slot) => (
          <line
            key={`slot-${slot}`}
            x1={rail.x + slot * sheet.slotWidth}
            y1={rail.y + 1}
            x2={rail.x + slot * sheet.slotWidth}
            y2={rail.y + 20}
            stroke="#e2e8f0"
            strokeWidth={0.2}
            strokeDasharray="1 1"
          />
        ))}
        <rect
          x={rail.x}
          y={rail.y + 21}
          width={rail.width}
          height={1.8}
          fill="#94a3b8"
        />
        {rail.items.map((item) => {
          const tone = TONE[item.tone];
          return (
            <g key={item.id}>
              <rect
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                rx={0.8}
                fill={tone.fill}
                stroke={tone.stroke}
                strokeWidth={0.35}
              />
              <text
                x={item.x + 1.1}
                y={item.y + 4}
                fontSize={2.1}
                fontWeight={700}
                fill={tone.text}
              >
                {item.designation}
              </text>
              <text
                x={item.x + 1.1}
                y={item.y + 7.8}
                fontSize={1.4}
                fill={tone.text}
              >
                {clip(item.label, item.width, 1.4)}
              </text>
              {item.width >= 30 && (
                <text
                  x={item.x + 1.1}
                  y={item.y + 10.9}
                  fontSize={1.05}
                  fill={MUTED}
                >
                  {clip(item.detail, item.width, 1.05)}
                </text>
              )}
            </g>
          );
        })}
        <text
          x={rail.x + 0.5}
          y={rail.y + rail.height - 1}
          fontSize={1.2}
          fill={MUTED}
        >
          Рейка {rail.index} · {rail.used}/12
        </text>
      </g>
    ))}
  </g>
);

const Legend: React.FC<{ sheet: PanelDinSheetModel }> = ({ sheet }) => {
  const { rect, title, entries } = sheet.legend;
  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="#ffffff"
        stroke="#94a3b8"
        strokeWidth={0.35}
      />
      <text x={rect.x + 2} y={rect.y + 4.6} fontSize={1.8} fontWeight={700} fill={INK}>
        {title}
      </text>
      {entries.map((entry, index) => {
        const tone = TONE[entry.tone];
        const rowY = rect.y + 10 + index * 6;
        return (
          <g key={entry.label}>
            <rect
              x={rect.x + 2}
              y={rowY - 3}
              width={5}
              height={4}
              fill={tone.fill}
              stroke={tone.stroke}
              strokeWidth={0.35}
              strokeDasharray={entry.tone === 'free' ? '1 0.8' : undefined}
            />
            <text x={rect.x + 9} y={rowY} fontSize={1.6} fill={INK}>
              {entry.label}
            </text>
          </g>
        );
      })}
    </g>
  );
};

const Summary: React.FC<{ sheet: PanelDinSheetModel }> = ({ sheet }) => {
  const { rect, title, lines } = sheet.summary;
  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="#ffffff"
        stroke="#94a3b8"
        strokeWidth={0.35}
      />
      <text x={rect.x + 2} y={rect.y + 4.6} fontSize={1.8} fontWeight={700} fill={INK}>
        {title}
      </text>
      {lines.map((line, index) => (
        <text
          key={index}
          x={rect.x + 2}
          y={rect.y + 10 + index * 6}
          fontSize={1.55}
          fill={index === 0 ? INK : MUTED}
        >
          {line}
        </text>
      ))}
    </g>
  );
};

const ZonesBox: React.FC<{ sheet: PanelDinSheetModel }> = ({ sheet }) => {
  const { rect, title, entries, truncated } = sheet.zonesBox;
  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill="#ffffff"
        stroke="#94a3b8"
        strokeWidth={0.35}
      />
      <text x={rect.x + 2} y={rect.y + 4.6} fontSize={1.8} fontWeight={700} fill={INK}>
        {title}
      </text>
      {entries.map((entry, index) => {
        const rowY = rect.y + 10 + index * 6;
        return (
          <g key={entry.id}>
            <rect
              x={rect.x + 2}
              y={rowY - 2.6}
              width={2.6}
              height={2.6}
              fill={dinZoneColor(entry.colorIndex, entry.id)}
            />
            <text x={rect.x + 6.2} y={rowY} fontSize={1.55} fill={INK}>
              {clip(entry.name, rect.width - 26, 1.55)}
            </text>
            <text
              x={rect.x + rect.width - 2}
              y={rowY}
              fontSize={1.4}
              fill={MUTED}
              textAnchor="end"
            >
              {entry.modules} мод.
            </text>
          </g>
        );
      })}
      {truncated > 0 && (
        <text
          x={rect.x + 2}
          y={rect.y + 10 + entries.length * 6}
          fontSize={1.4}
          fill={MUTED}
        >
          ещё {truncated} зон…
        </text>
      )}
    </g>
  );
};

const Notes: React.FC<{ sheet: PanelDinSheetModel }> = ({ sheet }) => {
  const { notesBlock, notesTitle, notesLines } = sheet;
  return (
    <g>
      <rect
        x={notesBlock.x}
        y={notesBlock.y}
        width={notesBlock.width}
        height={notesBlock.height}
        fill="none"
        stroke={INK}
        strokeWidth={0.7}
      />
      <text
        x={notesBlock.x + 3}
        y={notesBlock.y + 5.8}
        fontSize={2.8}
        fontWeight={700}
        fill={INK}
      >
        {notesTitle}
      </text>
      <line
        x1={notesBlock.x + 2}
        y1={notesBlock.y + 7.2}
        x2={notesBlock.x + notesBlock.width - 2}
        y2={notesBlock.y + 7.2}
        stroke={INK}
        strokeWidth={0.25}
      />
      {notesLines.map((line, index) => (
        <text
          key={index}
          x={notesBlock.x + 2.5}
          y={notesBlock.y + 11.5 + index * 4.35}
          fontSize={1.8}
          fill={INK}
        >
          {line}
        </text>
      ))}
    </g>
  );
};

export const PanelDinSheet: React.FC<PanelDinSheetProps> = ({
  panel,
  rooms,
  onClose,
}) => {
  const sheet = useMemo(
    () => buildDinSheetLayout(panel, { rooms }),
    [panel, rooms]
  );
  const occupied = sheet.rails.reduce((sum, rail) => sum + rail.used, 0);
  return (
    <SheetViewer
      toolbarTitle={`Компоновка щита · ${sheet.panelName}`}
      toolbarSubtitle={`${sheet.rails.length} реек · занято ${occupied} модулей · DIN 35 мм`}
      sheetTitle={sheet.title}
      sheetSubtitle={sheet.subtitle}
      titleY={sheet.titleY}
      subtitleY={sheet.subtitleY}
      printTitle={`Компоновка щита ${sheet.panelName} — ЭС-04`}
      dialogLabel={`DIN-лист щита: ${sheet.panelName}`}
      onClose={onClose}
    >
      <Rails sheet={sheet} />
      <Legend sheet={sheet} />
      <Summary sheet={sheet} />
      <ZonesBox sheet={sheet} />
      <Notes sheet={sheet} />
      <SheetDocumentBlock block={sheet.document} />
    </SheetViewer>
  );
};

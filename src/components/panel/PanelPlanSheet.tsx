import React from 'react';
import type { DeviceType } from '../../types';
import { DEVICE_CATALOG } from '../../core/electrical/devices';
import type {
  PlanDeviceSymbol,
  PlanSheetLayout,
} from '../../core/electrical/planSheet';
import { SheetViewer } from './SheetViewer';
import { SheetDocumentBlock } from './SheetDocumentBlock';

// -------------------------------------------------------------
// Печатный план (ЭС-05 розетки / ЭС-06 освещение): стены и полы,
// приборы с высотами, трассы групп, ведомость, легенда и штамп.
// -------------------------------------------------------------

const INK = '#0f172a';
const MUTED = '#475569';
const WALL_FILL = '#dbe3ec';
const FLOOR_FILL = '#fbfdff';
const STROKE = 0.16;

function printColor(type: DeviceType): string {
  const entry = DEVICE_CATALOG[type];
  if (entry.connection === 'provision') return '#6d28d9';
  if (entry.group === 'socket') return entry.ipRating !== 'IP20' ? '#0e7490' : '#0369a1';
  if (entry.group === 'switch') return '#b45309';
  return '#a16207';
}

const Glyph: React.FC<{ type: DeviceType; color: string }> = ({ type, color }) => {
  const entry = DEVICE_CATALOG[type];
  const glyph = entry.glyph;
  const wet = entry.ipRating !== 'IP20';
  const line = (key: string, x1: number, y1: number, x2: number, y2: number) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={STROKE} />
  );

  if (glyph === 'socket') {
    const r = 1.5;
    const centers =
      entry.outlets === 3 ? [-0.8, 0, 0.8] : entry.outlets === 2 ? [-0.5, 0.5] : [0];
    return (
      <g>
        <path
          d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 Z`}
          fill="#ffffff"
          stroke={color}
          strokeWidth={STROKE}
        />
        {centers.flatMap((cx) =>
          [-0.3, 0.3].map((dx) =>
            line(`p-${cx}-${dx}`, cx + dx, -r + 0.15, cx + dx, -r - 1.0)
          )
        )}
        {entry.connection === 'terminal' && (
          <rect
            x={-0.55}
            y={0.25}
            width={1.1}
            height={0.5}
            rx={0.12}
            fill={color}
          />
        )}
        {wet && <circle cx={0} cy={-r * 0.45} r={0.3} fill={color} />}
      </g>
    );
  }

  if (
    glyph === 'switch_key' ||
    glyph === 'switch_pass' ||
    glyph === 'switch_cross' ||
    glyph === 'switch_dimmer' ||
    glyph === 'switch_motion' ||
    glyph === 'switch_presence' ||
    glyph === 'switch_provision'
  ) {
    const stem = 0.8;
    const r = 0.95;
    const cy = -stem - r;
    const keys = entry.keys ?? 1;
    return (
      <g>
        {line('stem', 0, 0, 0, -stem)}
        <circle
          cx={0}
          cy={cy}
          r={r}
          fill="#ffffff"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={glyph === 'switch_provision' ? '0.5 0.35' : undefined}
        />
        {glyph === 'switch_key' &&
          Array.from({ length: keys }, (_, index) => {
            const offset = (index - (keys - 1) / 2) * 0.62;
            return line(
              `key-${index}`,
              offset - 0.32,
              cy + 0.3,
              offset + 0.45,
              cy - 0.6
            );
          })}
        {glyph === 'switch_pass' && (
          <>
            {line('pd', -0.6, cy + 0.6, 0.6, cy - 0.6)}
            {line('pa1', -0.6, cy + 0.6, -0.24, cy + 0.6)}
            {line('pa2', -0.6, cy + 0.6, -0.6, cy + 0.24)}
            {line('pb1', 0.6, cy - 0.6, 0.24, cy - 0.6)}
            {line('pb2', 0.6, cy - 0.6, 0.6, cy - 0.24)}
          </>
        )}
        {glyph === 'switch_cross' && (
          <>
            {line('c1', -0.6, cy - 0.6, 0.6, cy + 0.6)}
            {line('c2', -0.6, cy + 0.6, 0.6, cy - 0.6)}
          </>
        )}
        {glyph === 'switch_dimmer' && (
          <>
            {line('d1', -0.6, cy + 0.6, 0.6, cy - 0.6)}
            <path
              d={`M ${-0.2} ${cy + 0.68} L 0.6 ${cy + 0.68} L 0.6 ${cy - 0.12} Z`}
              fill={color}
            />
          </>
        )}
        {(glyph === 'switch_motion' || glyph === 'switch_presence') && (
          <path
            d={`M ${(r + 0.5) * Math.cos(-Math.PI * 0.15)} ${
              cy + (r + 0.5) * Math.sin(-Math.PI * 0.15)
            } A ${r + 0.5} ${r + 0.5} 0 0 1 ${
              (r + 0.5) * Math.cos(Math.PI * 0.65)
            } ${cy + (r + 0.5) * Math.sin(Math.PI * 0.65)}`}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
          />
        )}
        {(glyph === 'switch_presence' || glyph === 'switch_provision') && (
          <circle cx={0} cy={cy} r={0.28} fill={color} />
        )}
      </g>
    );
  }

  if (
    glyph === 'light_ceiling' ||
    glyph === 'light_surface' ||
    glyph === 'light_recessed' ||
    glyph === 'light_outdoor' ||
    glyph === 'light_provision'
  ) {
    const r = 1.7;
    return (
      <g>
        <circle
          cx={0}
          cy={0}
          r={r}
          fill="#ffffff"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={glyph === 'light_provision' ? '0.6 0.4' : undefined}
        />
        {glyph === 'light_ceiling' && (
          <>
            {line('x1', -r * 0.7, -r * 0.7, r * 0.7, r * 0.7)}
            {line('x2', -r * 0.7, r * 0.7, r * 0.7, -r * 0.7)}
          </>
        )}
        {glyph === 'light_surface' && line('s1', -r * 0.8, -r * 0.8, r * 0.8, -r * 0.8)}
        {glyph === 'light_recessed' && (
          <circle
            cx={0}
            cy={0}
            r={r * 0.52}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeDasharray="0.45 0.35"
          />
        )}
        {glyph === 'light_outdoor' &&
          Array.from({ length: 8 }, (_, index) => {
            const angle = (Math.PI / 4) * index;
            return line(
              `ray-${index}`,
              Math.cos(angle) * r * 1.15,
              Math.sin(angle) * r * 1.15,
              Math.cos(angle) * r * 1.6,
              Math.sin(angle) * r * 1.6
            );
          })}
        {glyph === 'light_provision' && <circle cx={0} cy={0} r={0.3} fill={color} />}
      </g>
    );
  }

  if (glyph === 'light_sconce' || glyph === 'light_wall_wet') {
    const stem = 0.6;
    const r = 0.95;
    return (
      <g>
        {line('stem', 0, 0, 0, -stem)}
        <path
          d={`M ${-r} ${-stem} A ${r} ${r} 0 0 1 ${r} ${-stem} Z`}
          fill="#ffffff"
          stroke={color}
          strokeWidth={STROKE}
        />
        {line('r1', -r * 0.6, -stem - r * 0.6, -r * 1.3, -stem - r * 1.3)}
        {line('r2', r * 0.6, -stem - r * 0.6, r * 1.3, -stem - r * 1.3)}
        {glyph === 'light_wall_wet' && (
          <circle cx={0} cy={-stem - r * 0.45} r={0.28} fill={color} />
        )}
      </g>
    );
  }

  if (glyph === 'light_track') {
    const half = 1.7;
    return (
      <g>
        {line('bar', -half, -1.3, half, -1.3)}
        {[-0.6, 0, 0.6].map((ratio) => (
          <g key={`track-${ratio}`}>
            {line(`drop-${ratio}`, ratio * half, -1.3, ratio * half, -0.6)}
            <circle cx={ratio * half} cy={-0.55} r={0.28} fill={color} />
          </g>
        ))}
      </g>
    );
  }

  const half = 1.9;
  return (
    <g>
      {line('strip', -half, 0, half, 0)}
      <line
        x1={-half}
        y1={0}
        x2={half}
        y2={0}
        stroke={color}
        strokeWidth={STROKE}
        strokeDasharray="0.6 0.4"
      />
      {line('end1', -half, -0.4, -half, 0.4)}
      {line('end2', half, -0.4, half, 0.4)}
    </g>
  );
};

const NoteMark: React.FC<{ note: NonNullable<PlanDeviceSymbol['note']> }> = ({
  note,
}) => (
  <g>
    <line
      x1={note.leader.x1}
      y1={note.leader.y1}
      x2={note.leader.x2}
      y2={note.leader.y2}
      stroke={MUTED}
      strokeWidth={note.leader.weight}
    />
    {note.lines.map((line, lineIndex) => (
      <text
        key={`note-${lineIndex}`}
        x={note.x}
        y={note.y + lineIndex * note.lineHeight}
        fontSize={1.15}
        textAnchor="middle"
        fill={INK}
        stroke="#ffffff"
        strokeWidth={0.45}
        paintOrder="stroke"
      >
        {line}
      </text>
    ))}
  </g>
);

const PlanGraphics: React.FC<{ layout: PlanSheetLayout }> = ({ layout }) => (
  <g>
    {/* Полы комнат */}
    {layout.floors.map((floor, index) => (
      <path
        key={`floor-${index}`}
        d={floor.rings
          .map(
            (ring) =>
              `${ring.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} Z`
          )
          .join(' ')}
        fill={FLOOR_FILL}
        fillRule="evenodd"
        stroke="#cbd5e1"
        strokeWidth={0.18}
      />
    ))}

    {/* Монолитный массив стен */}
    {layout.wallPolygons.length > 0 &&
      layout.wallPolygons.map((polygon, index) => (
        <path
          key={`wall-${index}`}
          d={polygon
            .map(
              (ring) =>
                `${ring.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} Z`
            )
            .join(' ')}
          fill={WALL_FILL}
          fillRule="evenodd"
          stroke={MUTED}
          strokeWidth={0.22}
        />
      ))}
    {layout.wallSegments.map((wall, index) => (
      <line
        key={`wall-seg-${index}`}
        x1={wall.x1}
        y1={wall.y1}
        x2={wall.x2}
        y2={wall.y2}
        stroke="#475569"
        strokeWidth={wall.width}
        strokeLinecap="butt"
      />
    ))}
    {layout.partitionSegments.map((partition, index) => (
      <line
        key={`partition-${index}`}
        x1={partition.x1}
        y1={partition.y1}
        x2={partition.x2}
        y2={partition.y2}
        stroke="#64748b"
        strokeWidth={partition.width}
        strokeLinecap="butt"
      />
    ))}

    {/* Проёмы: двери с полотном и дугой, окна с двумя линиями */}
    {layout.openings.map((opening) => {
      const length = Math.hypot(opening.x1 - opening.x2, opening.y1 - opening.y2) || 1;
      const mx = (opening.x1 + opening.x2) / 2;
      const my = (opening.y1 + opening.y2) / 2;
      let nearest: { x: number; y: number } | null = null;
      let nearestDist = Infinity;
      for (const room of layout.rooms) {
        const d = Math.hypot(room.x - mx, room.y - my);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = room;
        }
      }
      const angle = Math.atan2(opening.y2 - opening.y1, opening.x2 - opening.x1);
      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      const side = nearest
        ? (nearest.x - opening.x1) * nx + (nearest.y - opening.y1) * ny >= 0
          ? 1
          : -1
        : 1;
      const swing = angle + side * (Math.PI / 2);
      const ex = opening.x1 + Math.cos(swing) * length;
      const ey = opening.y1 + Math.sin(swing) * length;
      return (
        <g key={opening.id}>
          <line
            x1={opening.x1}
            y1={opening.y1}
            x2={opening.x2}
            y2={opening.y2}
            stroke="#ffffff"
            strokeWidth={opening.clearWidth}
          />
          {opening.type === 'door' ? (
            <>
              <line
                x1={opening.x1}
                y1={opening.y1}
                x2={ex}
                y2={ey}
                stroke={INK}
                strokeWidth={0.2}
              />
              <path
                d={`M ${opening.x1 + Math.cos(angle) * length} ${
                  opening.y1 + Math.sin(angle) * length
                } A ${length} ${length} 0 0 ${side > 0 ? 1 : 0} ${ex} ${ey}`}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={0.18}
              />
            </>
          ) : (
            <>
              {opening.middleLine && (
                <line
                  x1={opening.middleLine.x1}
                  y1={opening.middleLine.y1}
                  x2={opening.middleLine.x2}
                  y2={opening.middleLine.y2}
                  stroke={INK}
                  strokeWidth={0.2}
                />
              )}
              <line
                x1={opening.x1 + nx * 0.22}
                y1={opening.y1 + ny * 0.22}
                x2={opening.x2 + nx * 0.22}
                y2={opening.y2 + ny * 0.22}
                stroke={INK}
                strokeWidth={0.2}
              />
            </>
          )}
          {opening.ticks.map((tick, index) => (
            <line
              key={`tick-${index}`}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke={INK}
              strokeWidth={0.25}
            />
          ))}
        </g>
      );
    })}

    {/* Платы монтажных рамок и свободные места — под символами механизмов */}
    {layout.frames.map((frame) => (
      <g
        key={`frame-${frame.id}`}
        transform={`translate(${frame.x} ${frame.y}) rotate(${frame.rotationDeg})`}
      >
        <rect
          x={-frame.width / 2}
          y={-frame.depth / 2}
          width={frame.width}
          height={frame.depth}
          rx={1.2}
          fill="#f1f5f9"
          stroke={MUTED}
          strokeWidth={STROKE}
          strokeDasharray={frame.mounting === 'surface' ? '1.2 0.8' : undefined}
        />
      </g>
    ))}
    {layout.frameSeats.map((seat) => (
      <circle
        key={`seat-${seat.frameId}-${seat.seatIndex}`}
        cx={seat.x}
        cy={seat.y}
        r={seat.radius}
        fill="none"
        stroke={MUTED}
        strokeWidth={STROKE}
        strokeDasharray="0.8 0.6"
      />
    ))}

    {/* Трассы групповых линий */}
    {layout.routes.map((route, index) => (
      <g key={`route-${index}`}>
        <polyline
          points={route.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke={route.color}
          strokeWidth={0.5}
          strokeDasharray={route.routing === 'floor' ? '1.6 1.1' : undefined}
          strokeLinejoin="round"
        />
        <text
          x={route.labelX}
          y={route.labelY - 0.9}
          fontSize={1.6}
          fontWeight={700}
          textAnchor="middle"
          fill={route.color}
          stroke="#ffffff"
          strokeWidth={0.5}
          paintOrder="stroke"
        >
          {`Гр.${route.index}`}
        </text>
      </g>
    ))}

    {/* Подписи помещений */}
    {layout.rooms.map((room) => (
      <g key={room.roomId}>
        <text
          x={room.x}
          y={room.y}
          fontSize={1.9}
          fontWeight={700}
          textAnchor="middle"
          fill={MUTED}
        >
          {room.name}
        </text>
        <text
          x={room.x}
          y={room.y + 2.5}
          fontSize={1.45}
          textAnchor="middle"
          fill="#64748b"
        >
          {room.areaLabel}
        </text>
      </g>
    ))}

    {/* Электрощит */}
    {layout.panel && (
      <g transform={`translate(${layout.panel.x} ${layout.panel.y}) rotate(${layout.panel.rotationDeg})`}>
        <rect
          x={-1.8}
          y={-0.7}
          width={3.6}
          height={1.4}
          rx={0.2}
          fill="#e0f2fe"
          stroke="#0369a1"
          strokeWidth={0.2}
        />
        <text
          x={0}
          y={0.32}
          fontSize={0.8}
          fontWeight={700}
          textAnchor="middle"
          fill="#075985"
        >
          ЩР
        </text>
      </g>
    )}
    {layout.panel && (
      <text
        x={layout.panel.x}
        y={layout.panel.y + 2.4}
        fontSize={1.4}
        fontWeight={600}
        textAnchor="middle"
        fill={MUTED}
      >
        {layout.panel.label}
      </text>
    )}

    {/* Приборы с высотами */}
    {layout.devices.map((device, index) => (
      <g key={`${device.id}-${index}`}>
        <g transform={`translate(${device.x} ${device.y}) rotate(${device.rotationDeg})`}>
          <Glyph type={device.type} color={printColor(device.type)} />
        </g>
        <text
          x={device.labelX}
          y={device.labelY}
          fontSize={1.25}
          textAnchor="middle"
          fill={MUTED}
          stroke="#ffffff"
          strokeWidth={0.45}
          paintOrder="stroke"
        >
          {device.label}
        </text>
        {device.note && <NoteMark note={device.note} />}
      </g>
    ))}

    {/* Размеры габаритов */}
    {layout.dimensions.map((dimension, index) => (
      <g key={`dim-${index}`}>
        {dimension.extensions.map((ext, extIndex) => (
          <line
            key={`ext-${extIndex}`}
            x1={ext.x1}
            y1={ext.y1}
            x2={ext.x2}
            y2={ext.y2}
            stroke="#94a3b8"
            strokeWidth={ext.weight}
          />
        ))}
        <line
          x1={dimension.x1}
          y1={dimension.y1}
          x2={dimension.x2}
          y2={dimension.y2}
          stroke={MUTED}
          strokeWidth={0.22}
        />
        {dimension.ticks.map((tick, tickIndex) => (
          <line
            key={`tick-${tickIndex}`}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={MUTED}
            strokeWidth={0.3}
          />
        ))}
        <text
          x={dimension.textX}
          y={dimension.textY}
          fontSize={1.6}
          textAnchor="middle"
          fill={MUTED}
          transform={
            dimension.textAngle
              ? `rotate(${dimension.textAngle} ${dimension.textX} ${dimension.textY})`
              : undefined
          }
        >
          {dimension.text}
        </text>
      </g>
    ))}
  </g>
);

const Legend: React.FC<{ layout: PlanSheetLayout }> = ({ layout }) => {
  const { legend } = layout;
  return (
    <g>
      <text x={legend.rect.x} y={legend.rect.y - 2.2} fontSize={1.9} fontWeight={700} fill={INK}>
        {legend.title}
      </text>
      <rect
        x={legend.rect.x}
        y={legend.rect.y}
        width={legend.rect.width}
        height={legend.rect.height}
        fill="#ffffff"
        stroke={INK}
        strokeWidth={0.35}
      />
      {legend.entries.map((entry) => (
        <g key={entry.type}>
          <g transform={`translate(${entry.x + 1.2} ${entry.y})`}>
            <Glyph type={entry.type} color={printColor(entry.type)} />
          </g>
          <text x={entry.x + 4} y={entry.y + 0.6} fontSize={1.5} fill={INK}>
            {entry.label}
          </text>
        </g>
      ))}
      {legend.truncated > 0 && (
        <text
          x={legend.rect.x + 2}
          y={legend.rect.y + legend.rect.height - 1.6}
          fontSize={1.3}
          fill={MUTED}
        >
          {`и ещё ${legend.truncated} поз. — см. спецификацию`}
        </text>
      )}
    </g>
  );
};

const Schedule: React.FC<{ layout: PlanSheetLayout }> = ({ layout }) => {
  const { schedule } = layout;
  const columnX: number[] = [];
  let cursor = schedule.rect.x;
  for (const column of schedule.columns) {
    columnX.push(cursor);
    cursor += column.width;
  }
  return (
    <g>
      <text
        x={schedule.rect.x}
        y={schedule.rect.y - 2.2}
        fontSize={1.9}
        fontWeight={700}
        fill={INK}
      >
        {schedule.title}
      </text>
      {schedule.columns.map((column, index) => (
        <text
          key={column.id}
          x={
            column.align === 'start'
              ? columnX[index] + 1
              : column.align === 'end'
                ? columnX[index] + column.width - 1
                : columnX[index] + column.width / 2
          }
          y={schedule.rect.y + 5.6}
          fontSize={1.35}
          fontWeight={600}
          textAnchor={column.align === 'start' ? 'start' : column.align === 'end' ? 'end' : 'middle'}
          fill={INK}
        >
          {column.label}
        </text>
      ))}
      {schedule.rows.map((row, rowIndex) => (
        <g key={`row-${rowIndex}`}>
          {rowIndex % 2 === 1 && (
            <rect
              x={schedule.rect.x}
              y={schedule.rect.y + schedule.headerHeight + rowIndex * schedule.rowHeight}
              width={schedule.rect.width}
              height={schedule.rowHeight}
              fill="#f8fafc"
            />
          )}
          {row.cells.map((cell, cellIndex) => {
            const column = schedule.columns[cellIndex];
            if (!column) return null;
            return (
              <text
                key={column.id}
                x={
                  column.align === 'start'
                    ? columnX[cellIndex] + 1
                    : column.align === 'end'
                      ? columnX[cellIndex] + column.width - 1
                      : columnX[cellIndex] + column.width / 2
                }
                y={
                  schedule.rect.y +
                  schedule.headerHeight +
                  rowIndex * schedule.rowHeight +
                  schedule.rowHeight / 2 +
                  0.55
                }
                fontSize={1.4}
                textAnchor={
                  column.align === 'start' ? 'start' : column.align === 'end' ? 'end' : 'middle'
                }
                fill={INK}
              >
                {cell}
              </text>
            );
          })}
        </g>
      ))}
      {schedule.emptyLabel && schedule.rows.length === 0 && (
        <text
          x={schedule.rect.x + schedule.rect.width / 2}
          y={schedule.rect.y + 13}
          fontSize={1.4}
          textAnchor="middle"
          fill={MUTED}
        >
          {schedule.emptyLabel}
        </text>
      )}
      <rect
        x={schedule.rect.x}
        y={schedule.rect.y}
        width={schedule.rect.width}
        height={schedule.rect.height}
        fill="none"
        stroke={INK}
        strokeWidth={0.35}
      />
      {schedule.lines.map((line, index) => (
        <line
          key={`line-${index}`}
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

interface PanelPlanSheetProps {
  layout: PlanSheetLayout;
  onClose: () => void;
}

export const PanelPlanSheet: React.FC<PanelPlanSheetProps> = ({ layout, onClose }) => (
  <SheetViewer
    toolbarTitle={`${layout.title} · М ${layout.scaleLabel}`}
    toolbarSubtitle={layout.subtitle}
    sheetTitle={layout.title}
    sheetSubtitle={`${layout.subtitle} · М ${layout.scaleLabel}`}
    printTitle={`${layout.title} — ${layout.document.designation}`}
    dialogLabel={`${layout.title}: ${layout.document.objectTitle}`}
    onClose={onClose}
  >
    <PlanGraphics layout={layout} />
    <Legend layout={layout} />
    <Schedule layout={layout} />

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
      x={layout.notesBlock.x + 3}
      y={layout.notesBlock.y + 5.8}
      fontSize={2.8}
      fontWeight={700}
      fill={INK}
    >
      {layout.notesTitle}
    </text>
    <line
      x1={layout.notesBlock.x + 2}
      y1={layout.notesBlock.y + 7.2}
      x2={layout.notesBlock.x + layout.notesBlock.width - 2}
      y2={layout.notesBlock.y + 7.2}
      stroke={INK}
      strokeWidth={0.25}
    />
    {layout.notesLines.map((line, index) => (
      <text
        key={index}
        x={layout.notesBlock.x + 2.5}
        y={layout.notesBlock.y + 11.5 + index * 4.35}
        fontSize={1.8}
        fill={INK}
      >
        {line}
      </text>
    ))}

    <SheetDocumentBlock block={layout.document} />
  </SheetViewer>
);

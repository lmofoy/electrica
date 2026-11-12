import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { PanelSchematic } from '../../core/electrical/schematic';
import {
  A3_HEIGHT_MM,
  A3_WIDTH_MM,
  buildPanelSheet,
  type SheetGroup,
  type SheetStatus,
  type SheetTitleBlock,
  type SheetTitleField,
} from '../../core/electrical/sheetLayout';

interface PanelSheetProps {
  schematic: PanelSchematic;
  onClose: () => void;
}

const PX_PER_MM = 4;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;
const DEFAULT_ZOOM = 0.75;

const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#94a3b8';

const STATUS_TONE: Record<
  SheetStatus,
  { stroke: string; fill: string; text: string }
> = {
  ok: { stroke: '#15803d', fill: '#f0fdf4', text: '#166534' },
  warnings: { stroke: '#b45309', fill: '#fffbeb', text: '#92400e' },
  errors: { stroke: '#b91c1c', fill: '#fef2f2', text: '#991b1b' },
};

function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

function cableLengthLabel(lengthMm: number): string {
  return lengthMm > 0 ? `${num(lengthMm / 1000, 1)} м` : 'длина —';
}

const GroupRow: React.FC<{ item: SheetGroup; pitch: number }> = ({ item, pitch }) => {
  const { group, breakerRect, rcdRect, rowY } = item;
  const boxRight = rcdRect ? rcdRect.x + rcdRect.width : breakerRect.x + breakerRect.width;
  const phase = group.phase ?? 'L';
  const detail = `${group.purposeLabel} · ${group.cable.cores}×${group.cable.sectionMm2} мм² · ${
    group.breaker.poles
  }P ${group.breaker.curve} · ${phase} · ${cableLengthLabel(group.cableLengthMm)}`;
  // В тесном ряду вторая строка не помещается: оставляем одно название.
  const { compact } = item;
  const nameFont = compact ? Math.min(2.4, Math.max(1.2, pitch * 0.5)) : 2.4;

  return (
    <g>
      <line
        x1={item.tapX}
        y1={rowY}
        x2={breakerRect.x}
        y2={rowY}
        stroke={item.phaseColor}
        strokeWidth={0.45}
      />
      <rect
        x={breakerRect.x}
        y={breakerRect.y}
        width={breakerRect.width}
        height={breakerRect.height}
        fill="#ffffff"
        stroke={INK}
        strokeWidth={0.35}
      />
      <text
        x={breakerRect.x + breakerRect.width / 2}
        y={rowY + 0.9}
        textAnchor="middle"
        fontSize={Math.min(2.4, Math.max(1.2, breakerRect.height * 0.72))}
        fontWeight={700}
        fill={INK}
      >
        {group.breaker.ratingA} А
      </text>

      {rcdRect && group.rcd && (
        <>
          <line
            x1={breakerRect.x + breakerRect.width}
            y1={rowY}
            x2={rcdRect.x}
            y2={rowY}
            stroke={INK}
            strokeWidth={0.35}
          />
          <rect
            x={rcdRect.x}
            y={rcdRect.y}
            width={rcdRect.width}
            height={rcdRect.height}
            fill="#ffffff"
            stroke={INK}
            strokeWidth={0.35}
          />
          <text
            x={rcdRect.x + rcdRect.width / 2}
            y={rowY + (rcdRect.height >= 6.2 ? -0.1 : 0.9)}
            textAnchor="middle"
            fontSize={Math.min(2.1, Math.max(1.2, rcdRect.height * 0.72))}
            fontWeight={700}
            fill={INK}
          >
            {group.rcd.sensitivityMa} мА
          </text>
          {rcdRect.height >= 6.2 && (
            <text
              x={rcdRect.x + rcdRect.width / 2}
              y={rowY + 2.4}
              textAnchor="middle"
              fontSize={1.5}
              fill={MUTED}
            >
              {group.rcd.poles}P {group.rcd.type}
              {group.rcd.selective ? ' S' : ''}
            </text>
          )}
        </>
      )}

      <line
        x1={boxRight}
        y1={rowY}
        x2={item.endpoint.x - 2}
        y2={rowY}
        stroke={INK}
        strokeWidth={0.35}
      />
      <polygon
        points={`${item.endpoint.x},${rowY} ${item.endpoint.x - 2.4},${rowY - 1.1} ${
          item.endpoint.x - 2.4
        },${rowY + 1.1}`}
        fill={INK}
      />

      <text
        x={breakerRect.x - 2.2}
        y={rowY - 1}
        textAnchor="end"
        fontSize={1.8}
        fill={MUTED}
      >
        {group.index}
      </text>
      <text
        x={item.labelX}
        y={compact ? rowY + nameFont * 0.35 : rowY - 1.1}
        fontSize={nameFont}
        fontWeight={700}
        fill={INK}
      >
        {group.name}
      </text>
      {!compact && (
        <text x={item.labelX} y={rowY + 2.9} fontSize={1.85} fill={MUTED}>
          {detail}
        </text>
      )}
      <text
        x={item.powerX}
        y={rowY - 1.1}
        textAnchor="end"
        fontSize={2}
        fontWeight={600}
        fill={INK}
      >
        {`${num(group.designPowerW / 1000, 2)} кВт · ${num(group.currentA)} А`}
      </text>
    </g>
  );
};

const fieldX = (field: SheetTitleField): number => {
  if (field.anchor === 'start') return field.rect.x + field.paddingX;
  if (field.anchor === 'end') return field.rect.x + field.rect.width - field.paddingX;
  return field.rect.x + field.rect.width / 2;
};

// Основная надпись ГОСТ 2.104-2006, форма 1: сетка, графы и подписи.
const TitleBlock: React.FC<{ block: SheetTitleBlock }> = ({ block }) => {
  const { rect } = block;
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
          key={`grid-${index}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={INK}
          strokeWidth={line.weight}
        />
      ))}
      {block.headers.map((header) => (
        <text
          key={header.id}
          x={header.rect.x + 0.7}
          y={header.rect.y + header.rect.height / 2 + 0.55}
          fontSize={1.55}
          fill={INK}
        >
          {header.text}
        </text>
      ))}
      {block.fields.map((field) => {
        const x = fieldX(field);
        const lineHeights = field.lines.map((item) => item.fontSize * 1.3);
        const total = lineHeights.reduce((sum, value) => sum + value, 0);
        let offset = field.valign === 'middle' ? (field.rect.height - total) / 2 : 0.6;
        return (
          <g key={field.id}>
            {field.lines.map((item, index) => {
              const baseline = field.rect.y + offset + item.fontSize * 0.82;
              offset += lineHeights[index];
              return (
                <text
                  key={`${field.id}-${index}`}
                  x={x}
                  y={baseline}
                  textAnchor={field.anchor}
                  fontSize={item.fontSize}
                  fontWeight={item.weight}
                  fill={item.muted ? MUTED : INK}
                >
                  {item.text}
                </text>
              );
            })}
          </g>
        );
      })}
      {block.roles.map((role) => (
        <g key={role.id}>
          <text
            x={role.labelRect.x + 1}
            y={role.labelRect.y + 3.55}
            fontSize={1.7}
            fill={INK}
          >
            {role.label}
          </text>
          {role.name && (
            <text
              x={role.nameRect.x + role.nameRect.width / 2}
              y={role.nameRect.y + 3.55}
              textAnchor="middle"
              fontSize={1.7}
              fill={INK}
            >
              {role.name}
            </text>
          )}
          {role.date && (
            <text
              x={role.dateRect.x + role.dateRect.width / 2}
              y={role.dateRect.y + 3.55}
              textAnchor="middle"
              fontSize={1.5}
              fill={INK}
            >
              {role.date}
            </text>
          )}
        </g>
      ))}
    </g>
  );
};

export const PanelSheet: React.FC<PanelSheetProps> = ({ schematic, onClose }) => {
  const layout = useMemo(() => buildPanelSheet(schematic), [schematic]);
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

  // Печать идёт через браузер: SVG остаётся векторным, а имя файла PDF
  // берётся из заголовка вкладки.
  const handlePrint = () => {
    const previousTitle = document.title;
    const restore = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restore);
    };
    document.title = `Схема щита ${schematic.panelName} — A3`;
    window.addEventListener('afterprint', restore);
    window.print();
  };

  const busLeft = layout.buses[0].x;
  const lastInput = layout.input.items[layout.input.items.length - 1];
  const inputRight = lastInput
    ? lastInput.rect.x + lastInput.rect.width
    : layout.frame.x;
  const notesX = layout.notesBlock.x;
  const notesY = layout.notesBlock.y;
  const tones = STATUS_TONE[layout.status];

  return createPortal(
    <div
      className="sheet-print-host fixed inset-0 z-[60] flex flex-col bg-slate-950/95"
      role="dialog"
      aria-modal="true"
      aria-label={`Чертёж A3: ${schematic.panelName}`}
    >
      <div className="sheet-print-toolbar flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2 text-slate-200">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">
            Чертёж A3 · {schematic.panelName}
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            420×297 мм, горизонтальный · {schematic.groups.length} групп · {schematic.supply.voltageLabel}
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
            title="Закрыть чертёж (Esc)"
            aria-label="Закрыть чертёж"
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

            {/* Рамка листа */}
            <rect
              x={layout.frame.x}
              y={layout.frame.y}
              width={layout.frame.width}
              height={layout.frame.height}
              fill="none"
              stroke={INK}
              strokeWidth={0.7}
            />

            {/* Ввод и аппараты ввода */}
            <text x={layout.frame.x + 1} y={10.4} fontSize={2.4} fontWeight={700} fill={INK}>
              {layout.input.sourceLabel}
            </text>
            <line
              x1={layout.frame.x}
              y1={layout.input.conductorY}
              x2={layout.input.items[0]?.rect.x ?? layout.frame.x}
              y2={layout.input.conductorY}
              stroke={INK}
              strokeWidth={0.45}
            />
            <line
              x1={inputRight}
              y1={layout.input.conductorY}
              x2={inputRight + 2}
              y2={layout.input.conductorY}
              stroke={INK}
              strokeWidth={0.45}
            />
            {layout.input.items.map((item) => {
              const centerX = item.rect.x + item.rect.width / 2;
              return (
                <g key={item.id}>
                  <rect
                    x={item.rect.x}
                    y={item.rect.y}
                    width={item.rect.width}
                    height={item.rect.height}
                    fill="#ffffff"
                    stroke={INK}
                    strokeWidth={0.4}
                    strokeDasharray={item.parallel ? '1.4 1' : undefined}
                  />
                  <text
                    x={centerX}
                    y={item.rect.y + 5.2}
                    textAnchor="middle"
                    fontSize={3.2}
                    fontWeight={700}
                    fill={INK}
                  >
                    {item.designation}
                  </text>
                  <text
                    x={centerX}
                    y={item.rect.y + 9.4}
                    textAnchor="middle"
                    fontSize={1.5}
                    fill={MUTED}
                  >
                    {item.title}
                  </text>
                  <text
                    x={centerX}
                    y={item.rect.y + item.rect.height + 3.2}
                    textAnchor="middle"
                    fontSize={1.45}
                    fill={FAINT}
                  >
                    {item.detail}
                  </text>
                </g>
              );
            })}

            {/* Связь ввода с шинами */}
            <path
              d={`M ${inputRight + 2} ${layout.input.conductorY} H ${
                inputRight + 6
              } V ${layout.input.distributionY} H ${busLeft}`}
              fill="none"
              stroke={INK}
              strokeWidth={0.45}
            />
            {layout.buses.map((bus) => (
              <g key={bus.key}>
                <line
                  x1={bus.x}
                  y1={layout.input.distributionY}
                  x2={bus.x}
                  y2={layout.busBottom}
                  stroke={bus.color}
                  strokeWidth={0.7}
                />
                <text
                  x={bus.x}
                  y={layout.busBottom + 3.4}
                  textAnchor="middle"
                  fontSize={2}
                  fontWeight={700}
                  fill={bus.color}
                >
                  {bus.label}
                </text>
              </g>
            ))}

            {/* Заголовок группы линий */}
            <text x={76} y={43} fontSize={2.2} fontWeight={700} fill={INK}>
              Групповые линии
            </text>
            <line
              x1={76}
              y1={44.4}
              x2={layout.frame.x + layout.frame.width}
              y2={44.4}
              stroke="#cbd5e1"
              strokeWidth={0.25}
            />

            {layout.groups.length === 0 && (
              <text
                x={(layout.frame.x + layout.frame.width) / 2}
                y={layout.groupArea.y + layout.groupArea.height / 2}
                textAnchor="middle"
                fontSize={3}
                fill={FAINT}
              >
                Групповые линии не заданы
              </text>
            )}
            {layout.groups.map((item) => (
              <GroupRow
                key={item.group.lineId}
                item={item}
                pitch={layout.groupPitch}
              />
            ))}

            {/* Статус проверки */}
            <g>
              <rect
                x={layout.statusBox.rect.x}
                y={layout.statusBox.rect.y}
                width={layout.statusBox.rect.width}
                height={layout.statusBox.rect.height}
                rx={1.2}
                fill={tones.fill}
                stroke={tones.stroke}
                strokeWidth={0.35}
              />
              <text
                x={layout.statusBox.rect.x + layout.statusBox.rect.width / 2}
                y={layout.statusBox.rect.y + 5}
                textAnchor="middle"
                fontSize={1.9}
                fill={MUTED}
              >
                {layout.statusBox.title}
              </text>
              <text
                x={layout.statusBox.rect.x + layout.statusBox.rect.width / 2}
                y={layout.statusBox.rect.y + 11.4}
                textAnchor="middle"
                fontSize={3.1}
                fontWeight={700}
                fill={tones.text}
              >
                {layout.statusBox.text}
              </text>
              <text
                x={layout.statusBox.rect.x + layout.statusBox.rect.width / 2}
                y={layout.statusBox.rect.y + 16.6}
                textAnchor="middle"
                fontSize={1.7}
                fill={MUTED}
              >
                ПУЭ-7 · СП 256
              </text>
            </g>

            {/* Примечания */}
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
              Примечания
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
                fontSize={1.95}
                fill={INK}
              >
                {line}
              </text>
            ))}

            {/* Основная надпись — ГОСТ 2.104-2006, форма 1 */}
            <TitleBlock block={layout.titleBlock} />
          </svg>
        </div>
      </div>
    </div>,
    document.body
  );
};

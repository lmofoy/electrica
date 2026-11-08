import type { ElectricalPanel } from '../../types';

// Устойчивая палитра для линий на плане и в списках.
export const LINE_COLORS = [
  '#38bdf8',
  '#f59e0b',
  '#a78bfa',
  '#34d399',
  '#fb7185',
  '#22d3ee',
  '#facc15',
  '#f472b6',
  '#4ade80',
  '#c084fc',
  '#f97316',
  '#e879f9',
] as const;

export function lineColorFor(index: number): string {
  return LINE_COLORS[index % LINE_COLORS.length];
}

export function buildLineColorMap(
  panel: ElectricalPanel | null
): Map<string, string> {
  const map = new Map<string, string>();
  panel?.lines.forEach((line, index) => {
    map.set(line.id, lineColorFor(index));
  });
  return map;
}

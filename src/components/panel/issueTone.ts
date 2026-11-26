import type { NormativeSeverity } from '../../core/electrical/panelValidation';

// Ошибки — красным, замечания — янтарным, подсказки — серым.
// Общие цвета для блока замечаний на листах и номерных маркеров на схеме.
export const ISSUE_TONE: Record<
  NormativeSeverity,
  { stroke: string; fill: string; text: string }
> = {
  error: { stroke: '#b91c1c', fill: '#fef2f2', text: '#991b1b' },
  warning: { stroke: '#b45309', fill: '#fffbeb', text: '#92400e' },
  info: { stroke: '#475569', fill: '#f1f5f9', text: '#334155' },
};

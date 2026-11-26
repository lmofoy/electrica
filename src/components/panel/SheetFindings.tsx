import React, { useMemo } from 'react';
import type { SheetIssue } from '../../core/electrical/sheetIssues';
import {
  ISSUE_SEVERITY_LABEL,
  issueLineCount,
  paginateIssues,
  wrapIssueText,
} from '../../core/electrical/sheetIssues';
import {
  A3_HEIGHT_MM,
  A3_WIDTH_MM,
  SHEET_FRAME,
} from '../../core/electrical/sheetLayout';
import { ISSUE_TONE } from './issueTone';

const INK = '#0f172a';
const MUTED = '#475569';
const FAINT = '#94a3b8';

const FONT_MM = 2.6;
const LINE_H_MM = 4.3;
const MAX_CHARS = 150;
const CONTENT_TOP = 24;
const CONTENT_BOTTOM = 282;
const MAX_LINES = Math.floor((CONTENT_BOTTOM - CONTENT_TOP) / LINE_H_MM);
const TEXT_X = 35;
const BADGE_X = 27;

interface SheetFindingsProps {
  issues: SheetIssue[];
  zoom: number;
  pxPerMm?: number;
  panelName?: string;
  title?: string;
}

// Печатные страницы «Замечания и ошибки»: полный текст ошибок и
// замечаний числами, теми же, что маркеры на схеме ЭС-01. При
// переполнении список продолжается на следующих листах.
export const SheetFindings: React.FC<SheetFindingsProps> = ({
  issues,
  zoom,
  pxPerMm = 4,
  panelName,
  title = 'Замечания и ошибки',
}) => {
  const pages = useMemo(
    () => paginateIssues(issues, MAX_CHARS, MAX_LINES),
    [issues]
  );

  if (issues.length === 0) return null;

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <>
      {pages.map((page, pageIndex) => {
        let cursor = CONTENT_TOP + 10;
        const pageTitle =
          pageIndex === 0 ? title : `Продолжение замечаний (${pageIndex + 1})`;
        return (
          <div
            key={`findings-${pageIndex}`}
            className="sheet-print-page shrink-0 bg-white shadow-2xl ring-1 ring-slate-700"
            style={{
              width: A3_WIDTH_MM * pxPerMm * zoom,
              height: A3_HEIGHT_MM * pxPerMm * zoom,
            }}
          >
            <svg
              viewBox={`0 0 ${A3_WIDTH_MM} ${A3_HEIGHT_MM}`}
              width="100%"
              height="100%"
              style={{
                display: 'block',
                fontFamily: '"Inter", "Segoe UI", Arial, sans-serif',
              }}
            >
              <rect x={0} y={0} width={A3_WIDTH_MM} height={A3_HEIGHT_MM} fill="#ffffff" />
              <rect
                x={SHEET_FRAME.x}
                y={SHEET_FRAME.y}
                width={SHEET_FRAME.width}
                height={SHEET_FRAME.height}
                fill="none"
                stroke={INK}
                strokeWidth={0.7}
              />

              <text x={SHEET_FRAME.x + 2} y={15} fontSize={5} fontWeight={700} fill={INK}>
                {pageTitle}
              </text>
              <text x={SHEET_FRAME.x + 2} y={20.2} fontSize={2.3} fill={MUTED}>
                {panelName ? `${panelName} · ` : ''}Ошибок: {errors} · Замечаний:{' '}
                {warnings} · всего записей: {issues.length}
              </text>
              <line
                x1={SHEET_FRAME.x}
                y1={22.4}
                x2={SHEET_FRAME.x + SHEET_FRAME.width}
                y2={22.4}
                stroke="#cbd5e1"
                strokeWidth={0.25}
              />

              {page.map((issue) => {
                const tone = ISSUE_TONE[issue.severity];
                const messageLines = wrapIssueText(issue.message, MAX_CHARS);
                const startY = cursor;
                const rowNodes: React.ReactNode[] = [];
                messageLines.forEach((line, lineIndex) => {
                  const y = startY + lineIndex * LINE_H_MM;
                  if (lineIndex === 0) {
                    rowNodes.push(
                      <text key={`m-${issue.number}-${lineIndex}`} x={TEXT_X} y={y} fontSize={FONT_MM} fill={INK}>
                        <tspan fontWeight={700} fill={tone.text}>
                          {`${issue.number}. ${ISSUE_SEVERITY_LABEL[issue.severity]}. `}
                        </tspan>
                        <tspan>{line}</tspan>
                      </text>
                    );
                  } else {
                    rowNodes.push(
                      <text key={`m-${issue.number}-${lineIndex}`} x={TEXT_X} y={y} fontSize={FONT_MM} fill={INK}>
                        {line}
                      </text>
                    );
                  }
                });
                let after = startY + messageLines.length * LINE_H_MM;
                if (issue.reference) {
                  rowNodes.push(
                    <text key={`ref-${issue.number}`} x={TEXT_X} y={after} fontSize={2.1} fill={MUTED}>
                      {`Норматив: ${issue.reference}`}
                    </text>
                  );
                  after += LINE_H_MM;
                }
                cursor = startY + issueLineCount(issue, MAX_CHARS) * LINE_H_MM;

                return (
                  <g key={`issue-${issue.number}`}>
                    <circle
                      cx={BADGE_X}
                      cy={startY - 1.1}
                      r={3}
                      fill={tone.fill}
                      stroke={tone.stroke}
                      strokeWidth={0.4}
                    />
                    <text
                      x={BADGE_X}
                      y={startY + 0.1}
                      textAnchor="middle"
                      fontSize={2.6}
                      fontWeight={700}
                      fill={tone.text}
                    >
                      {issue.number}
                    </text>
                    {rowNodes}
                  </g>
                );
              })}

              <text
                x={SHEET_FRAME.x + 2}
                y={SHEET_FRAME.y + SHEET_FRAME.height - 2.4}
                fontSize={2}
                fill={FAINT}
              >
                ЭС-01 · {panelName ?? 'щит'} · лист {pageIndex + 2} из {pages.length + 1} ·
                ошибки — красным, замечания — янтарным; номера совпадают с маркерами на схеме.
              </text>
            </svg>
          </div>
        );
      })}
    </>
  );
};

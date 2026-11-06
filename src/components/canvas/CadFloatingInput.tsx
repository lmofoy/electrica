import React, { useRef, useEffect } from 'react';
import type { Point2D, DynamicInputState } from '../../types';
import { distance, angleDeg, polarToPoint, snapAngle } from '../../core/geometry/math';

interface CadFloatingInputProps {
  lastVertex: Point2D | null;
  cursorPosMm: Point2D;
  stagePos: Point2D;
  zoom: number;
  dynamicInput: DynamicInputState;
  onCommitVertex: (vertex: Point2D) => void;
  onUpdateInput: (updates: Partial<DynamicInputState>) => void;
  onUnlock: () => void;
}

export const CadFloatingInput: React.FC<CadFloatingInputProps> = ({
  lastVertex,
  cursorPosMm,
  stagePos,
  zoom,
  dynamicInput,
  onCommitVertex,
  onUpdateInput,
  onUnlock,
}) => {
  const lengthInputRef = useRef<HTMLInputElement>(null);
  const angleInputRef = useRef<HTMLInputElement>(null);

  if (!lastVertex) return null;

  // Экранные координаты курсора
  const screenX = cursorPosMm.x * zoom + stagePos.x;
  const screenY = cursorPosMm.y * zoom + stagePos.y;

  // Текущая длина и угол
  const currentDist = Math.round(distance(lastVertex, cursorPosMm));
  const currentAngle = Math.round(snapAngle(angleDeg(lastVertex, cursorPosMm), 6));

  // Автофокус при переключении шагов
  useEffect(() => {
    if (dynamicInput.step === 'length' && lengthInputRef.current) {
      lengthInputRef.current.focus();
      lengthInputRef.current.select();
    } else if (dynamicInput.step === 'angle' && angleInputRef.current) {
      angleInputRef.current.focus();
      angleInputRef.current.select();
    }
  }, [dynamicInput.step]);

  const handleLengthKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = parseFloat(dynamicInput.currentLengthInput || currentDist.toString());
      if (!isNaN(val) && val > 0) {
        onUpdateInput({
          lockedLength: val,
          step: 'angle',
          currentAngleInput: currentAngle.toString(),
        });
      }
    } else if (e.key === 'Escape') {
      onUnlock();
    }
  };

  const handleAngleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const angleVal = parseFloat(dynamicInput.currentAngleInput || currentAngle.toString());
      const lengthVal = dynamicInput.lockedLength ?? currentDist;

      if (!isNaN(angleVal) && lengthVal > 0) {
        // Вычисляем финальную точную вершину
        const finalVertex = polarToPoint(lastVertex, lengthVal, angleVal);
        onCommitVertex(finalVertex);
      }
    } else if (e.key === 'Escape') {
      onUnlock();
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: Math.min(window.innerWidth - 260, Math.max(20, screenX + 25)),
        top: Math.min(window.innerHeight - 100, Math.max(70, screenY - 50)),
        zIndex: 50,
      }}
      className="pointer-events-auto bg-slate-900/95 border border-slate-700/80 rounded-lg p-2.5 shadow-2xl backdrop-blur-md text-xs font-mono select-none"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
        <span className="text-slate-300 font-semibold tracking-wide uppercase text-[10px]">
          Точный ввод (CAD)
        </span>
        {dynamicInput.lockedLength && (
          <span className="bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded text-[10px]">
            L зафиксирована
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Поле Длина */}
        <div>
          <label className="text-[10px] text-slate-400 block mb-0.5">Длина (мм):</label>
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-1.5 py-1 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500">
            <input
              ref={lengthInputRef}
              type="number"
              placeholder={currentDist.toString()}
              value={dynamicInput.currentLengthInput}
              onChange={(e) => onUpdateInput({ currentLengthInput: e.target.value })}
              onKeyDown={handleLengthKeyDown}
              className="w-full bg-transparent text-amber-300 font-bold focus:outline-none text-xs"
            />
          </div>
        </div>

        {/* Поле Угол */}
        <div>
          <label className="text-[10px] text-slate-400 block mb-0.5">Угол (°):</label>
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded px-1.5 py-1 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500">
            <input
              ref={angleInputRef}
              type="number"
              placeholder={currentAngle.toString()}
              value={dynamicInput.currentAngleInput}
              onChange={(e) => onUpdateInput({ currentAngleInput: e.target.value })}
              onKeyDown={handleAngleKeyDown}
              className="w-full bg-transparent text-emerald-400 font-bold focus:outline-none text-xs"
            />
          </div>
        </div>
      </div>

      <div className="mt-2 text-[10px] text-slate-400 border-t border-slate-800 pt-1 flex items-center justify-between">
        <span>
          {dynamicInput.step === 'none' && (
            <>
              Нажмите <kbd className="bg-slate-800 px-1 rounded text-sky-300">Tab</kbd> для ввода
            </>
          )}
          {dynamicInput.step === 'length' && (
            <>
              Нажмите <kbd className="bg-slate-800 px-1 rounded text-sky-300">Enter</kbd> (фикс. длины)
            </>
          )}
          {dynamicInput.step === 'angle' && (
            <>
              <kbd className="bg-slate-800 px-1 rounded text-emerald-400">Enter</kbd> (построить)
            </>
          )}
        </span>
        <button
          onClick={onUnlock}
          className="text-slate-500 hover:text-slate-300 text-[10px]"
          title="Сбросить фиксацию (Esc)"
        >
          Сброс (Esc)
        </button>
      </div>
    </div>
  );
};

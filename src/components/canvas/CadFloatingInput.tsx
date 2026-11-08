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

  // Автофокус при открытии — хук обязан вызываться до любого return
  useEffect(() => {
    if (dynamicInput.step === 'length' && lengthInputRef.current) {
      lengthInputRef.current.focus();
      lengthInputRef.current.select();
    } else if (dynamicInput.step === 'angle' && angleInputRef.current) {
      angleInputRef.current.focus();
      angleInputRef.current.select();
    }
  }, [dynamicInput.step, dynamicInput.isOpen]);

  // Важно: окно отображается ТОЛЬКО если пользователь нажал Tab (dynamicInput.isOpen)
  if (!lastVertex || !dynamicInput.isOpen) return null;

  // Экранные координаты курсора
  const screenX = cursorPosMm.x * zoom + stagePos.x;
  const screenY = cursorPosMm.y * zoom + stagePos.y;

  // Дистанция с шагом 100 мм по умолчанию
  const rawDist = distance(lastVertex, cursorPosMm);
  const currentSteppedDist = Math.max(100, Math.round(rawDist / 100) * 100);
  const currentAngle = Math.round(snapAngle(angleDeg(lastVertex, cursorPosMm), 6));

  const handleLengthKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = parseFloat(dynamicInput.currentLengthInput || currentSteppedDist.toString());
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
      const lengthVal = dynamicInput.lockedLength ?? currentSteppedDist;

      if (!isNaN(angleVal) && lengthVal > 0) {
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
        left: Math.min(window.innerWidth - 270, Math.max(20, screenX + 30)),
        top: Math.min(window.innerHeight - 120, Math.max(70, screenY - 50)),
        zIndex: 50,
      }}
      className="pointer-events-auto bg-slate-900/95 border border-sky-500/80 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs font-mono select-none animate-fadeIn ring-2 ring-sky-500/20"
    >
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-slate-800">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
        <span className="text-white font-bold tracking-wide uppercase text-[10px]">
          Точный ввод (CAD)
        </span>
        {dynamicInput.lockedLength && (
          <span className="bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded text-[10px] ml-auto">
            {dynamicInput.lockedLength} мм
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {/* Поле: Длина (шаг 100 мм) */}
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Длина (мм):</label>
          <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500">
            <input
              ref={lengthInputRef}
              type="number"
              step="100"
              placeholder={currentSteppedDist.toString()}
              value={dynamicInput.currentLengthInput}
              onChange={(e) => onUpdateInput({ currentLengthInput: e.target.value })}
              onKeyDown={handleLengthKeyDown}
              className="w-full bg-transparent text-amber-300 font-bold focus:outline-none text-xs"
            />
          </div>
        </div>

        {/* Поле: Угол */}
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Угол (°):</label>
          <div className="flex items-center bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500">
            <input
              ref={angleInputRef}
              type="number"
              step="15"
              placeholder={currentAngle.toString()}
              value={dynamicInput.currentAngleInput}
              onChange={(e) => onUpdateInput({ currentAngleInput: e.target.value })}
              onKeyDown={handleAngleKeyDown}
              className="w-full bg-transparent text-emerald-400 font-bold focus:outline-none text-xs"
            />
          </div>
        </div>
      </div>

      <div className="mt-2.5 text-[10px] text-slate-400 pt-1.5 border-t border-slate-800 flex items-center justify-between">
        <span>
          {dynamicInput.step === 'length' && (
            <>
              <kbd className="bg-slate-800 text-sky-300 px-1 rounded">Enter</kbd> фикс. длины
            </>
          )}
          {dynamicInput.step === 'angle' && (
            <>
              <kbd className="bg-slate-800 text-emerald-400 px-1 rounded">Enter</kbd> построить
            </>
          )}
        </span>
        <button
          onClick={onUnlock}
          className="text-slate-500 hover:text-slate-300 transition text-[10px]"
          title="Сбросить окно ввода"
        >
          Закрыть (Esc)
        </button>
      </div>
    </div>
  );
};

import React from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { X, Sliders } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { settings, setSettings } = useProjectStore();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sliders size={18} className="text-sky-400" />
            <h2 className="font-bold text-sm text-white">Параметры проекта (230 В)</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Высота потолка */}
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Высота чистого потолка (мм):
            </label>
            <input
              type="number"
              value={settings.ceilingHeightMm}
              onChange={(e) => setSettings({ ceilingHeightMm: Number(e.target.value) || 2700 })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Используется для автоматического расчета вертикальных спусков и подъемов кабеля.
            </p>
          </div>

          {/* Запас кабеля */}
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Запас кабеля на разделку и монтаж (%):
            </label>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {[10, 15, 20, 25].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSettings({ cableMarginPercent: val })}
                  className={`py-1.5 rounded-lg border font-mono font-medium transition ${
                    settings.cableMarginPercent === val
                      ? 'bg-sky-500 border-sky-400 text-white shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  +{val}%
                </button>
              ))}
            </div>
            <input
              type="number"
              value={settings.cableMarginPercent}
              onChange={(e) => setSettings({ cableMarginPercent: Number(e.target.value) || 15 })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Прокладка по умолчанию */}
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Основной способ прокладки трасс:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSettings({ defaultRouting: 'ceiling' })}
                className={`p-2.5 rounded-lg border text-left transition ${
                  settings.defaultRouting === 'ceiling'
                    ? 'bg-sky-500/10 border-sky-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <div className="font-semibold text-sky-400">По потолку</div>
                <div className="text-[10px] text-slate-400 mt-0.5">В гофре со спусками</div>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ defaultRouting: 'floor' })}
                className={`p-2.5 rounded-lg border text-left transition ${
                  settings.defaultRouting === 'floor'
                    ? 'bg-sky-500/10 border-sky-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <div className="font-semibold text-emerald-400">По полу</div>
                <div className="text-[10px] text-slate-400 mt-0.5">В стяжке с подъемами</div>
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white font-medium rounded-lg transition"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};

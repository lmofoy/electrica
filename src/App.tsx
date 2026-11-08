import React, { useState } from 'react';
import { Toolbar } from './components/toolbar/Toolbar';
import { CADCanvas } from './components/canvas/CADCanvas';
import { Sidebar } from './components/sidebar/Sidebar';
import { SettingsModal } from './components/sidebar/SettingsModal';
import { ToastProvider } from './components/ToastProvider';
import { PanelScreen } from './components/panel/PanelScreen';
import { useProjectStore } from './store/useProjectStore';

export const App: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const activeView = useProjectStore((state) => state.activeView);
  const panel = useProjectStore((state) => state.panel);
  const isPanelView = activeView === 'panel' && panel !== null;

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      <ToastProvider />
      {/* Верхняя инженерная панель */}
      <Toolbar onOpenSettings={() => setIsSettingsOpen(true)} />

      {isPanelView ? (
        <PanelScreen />
      ) : (
        /* Рабочая область: холст CAD + боковая панель проекта */
        <div className="flex flex-1 w-full h-[calc(100vh-3.5rem)] overflow-hidden relative">
          <main className="flex-1 h-full relative overflow-hidden">
            <CADCanvas />
          </main>
          <Sidebar />
        </div>
      )}

      {/* Модальное окно настроек проекта */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
};

export default App;

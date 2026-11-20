import React, { useState } from 'react';
import { Toolbar } from './components/toolbar/Toolbar';
import { StepRail } from './components/toolbar/StepRail';
import { CADCanvas } from './components/canvas/CADCanvas';
import { Sidebar } from './components/sidebar/Sidebar';
import { SettingsModal } from './components/sidebar/SettingsModal';
import { ToastProvider } from './components/ToastProvider';
import { PanelScreen } from './components/panel/PanelScreen';
import { DocsPanel } from './components/docs/DocsPanel';
import { StatusBar } from './components/status/StatusBar';
import { useProjectStore } from './store/useProjectStore';

export const App: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const activeStep = useProjectStore((state) => state.activeStep);

  const inspector = (() => {
    switch (activeStep) {
      case 'plan':
        return <Sidebar />;
      case 'lines':
        return <PanelScreen />;
      case 'docs':
        return <DocsPanel />;
    }
  })();

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      <ToastProvider />
      {/* Верхняя инженерная панель со степпером */}
      <Toolbar onOpenSettings={() => setIsSettingsOpen(true)} />

      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Левая панель инструментов текущего шага */}
        <StepRail />

        {/* Рабочая область: холст CAD + правый инспектор шага */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <div className="flex flex-col md:flex-row flex-1 min-h-0 w-full overflow-hidden relative">
            <main className="flex-1 min-w-0 min-h-0 relative overflow-hidden">
              <CADCanvas />
            </main>
            {inspector}
          </div>
          <StatusBar />
        </div>
      </div>

      {/* Модальное окно настроек проекта */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
};

export default App;

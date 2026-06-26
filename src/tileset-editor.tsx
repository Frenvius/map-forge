import React from 'react';
import { createRoot } from 'react-dom/client';

import TilesetEditor from '~/components/TilesetEditor';
import { AssetsProvider } from '~/usecase/context/AssetsContext';
import { TooltipProvider } from '~/components/commons/ui/tooltip';

import './styles/index.css';

const Root = () => (
  <AssetsProvider>
    <TooltipProvider delayDuration={300} skipDelayDuration={150}>
      <TilesetEditor />
    </TooltipProvider>
  </AssetsProvider>
);

if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(<Root />);

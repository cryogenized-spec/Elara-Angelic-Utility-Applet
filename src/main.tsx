import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { FolderProvider } from './app/folders/FolderProvider';
import { PlaybackProvider } from './media/playback/PlaybackProvider';
import { installMediaPlayerSurfacePresetBinding } from './media/playback/surface-preset';
import { runStartupMediaRetentionMaintenance } from './media/retention';
import './app/app.css';

void runStartupMediaRetentionMaintenance();
installMediaPlayerSurfacePresetBinding();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlaybackProvider>
      <FolderProvider>
        <App />
      </FolderProvider>
    </PlaybackProvider>
  </StrictMode>,
);

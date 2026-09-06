import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { FolderProvider } from './app/folders/FolderProvider';
import './app/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FolderProvider>
      <App />
    </FolderProvider>
  </StrictMode>,
);
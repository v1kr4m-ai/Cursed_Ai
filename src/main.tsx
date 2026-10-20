import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { installThemes } from './lib/themes';
import { applyUiSize, savedUiSize } from './components/tools/AppearanceSettings';

applyUiSize(savedUiSize());
installThemes();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
);

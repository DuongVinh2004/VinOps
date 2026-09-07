import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { readPublicConfig } from './config.js';
import { ErrorBoundary } from './error-boundary.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('VinOps web root element is missing');
}

const config = readPublicConfig(import.meta.env);

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App config={config} />
    </ErrorBoundary>
  </StrictMode>,
);

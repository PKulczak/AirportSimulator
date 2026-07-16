import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PrimeReactProvider } from 'primereact/api';
import './index.css';
import App from './App.tsx';
import { RunwayProvider } from './context/RunwayContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrimeReactProvider>
      <RunwayProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RunwayProvider>
    </PrimeReactProvider>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PrimeReactProvider } from 'primereact/api';
import './index.css';
import App from './App.tsx';
import { RunwayProvider } from './context/RunwayContext.tsx';
import { AuthProvider } from './context/AuthContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrimeReactProvider>
      <RunwayProvider>
        {/* AuthProvider needs router context (it navigates to /login on a
         * 401), so it sits inside BrowserRouter, not alongside RunwayProvider. */}
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </RunwayProvider>
    </PrimeReactProvider>
  </StrictMode>,
);

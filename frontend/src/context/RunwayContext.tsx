import { createContext, useContext, type ReactNode } from 'react';
import { useGet } from '../functions/axios';
import type { ApiError } from '../types/axios';
import type { Runway } from '../types/runway';

interface RunwayContextValue {
  runways: Runway[];
  loading: boolean;
  error: ApiError | null;
}

const RunwayContext = createContext<RunwayContextValue | undefined>(undefined);

/** Fetches the master runway list once at app root and exposes it app-wide. */
export function RunwayProvider({ children }: { children: ReactNode }) {
  const { data, loading, error } = useGet<Runway[]>('/api/runways/');

  return (
    <RunwayContext.Provider value={{ runways: data ?? [], loading, error }}>
      {children}
    </RunwayContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- intentional: hook co-located with its provider.
export function useRunways(): RunwayContextValue {
  const ctx = useContext(RunwayContext);
  if (!ctx) {
    throw new Error('useRunways must be used within a RunwayProvider');
  }
  return ctx;
}

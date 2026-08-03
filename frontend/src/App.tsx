import { Route, Routes } from 'react-router-dom';
import MainLayout from './components/MainLayout';
import SimulationHistory from './components/SimulationHistory';
import MetricBasePage from './components/MetricBasePage';
import SimulationVisualisation from './components/SimulationVisualisation';
import SimulationPrintSummary from './components/SimulationPrintSummary';
import CompareRuns from './components/CompareRuns';
import SweepResults from './components/SweepResults';
import LoginPage from './components/LoginPage';
import PageNotFound from './components/PageNotFound';

function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<SimulationHistory />} />
        <Route path="/simulation/:id/detail" element={<MetricBasePage />} />
        <Route
          path="/simulation/:id/visualisation"
          element={<SimulationVisualisation />}
        />
        <Route path="/simulation/:id/print" element={<SimulationPrintSummary />} />
        {/* Slice 10.1 — read-only share links: same components as above,
         * driven by a token instead of an id (see each component's
         * `isShared`/`token` handling). */}
        <Route path="/shared/:token/detail" element={<MetricBasePage />} />
        <Route
          path="/shared/:token/visualisation"
          element={<SimulationVisualisation />}
        />
        <Route path="/shared/:token/print" element={<SimulationPrintSummary />} />
        <Route path="/compare" element={<CompareRuns />} />
        <Route path="/shared/compare/:token" element={<CompareRuns />} />
        <Route path="/batch/:batchId" element={<SweepResults />} />
        <Route path="/shared/batch/:token" element={<SweepResults />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
}

export default App;

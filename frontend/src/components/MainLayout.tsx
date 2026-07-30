import { Outlet } from 'react-router-dom';

export default function MainLayout() {
  return (
    <div className="h-screen overflow-hidden flex flex-col bg-brand-page text-black print:h-auto print:overflow-visible">
      {/* `min-h-0` lets this shrink to its flex-allocated share instead of
       * growing with content (the flexbox default `min-height: auto` would
       * otherwise force the whole page taller than the viewport); any page
       * whose content doesn't fit scrolls here instead of the window. The
       * `print:` overrides on both this div and `<main>` below undo that
       * clipping when printing (e.g. SimulationPrintSummary) — a browser
       * only prints what's visible inside an `overflow: hidden`/`auto`
       * container's current scroll position, not the full scrollable
       * content, so without these only one screen's worth of the page would
       * ever reach the printed output/PDF. */}
      <main className="flex-1 min-h-0 overflow-y-auto p-6 print:h-auto print:overflow-visible print:p-0">
        <Outlet />
      </main>
    </div>
  );
}

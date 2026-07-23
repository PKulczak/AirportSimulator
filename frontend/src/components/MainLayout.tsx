import { Outlet } from 'react-router-dom';

export default function MainLayout() {
  return (
    <div className="h-screen overflow-hidden flex flex-col bg-brand-page text-black">
      {/* `min-h-0` lets this shrink to its flex-allocated share instead of
       * growing with content (the flexbox default `min-height: auto` would
       * otherwise force the whole page taller than the viewport); any page
       * whose content doesn't fit scrolls here instead of the window. */}
      <main className="flex-1 min-h-0 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

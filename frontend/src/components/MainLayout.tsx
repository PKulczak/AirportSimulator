import { Link, Outlet } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlaneUp } from '@fortawesome/free-solid-svg-icons';

export default function MainLayout() {
  return (
    <div className="h-screen overflow-hidden flex flex-col bg-brand-page text-black">
      <header className="bg-brand-accent text-black px-6 py-4 flex items-center gap-3 shadow">
        <FontAwesomeIcon icon={faPlaneUp} className="text-xl" />
        <Link to="/" className="text-lg font-semibold text-black no-underline">
          Airport Modelling Group 2
        </Link>
      </header>
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

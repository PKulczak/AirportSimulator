import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function MainLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-brand-page text-black print:h-auto print:overflow-visible">
      {/* Only rendered once someone has actually logged in — REQUIRE_AUTH is
       * off by default, so most usage never sets `user` and this bar simply
       * doesn't exist, leaving every other page pixel-identical to before
       * Slice 9.1. */}
      {user && (
        <div className="flex items-center justify-end gap-3 border-b border-slate-200 bg-brand-bg px-4 py-1.5 text-sm text-slate-600 print:hidden">
          <span>
            Logged in as <span className="font-semibold">{user.username}</span>
          </span>
          <button
            type="button"
            onClick={logout}
            className="cursor-pointer font-semibold text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
          >
            Log out
          </button>
        </div>
      )}
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

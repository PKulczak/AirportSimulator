import { Link, Outlet } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlaneUp } from '@fortawesome/free-solid-svg-icons';

export default function MainLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-brand-page text-black">
      <header className="bg-brand-accent text-black px-6 py-4 flex items-center gap-3 shadow">
        <FontAwesomeIcon icon={faPlaneUp} className="text-xl" />
        <Link to="/" className="text-lg font-semibold text-black no-underline">
          Airport Modelling Group 2
        </Link>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

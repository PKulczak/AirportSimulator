import { Link } from 'react-router-dom';

export default function PageNotFound() {
  return (
    <div className="flex justify-center py-24">
      <div className="rounded-lg border border-slate-200 bg-brand-bg p-8 flex flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold text-slate-800">Page not found</h1>
        <p className="text-slate-500">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link
          to="/"
          className="text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
        >
          Back to simulation history
        </Link>
      </div>
    </div>
  );
}

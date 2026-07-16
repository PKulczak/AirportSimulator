import { Link } from 'react-router-dom';

export default function PageNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-slate-800">Page not found</h1>
      <p className="text-slate-500">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link to="/" className="text-blue-600 hover:underline">
        Back to simulation history
      </Link>
    </div>
  );
}

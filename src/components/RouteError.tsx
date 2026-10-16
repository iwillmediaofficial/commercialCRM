import { Link, isRouteErrorResponse, useRouteError } from "react-router";

// Shown instead of a blank crash page when a screen fails.
export default function RouteError() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md space-y-3 rounded-lg bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="text-sm text-slate-600">Your data is safe. Go back and try again; if it keeps happening, send this message to support:</p>
        <pre className="whitespace-pre-wrap rounded bg-slate-100 p-2 text-left text-xs text-slate-700">{detail}</pre>
        <Link className="text-sm text-indigo-600" to="/">Back to start</Link>
      </div>
    </div>
  );
}

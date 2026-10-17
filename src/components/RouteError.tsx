import { useEffect } from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { reportError } from "../lib/errors";

// Shown instead of a blank crash page when a screen fails.
export default function RouteError() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  useEffect(() => {
    // After a new deploy, an open tab may ask for page files that no longer
    // exist. Reload once to pick up the new version instead of showing an error.
    if (/dynamically imported module|Importing a module script failed/i.test(detail)) {
      try {
        if (!sessionStorage.getItem("reloaded-for-update")) {
          sessionStorage.setItem("reloaded-for-update", "1");
          window.location.reload();
          return;
        }
      } catch {
        /* storage blocked: fall through and show the error */
      }
    }
    // A missing page (404) isn't a crash; report everything else.
    if (isRouteErrorResponse(error) && error.status === 404) return;
    reportError(error);
  }, [error, detail]);
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

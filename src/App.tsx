import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth";
import { Spinner } from "./components/ui";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import Reset from "./pages/auth/Reset";
import Home from "./pages/Home";
import RouteError from "./components/RouteError";

// Pages load on demand so the first visit downloads only what it shows.
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const Companies = lazy(() => import("./pages/admin/Companies"));
const Renewals = lazy(() => import("./pages/admin/Renewals"));
const Plans = lazy(() => import("./pages/admin/Plans"));
const Payments = lazy(() => import("./pages/admin/Payments"));
const AuditLog = lazy(() => import("./pages/admin/AuditLog"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));
const WorkspaceLayout = lazy(() => import("./pages/workspace/WorkspaceLayout"));
const Dashboard = lazy(() => import("./pages/workspace/Dashboard"));
const Team = lazy(() => import("./pages/workspace/Team"));
const Billing = lazy(() => import("./pages/workspace/Billing"));
const Leads = lazy(() => import("./pages/workspace/leads/Leads"));
const LeadForms = lazy(() => import("./pages/workspace/leads/LeadForms"));
const Clients = lazy(() => import("./pages/workspace/clients/Clients"));
const Work = lazy(() => import("./pages/workspace/work/Work"));
const Timesheets = lazy(() => import("./pages/workspace/time/Timesheets"));
const Invoices = lazy(() => import("./pages/workspace/invoices/Invoices"));
const Recurring = lazy(() => import("./pages/workspace/invoices/Recurring"));
const BillingCalendar = lazy(() => import("./pages/workspace/invoices/Calendar"));
const AdFunds = lazy(() => import("./pages/workspace/adfunds/AdFunds"));
const WorkspaceSettings = lazy(() => import("./pages/workspace/settings/Settings"));
const PublicForm = lazy(() => import("./pages/PublicForm"));
const Landing = lazy(() => import("./pages/public/Landing"));
const Terms = lazy(() => import("./pages/public/Terms"));
const Privacy = lazy(() => import("./pages/public/Privacy"));
const SubscriptionInvoice = lazy(() => import("./pages/SubscriptionInvoice"));
const Errors = lazy(() => import("./pages/admin/Errors"));

// Signed-in people go to their company; visitors see the landing page.
function Root() {
  const { loading, session } = useAuth();
  if (loading) return <Spinner />;
  return session ? <Home /> : <Landing />;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/signup", element: <Signup /> },
      { path: "/reset", element: <Reset /> },
      { path: "/f/:slug", element: <PublicForm /> },
      { path: "/form/:slug", element: <PublicForm /> },
      { path: "/terms", element: <Terms /> },
      { path: "/privacy", element: <Privacy /> },
      { path: "/", element: <Root /> },
      { path: "/invoice/subscription/:id", element: <RequireAuth><SubscriptionInvoice /></RequireAuth> },
      {
        path: "/admin",
        element: <RequireAuth><AdminLayout /></RequireAuth>,
        children: [
          { index: true, element: <Companies /> },
          { path: "renewals", element: <Renewals /> },
          { path: "payments", element: <Payments /> },
          { path: "plans", element: <Plans /> },
          { path: "audit", element: <AuditLog /> },
          { path: "settings", element: <AdminSettings /> },
          { path: "errors", element: <Errors /> },
        ],
      },
      {
        path: "/w/:slug",
        element: <RequireAuth><WorkspaceLayout /></RequireAuth>,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "leads", element: <Leads /> },
          { path: "lead-forms", element: <LeadForms /> },
          { path: "clients", element: <Clients /> },
          { path: "work", element: <Work /> },
          { path: "time", element: <Timesheets /> },
          { path: "invoices", element: <Invoices /> },
          { path: "recurring", element: <Recurring /> },
          { path: "calendar", element: <BillingCalendar /> },
          { path: "ad-funds", element: <AdFunds /> },
          { path: "settings", element: <WorkspaceSettings /> },
          { path: "team", element: <Team /> },
          { path: "billing", element: <Billing /> },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<Spinner />}>
        <RouterProvider router={router} />
      </Suspense>
    </AuthProvider>
  );
}

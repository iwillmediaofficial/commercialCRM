import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth";
import { Spinner } from "./components/ui";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import Reset from "./pages/auth/Reset";
import Home from "./pages/Home";
import AdminLayout from "./pages/admin/AdminLayout";
import Companies from "./pages/admin/Companies";
import Renewals from "./pages/admin/Renewals";
import Plans from "./pages/admin/Plans";
import Payments from "./pages/admin/Payments";
import AuditLog from "./pages/admin/AuditLog";
import AdminSettings from "./pages/admin/Settings";
import WorkspaceLayout from "./pages/workspace/WorkspaceLayout";
import Dashboard from "./pages/workspace/Dashboard";
import Team from "./pages/workspace/Team";
import Billing from "./pages/workspace/Billing";
import Leads from "./pages/workspace/leads/Leads";
import LeadForms from "./pages/workspace/leads/LeadForms";
import Clients from "./pages/workspace/clients/Clients";
import Work from "./pages/workspace/work/Work";
import Timesheets from "./pages/workspace/time/Timesheets";
import Invoices from "./pages/workspace/invoices/Invoices";
import Recurring from "./pages/workspace/invoices/Recurring";
import BillingCalendar from "./pages/workspace/invoices/Calendar";
import AdFunds from "./pages/workspace/adfunds/AdFunds";
import WorkspaceSettings from "./pages/workspace/settings/Settings";
import PublicForm from "./pages/PublicForm";
import RouteError from "./components/RouteError";

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
      { path: "/", element: <RequireAuth><Home /></RequireAuth> },
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
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

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
import WorkspaceLayout from "./pages/workspace/WorkspaceLayout";
import Dashboard from "./pages/workspace/Dashboard";
import Team from "./pages/workspace/Team";
import Billing from "./pages/workspace/Billing";
import ComingSoon from "./pages/workspace/ComingSoon";
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
      { path: "/", element: <RequireAuth><Home /></RequireAuth> },
      {
        path: "/admin",
        element: <RequireAuth><AdminLayout /></RequireAuth>,
        children: [
          { index: true, element: <Companies /> },
          { path: "renewals", element: <Renewals /> },
          { path: "plans", element: <Plans /> },
        ],
      },
      {
        path: "/w/:slug",
        element: <RequireAuth><WorkspaceLayout /></RequireAuth>,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "leads", element: <ComingSoon title="Leads" /> },
          { path: "clients", element: <ComingSoon title="Clients" /> },
          { path: "work", element: <ComingSoon title="Work" /> },
          { path: "invoices", element: <ComingSoon title="Invoices" /> },
          { path: "ad-funds", element: <ComingSoon title="Ad funds" /> },
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

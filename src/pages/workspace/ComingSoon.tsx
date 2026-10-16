import { Card } from "../../components/ui";

// Placeholder for modules that arrive in Phase 2. The database, permissions
// and plan limits for them already exist.
export default function ComingSoon({ title }: { title: string }) {
  return (
    <Card title={title}>
      <p className="text-sm text-slate-500">This screen is coming in the next phase.</p>
    </Card>
  );
}

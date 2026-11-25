// Where a lead came from: a lead link, a lead form, an Excel import, or added
// by hand. Used by the "Came from" filter on Leads and Follow-ups and by the
// small origin tag on each lead.
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export type Origin = { id: string; name: string };
export type Origins = { links: Origin[]; forms: Origin[]; imports: Origin[] };
export type OriginFields = {
  lead_link_id?: string | null;
  form_id?: string | null;
  import_id?: string | null;
  campaign_details?: string | null;
};

const EMPTY: Origins = { links: [], forms: [], imports: [] };

// Names only (the link's secret key stays admin-only), readable by every member.
export function useLeadOrigins(workspaceId: string) {
  const [origins, setOrigins] = useState<Origins>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("lead_origins", { p_workspace_id: workspaceId }).then(({ data }) => {
      if (!cancelled && data && typeof data === "object") setOrigins({ ...EMPTY, ...(data as unknown as Origins) });
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);
  return origins;
}

// Filter values: "link:<id>", "form:<id>", "import:<id>", "manual".
export function originOf(l: OriginFields): string {
  if (l.lead_link_id) return `link:${l.lead_link_id}`;
  if (l.import_id) return `import:${l.import_id}`;
  if (l.form_id) return `form:${l.form_id}`;
  return "manual";
}

export function originLabel(l: OriginFields, o: Origins): string | null {
  const find = (list: Origin[], id: string | null | undefined) => list.find((x) => x.id === id)?.name;
  if (l.lead_link_id) return `Link: ${find(o.links, l.lead_link_id) ?? "deleted link"}`;
  if (l.import_id) return `Import: ${find(o.imports, l.import_id) ?? "a file"}`;
  if (l.form_id) return `Form: ${find(o.forms, l.form_id) ?? "a form"}`;
  return null;
}

// "Sheet tab: Diwali 2026 offer 10% · Campaign: X" -> "Diwali 2026 offer 10%"
export function sheetTabOf(campaign: string | null | undefined): string | null {
  const m = /(?:^|·\s*)Sheet tab:\s*([^·]+)/.exec(campaign ?? "");
  return m ? m[1].trim() : null;
}

// Narrow a Supabase query on leads to one origin (and Sheet tab).
// deno-lint-ignore no-explicit-any
export function applyOrigin<Q extends { eq: any; is: any; ilike: any }>(qb: Q, from: string, tab: string): Q {
  if (!from) return qb;
  const [kind, id] = from.split(":");
  if (kind === "link") qb = qb.eq("lead_link_id", id);
  else if (kind === "form") qb = qb.eq("form_id", id).is("import_id", null).is("lead_link_id", null);
  else if (kind === "import") qb = qb.eq("import_id", id);
  else if (kind === "manual") qb = qb.is("lead_link_id", null).is("form_id", null).is("import_id", null);
  if (kind === "link" && tab) qb = qb.ilike("campaign_details", `%Sheet tab: ${tab.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return qb;
}

// The same test in the browser (Follow-ups keeps all its leads in memory).
export function matchesOrigin(l: OriginFields, from: string, tab: string) {
  if (!from) return true;
  if (originOf(l) !== from) return false;
  return !tab || sheetTabOf(l.campaign_details) === tab;
}

// Sheet tabs seen on a link's leads, for the second filter box.
export async function sheetTabsFor(workspaceId: string, linkId: string): Promise<string[]> {
  const { data } = await supabase
    .from("leads")
    .select("campaign_details")
    .eq("workspace_id", workspaceId)
    .eq("lead_link_id", linkId)
    .ilike("campaign_details", "%Sheet tab:%")
    .limit(2000);
  const tabs = new Set<string>();
  for (const r of data ?? []) {
    const t = sheetTabOf(r.campaign_details);
    if (t) tabs.add(t);
  }
  return [...tabs].sort((a, b) => a.localeCompare(b));
}

// "Came from" filter: a lead link, form, import or added by hand, plus the
// Google Sheet tab when a lead link is picked.
import { useEffect, useState } from "react";
import { Select } from "../../../components/ui";
import { sheetTabsFor, type Origins } from "./leadOrigins";

export default function OriginFilter({ workspaceId, origins, from, tab, onChange, className = "" }: {
  workspaceId: string;
  origins: Origins;
  from: string;
  tab: string;
  onChange: (from: string, tab: string) => void;
  className?: string;
}) {
  const [tabs, setTabs] = useState<string[]>([]);
  const linkId = from.startsWith("link:") ? from.slice(5) : "";

  useEffect(() => {
    setTabs([]);
    if (!linkId) return;
    let cancelled = false;
    sheetTabsFor(workspaceId, linkId).then((t) => !cancelled && setTabs(t));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, linkId]);

  return (
    <>
      <Select className={className} value={from} onChange={(e) => onChange(e.target.value, "")} aria-label="Came from">
        <option value="">Came from: anywhere</option>
        {origins.links.length > 0 && (
          <optgroup label="Lead links">
            {origins.links.map((o) => <option key={o.id} value={`link:${o.id}`}>{o.name}</option>)}
          </optgroup>
        )}
        {origins.forms.length > 0 && (
          <optgroup label="Lead forms">
            {origins.forms.map((o) => <option key={o.id} value={`form:${o.id}`}>{o.name}</option>)}
          </optgroup>
        )}
        {origins.imports.length > 0 && (
          <optgroup label="Excel imports">
            {origins.imports.map((o) => <option key={o.id} value={`import:${o.id}`}>{o.name}</option>)}
          </optgroup>
        )}
        <option value="manual">Added by hand</option>
      </Select>
      {linkId && (tabs.length > 0 || tab) && (
        <Select className={className} value={tab} onChange={(e) => onChange(from, e.target.value)} aria-label="Sheet tab">
          <option value="">All sheet tabs</option>
          {[...new Set([...tabs, ...(tab ? [tab] : [])])].map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      )}
    </>
  );
}

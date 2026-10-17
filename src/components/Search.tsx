import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabase";
import { useWorkspace } from "../lib/workspace";
import { Icon, type IconName } from "./icons";

type Hit = { id: string; kind: string; icon: IconName; title: string; sub: string; to: string };

// Strip characters that mean something in a PostgREST "or" filter.
const clean = (q: string) => q.replace(/[%,()*\\]/g, " ").trim();

// Search box in the top bar. Ctrl K (or ⌘K) opens it from anywhere.
export function WorkspaceSearch() {
  const { workspace, hasModule, isAdmin, role } = useWorkspace();
  const admin = isAdmin || role === null;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const base = `/w/${workspace.slug}`;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
    else {
      setQ("");
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    const term = clean(q);
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      const like = `%${term}%`;
      const ws = workspace.id;
      const [leads, clients, work, invoices] = await Promise.all([
        hasModule("leads")
          ? supabase.from("leads").select("id, name, company, phone, stage").eq("workspace_id", ws)
              .or(`name.ilike.${like},company.ilike.${like},phone.ilike.${like},email.ilike.${like}`).limit(5)
          : null,
        supabase.from("clients").select("id, company_name, contact_person, phone").eq("workspace_id", ws)
          .or(`company_name.ilike.${like},contact_person.ilike.${like},phone.ilike.${like},email.ilike.${like}`).limit(5),
        hasModule("work")
          ? supabase.from("work_items").select("id, title, status").eq("workspace_id", ws).ilike("title", like).limit(5)
          : null,
        hasModule("invoicing") && admin
          ? supabase.from("invoices").select("id, invoice_number, total, status").eq("workspace_id", ws).ilike("invoice_number", like).limit(5)
          : null,
      ]);
      if (cancelled) return;
      const list: Hit[] = [
        ...(leads?.data ?? []).map((l) => ({
          id: l.id, kind: "Lead", icon: "leads" as const, title: l.name,
          sub: [l.company, l.phone].filter(Boolean).join(" · "), to: `${base}/leads?open=${l.id}`,
        })),
        ...(clients.data ?? []).map((c) => ({
          id: c.id, kind: "Client", icon: "clients" as const, title: c.company_name,
          sub: [c.contact_person, c.phone].filter(Boolean).join(" · "), to: `${base}/clients?open=${c.id}`,
        })),
        ...(work?.data ?? []).map((w) => ({
          id: w.id, kind: "Task", icon: "work" as const, title: w.title,
          sub: w.status.replace(/_/g, " "), to: `${base}/work?open=${w.id}`,
        })),
        ...(invoices?.data ?? []).map((i) => ({
          id: i.id, kind: "Invoice", icon: "invoice" as const, title: i.invoice_number ?? "Draft invoice",
          sub: `₹${Number(i.total).toLocaleString("en-IN")} · ${i.status}`, to: `${base}/invoices?open=${i.id}`,
        })),
      ];
      setHits(list);
      setActive(0);
      setBusy(false);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, workspace.id, base, hasModule, admin]);

  function go(h: Hit | undefined) {
    if (!h) return;
    setOpen(false);
    navigate(h.to);
  }

  return (
    <>
      <button
        className="group flex w-full max-w-md items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2 text-left text-sm text-slate-400 ring-1 ring-slate-200 transition hover:bg-white hover:ring-slate-300"
        onClick={() => setOpen(true)}
      >
        <Icon name="search" className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">Search leads, clients, invoices…</span>
        <kbd className="hidden rounded-md bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 sm:block">
          {mac ? "⌘" : "Ctrl"} K
        </kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4">
              <Icon name="search" className="h-5 w-5 text-slate-400" />
              <input
                ref={input}
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
                placeholder="Search by name, company, phone or invoice number"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, hits.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") go(hits[active]);
                }}
              />
              <kbd className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">Esc</kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {clean(q).length < 2 && <li className="px-3 py-6 text-center text-sm text-slate-400">Type at least two letters.</li>}
              {clean(q).length >= 2 && !busy && hits.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-slate-400">Nothing matches “{q.trim()}”.</li>
              )}
              {hits.map((h, i) => (
                <li key={h.kind + h.id}>
                  <button
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Icon name={h.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{h.title}</span>
                      {h.sub && <span className="block truncate text-xs text-slate-500 capitalize">{h.sub}</span>}
                    </span>
                    <span className="text-[11px] font-medium text-slate-400">{h.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

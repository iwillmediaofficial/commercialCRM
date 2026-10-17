import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function Button({ className = "", variant = "primary", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-brand-gradient text-white shadow-brand hover:brightness-110",
    secondary: "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300",
    danger: "bg-white text-red-600 shadow-sm ring-1 ring-red-200 hover:bg-red-50",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass =
  "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

// Password box with an eye button to show or hide what was typed.
export function PasswordInput({ className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} className={`${inputClass} pr-10 ${className}`} {...props} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-600"
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        onClick={() => setShow(!show)}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {show && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputClass} ${className}`} {...props} />;
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "warning" | "info"; children: ReactNode }) {
  const styles = {
    error: "bg-red-50 text-red-700 ring-red-200",
    success: "bg-green-50 text-green-700 ring-green-200",
    warning: "bg-amber-50 text-amber-800 ring-amber-200",
    info: "bg-sky-50 text-sky-800 ring-sky-200",
  }[tone];
  return <div className={`rounded-lg px-3.5 py-2.5 text-sm ring-1 ${styles}`}>{children}</div>;
}

export function Spinner() {
  return <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden />
      Loading…
    </div>;
}

export function PinBox({ pin, expires }: { pin: string; expires?: string }) {
  return (
    <div className="rounded-lg bg-sidebar p-4 text-center text-white">
      <div className="font-mono text-2xl tracking-[0.3em]">{pin}</div>
      <div className="mt-1 text-xs text-slate-300">
        Shown once. Works one time{expires ? `, until ${new Date(expires).toLocaleDateString()}` : ""}.
      </div>
    </div>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} className={`${inputClass} ${className}`} {...props} />;
}

// Small coloured pill. Pass any Tailwind colour classes in `tone`.
export function Badge({ tone = "bg-slate-100 text-slate-700", children }: { tone?: string; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

// Escape closes only the top-most open Modal or Drawer.
// Each open layer pushes a stable token once; onClose lives in a ref so
// re-renders with a new inline arrow never re-order the stack.
const escapeStack: { current: () => void }[] = [];
function useEscape(onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    const token = ref;
    escapeStack.push(token);
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escapeStack.at(-1) === token) token.current();
    };
    window.addEventListener("keydown", h);
    return () => {
      window.removeEventListener("keydown", h);
      const i = escapeStack.lastIndexOf(token);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, []);
}

// Centred dialog. Render it only while open.
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`my-8 w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-lg bg-white p-5 shadow-xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Panel that slides in from the right. Render it only while open.
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside
        role="dialog"
        aria-label={title}
        className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </aside>
    </div>
  );
}

import { useState, type ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Button({ className = "", variant = "primary", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50",
    danger: "bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${styles} ${className}`}
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
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

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
    <section className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
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
  return <div className={`rounded-md px-3 py-2 text-sm ring-1 ${styles}`}>{children}</div>;
}

export function Spinner() {
  return <div className="p-8 text-center text-sm text-slate-500">Loading…</div>;
}

export function PinBox({ pin, expires }: { pin: string; expires?: string }) {
  return (
    <div className="rounded-md bg-slate-900 p-4 text-center text-white">
      <div className="font-mono text-2xl tracking-[0.3em]">{pin}</div>
      <div className="mt-1 text-xs text-slate-300">
        Shown once. Works one time{expires ? `, until ${new Date(expires).toLocaleDateString()}` : ""}.
      </div>
    </div>
  );
}

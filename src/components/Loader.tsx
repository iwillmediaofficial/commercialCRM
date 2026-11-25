import { useEffect, useState } from "react";

// The IWILLCRM check-mark symbol, drawn so it can animate. Which animation to
// use depends on the kind of wait (see the loader plan):
//   draw  - opening the app (the first-load screen in index.html uses the same art)
//   bars  - a page, list or panel is loading
//   orbit - a button is busy saving / sending
// The keyframes live in index.css (.lm-*), and stop for "reduce motion".
export type LoaderVariant = "draw" | "bars" | "orbit";

const FRAME = "M57 23H21A16 16 0 0 0 5 39V79A16 16 0 0 0 21 95H64A16 16 0 0 0 80 79V31";

export function LogoLoader({ variant = "bars", className = "h-10 w-10", tone = "brand" }: {
  variant?: LoaderVariant;
  className?: string;
  /** brand: teal + navy bars. onDark: teal + white bars. white: all white (inside a coloured button). */
  tone?: "brand" | "onDark" | "white";
}) {
  return (
    <svg viewBox="-4 -4 108 108" className={`lm lm-${variant} lm-${tone} shrink-0 ${className}`} aria-hidden>
      {variant === "orbit" && <path className="lm-trk" d={FRAME} />}
      <path className="lm-fr" pathLength={100} d={FRAME} />
      <path className="lm-ck" pathLength={100} d="M26 44 39 57 88 4" />
      <rect className="lm-br lm-b1" x="21" y="69" width="13.5" height="15" rx="2.5" />
      <rect className="lm-br lm-b2" x="39.5" y="61" width="13" height="23" rx="2.5" />
      <rect className="lm-br lm-b3" x="56.5" y="47" width="14.5" height="37" rx="2.5" />
    </svg>
  );
}

// Waits a moment before showing, so loads that finish quickly don't flicker.
export function useDelayed(ms = 200) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show;
}

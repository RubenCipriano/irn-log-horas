import type { ReactNode } from "react";

// Wrap a list of siblings so each gets a staggered fade-up animation.
// Use `step={ms}` to retune.
export function Stagger({
  children,
  step = 80,
}: {
  children: ReactNode[];
  step?: number;
}) {
  return (
    <div
      className="grid gap-6 tf-stagger"
      style={{ ["--tf-stagger-step" as string]: `${step}ms` }}
    >
      {children.map((child, i) => (
        <div
          key={i}
          className="tf-fade-up"
          style={{ ["--tf-index" as string]: i }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

"use client";

type Props = {
  onClick: () => void;
  ariaLabel?: string;
};

// Single source of truth for modal close buttons (the little × top-right).
// Use across every modal so positioning, size and hover state stay consistent.
export default function ModalCloseButton({ onClick, ariaLabel = "Fechar" }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

// Root layout. Server component — public pages stay statically renderable.
// `<Providers>` is the client island that wraps TanStack Query, the
// theme provider and the i18n provider.
//
// Before React hydrates we inline TWO tiny scripts:
//   1. `THEME_BOOT_SCRIPT` reads the persisted theme from localStorage
//      and toggles `.dark` on <html>. Without this, users who picked
//      "Dark" would see a flash of light on every page load.
//   2. `LOCALE_BOOT_SCRIPT` reads the persisted locale (localStorage
//      wins; cookie is the fallback) and sets <html lang> + a CSS hint
//      class. Without this, the static-export HTML would announce
//      `lang="pt"` to screen readers / search-engine bots even when the
//      user has picked EN or FR.
const THEME_BOOT_SCRIPT = `
try {
  var m = localStorage.getItem('tf_theme') || 'light';
  var dark = m === 'dark' || (m === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (_) {}
`;
const LOCALE_BOOT_SCRIPT = `
try {
  var supported = ['pt', 'en', 'fr'];
  function head(s) { return (s || '').toLowerCase().split('-')[0]; }
  var picked = null;
  try { picked = localStorage.getItem('tf_locale'); } catch (_) {}
  if (!picked) {
    var m = document.cookie.match(/(?:^|;\\s*)NEXT_LOCALE=([^;]+)/);
    if (m) picked = decodeURIComponent(m[1]);
  }
  if (!picked && navigator && navigator.language) picked = head(navigator.language);
  var locale = supported.indexOf(head(picked)) >= 0 ? head(picked) : 'en';
  document.documentElement.lang = locale;
} catch (_) {}
`;

export const metadata: Metadata = {
  title: "TimeFlow — time tracking that fills itself in",
  description:
    "Connect your project tracker, describe what you did, let the AI propose the distribution. OpenProject, Jira, Linear, GitLab, or our native PM.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCALE_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";

// Static page — renders to /out/about/index.html.
export const metadata: Metadata = {
  title: "About — TimeFlow",
  description: "What TimeFlow is and why it exists.",
};

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 px-6 py-20">
        <article className="max-w-2xl mx-auto space-y-8 tf-fade-up">
          <header className="space-y-2">
            <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">
              About
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-(--color-fg)">
              Built for the team that built it.
            </h1>
          </header>

          <div className="space-y-5 text-(--color-fg)/85 leading-relaxed">
            <p>
              TimeFlow turns the daily chore of logging hours into a one-line
              description. Plug your existing project tracker in, tell the AI
              what you worked on, and it proposes a per-task split you can
              confirm in two clicks.
            </p>
            <p>
              It exists because we built it for ourselves — every consultancy
              hour we&apos;d ever logged was either lost, guessed, or filled
              out at 11&nbsp;pm on a Friday. The team is small, the workflow
              is opinionated, and every feature on the roadmap is one we want
              to use ourselves before we ship it.
            </p>
          </div>

          <section className="space-y-3 pt-4">
            <h2 className="text-xl font-semibold text-(--color-fg)">How it works</h2>
            <ul className="space-y-2 text-(--color-fg)/85">
              <li className="flex gap-3">
                <span className="text-indigo-500 font-semibold shrink-0">1.</span>
                <span>Connect OpenProject, Jira, Linear, or GitLab. Native PM if you have none.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-indigo-500 font-semibold shrink-0">2.</span>
                <span>Type what you did during the week in plain English.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-indigo-500 font-semibold shrink-0">3.</span>
                <span>The AI proposes a per-task, per-day distribution. Accept or edit.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-indigo-500 font-semibold shrink-0">4.</span>
                <span>Hours land on the upstream tracker; reports follow.</span>
              </li>
            </ul>
          </section>

          <section className="space-y-3 pt-4">
            <h2 className="text-xl font-semibold text-(--color-fg)">Principles</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-(--color-border) bg-(--color-card) p-4">
                <h3 className="text-sm font-semibold text-(--color-fg)">Privacy by default</h3>
                <p className="text-sm text-(--color-muted) mt-1">Integration credentials encrypted at rest. AI prompts not stored.</p>
              </div>
              <div className="rounded-xl border border-(--color-border) bg-(--color-card) p-4">
                <h3 className="text-sm font-semibold text-(--color-fg)">Audit before action</h3>
                <p className="text-sm text-(--color-muted) mt-1">Every AI suggestion shows reasoning. Nothing logs without your click.</p>
              </div>
              <div className="rounded-xl border border-(--color-border) bg-(--color-card) p-4">
                <h3 className="text-sm font-semibold text-(--color-fg)">Open data</h3>
                <p className="text-sm text-(--color-muted) mt-1">Export everything as CSV. No vendor lock-in.</p>
              </div>
              <div className="rounded-xl border border-(--color-border) bg-(--color-card) p-4">
                <h3 className="text-sm font-semibold text-(--color-fg)">Self-hostable</h3>
                <p className="text-sm text-(--color-muted) mt-1">Single docker compose. Postgres + Redis. No SaaS lock-in.</p>
              </div>
            </div>
          </section>
        </article>
      </main>
      <Footer />
    </>
  );
}

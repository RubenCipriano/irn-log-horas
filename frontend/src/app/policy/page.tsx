import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";

// Static page — renders to /out/policy/index.html.
export const metadata: Metadata = {
  title: "Privacy & data policy — TimeFlow",
  description: "How TimeFlow handles your account data, integration credentials, and AI requests.",
};

export default function PolicyPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 px-6 py-20">
        <article className="max-w-2xl mx-auto space-y-8 tf-fade-up">
          <header className="space-y-2">
            <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider">
              Privacy
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-(--color-fg)">
              Privacy & data policy
            </h1>
            <p className="text-xs text-(--color-muted)">Draft — not legally reviewed.</p>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-(--color-fg)">What we store</h2>
            <ul className="space-y-2 text-(--color-fg)/85">
              <li className="flex gap-3">
                <span className="text-indigo-500 shrink-0">•</span>
                <span>Account: email, password hash (Argon2id), display name, role per org.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-indigo-500 shrink-0">•</span>
                <span>Worklogs: the hour entries you create + their per-task allocation.</span>
              </li>
              <li className="flex gap-3">
                <span className="text-indigo-500 shrink-0">•</span>
                <span>
                  Integration credentials: encrypted at rest with AES-256-GCM. Only
                  ever decrypted in request memory to talk to the upstream tracker.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-indigo-500 shrink-0">•</span>
                <span>
                  AI prompts and replies: NOT stored. They flow through to your
                  configured provider (Anthropic / Gemini / etc.) per request and
                  we drop them.
                </span>
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-(--color-fg)">What we don&apos;t store</h2>
            <ul className="space-y-2 text-(--color-fg)/85">
              <li className="flex gap-3"><span className="text-indigo-500 shrink-0">•</span><span>Plaintext passwords.</span></li>
              <li className="flex gap-3"><span className="text-indigo-500 shrink-0">•</span><span>Plaintext integration tokens (after the create-time validation).</span></li>
              <li className="flex gap-3"><span className="text-indigo-500 shrink-0">•</span><span>Your AI prompt content. The audit log records THAT you used AI, not WHAT you asked.</span></li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-(--color-fg)">GDPR rights</h2>
            <p className="text-(--color-fg)/85 leading-relaxed">
              You can export everything we hold via Account → Export and delete
              your account via Account → Delete. Owner-of-org constraints apply
              (you can&apos;t orphan a paid org without transfer first).
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </>
  );
}

import Link from "next/link";
import { Section } from "@/components/Section";

export function CallToAction() {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-8 py-14 text-center tf-fade-up">
        <div
          aria-hidden
          className="absolute inset-0 opacity-30 mix-blend-overlay"
          style={{
            background:
              "radial-gradient(ellipse at 20% 80%, rgba(255,255,255,0.4), transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(255,255,255,0.3), transparent 50%)",
          }}
        />
        <div className="relative space-y-5 max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Ready to stop guessing on Friday afternoon?
          </h2>
          <p className="text-indigo-100 leading-relaxed">
            Spin up a workspace in under a minute. Free during the beta — no
            credit card, cancel any time.
          </p>
          <div className="flex flex-wrap gap-3 justify-center pt-2">
            <Link
              href="/signup"
              className="rounded-lg bg-white text-indigo-700 px-6 py-3 font-semibold hover:bg-indigo-50 transition-all shadow-lg hover:-translate-y-0.5"
            >
              Start free trial
            </Link>
            <Link
              href="/about"
              className="rounded-lg border border-white/30 text-white px-6 py-3 font-medium hover:bg-white/10 transition-all"
            >
              Read the story
            </Link>
          </div>
        </div>
      </div>
    </Section>
  );
}

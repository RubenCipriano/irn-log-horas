import { Section } from "@/components/Section";
import { Stagger } from "@/components/Stagger";

const features = [
  {
    title: "One calendar, every source",
    body: "Hours from OpenProject, Jira, Linear, GitLab — all on the same monthly grid. The day total shows what landed; the cell colour shows what's missing.",
    icon: "📅",
  },
  {
    title: "AI that explains itself",
    body: "Type what you did. The model proposes a per-task split, flags ambiguous matches, asks clarifying questions, and waits for you to confirm before anything is logged.",
    icon: "✨",
  },
  {
    title: "Approval workflow per dev",
    body: "Self-approve mode for senior engineers; manager review for the team. Each developer picks; reports always reflect the rule that was active when the week locked.",
    icon: "✅",
  },
  {
    title: "Client billing built in",
    body: "Project-mapping layer routes integration hours to native billing projects. Per-project rates, currencies, and a CSV export your finance team will open without complaining.",
    icon: "💸",
  },
  {
    title: "Multi-tenant from day one",
    body: "One TimeFlow workspace, multiple client orgs, scoped roles. Owners, admins, managers, tech leads, developers, and viewers — each with a permission matrix you can audit.",
    icon: "🏢",
  },
  {
    title: "GDPR-grade data handling",
    body: "AES-256-GCM envelope encryption for integration credentials. Right-to-export and right-to-delete wired into the account page. No prompt content stored.",
    icon: "🔐",
  },
];

export function Features() {
  return (
    <Section id="features">
      <header className="text-center max-w-2xl mx-auto mb-14 tf-fade-up">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-(--color-fg)">
          Built for teams that hate logging hours.
        </h2>
        <p className="mt-3 text-(--color-muted)">
          The features the team built for themselves, after years of forgetting
          to track Friday afternoons.
        </p>
      </header>
      <Stagger>
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-2xl border border-(--color-border) bg-(--color-card) p-6 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/5 hover:-translate-y-0.5 transition-all"
          >
            <div className="text-2xl mb-3" aria-hidden>{f.icon}</div>
            <h3 className="text-sm font-semibold text-(--color-fg)">{f.title}</h3>
            <p className="text-sm text-(--color-muted) leading-relaxed mt-1.5">{f.body}</p>
          </div>
        ))}
      </Stagger>
    </Section>
  );
}

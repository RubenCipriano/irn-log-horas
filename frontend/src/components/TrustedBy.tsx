export function TrustedBy() {
  const integrations = ["OpenProject", "Jira", "Linear", "GitLab", "Native PM"];
  return (
    <section className="px-6 py-10 border-y border-(--color-border) tf-fade-in">
      <div className="max-w-6xl mx-auto">
        <p className="text-center text-xs font-medium text-(--color-muted) uppercase tracking-wider mb-6">
          Plugs into the tracker you already use
        </p>
        <div className="flex flex-wrap justify-center items-center gap-x-10 gap-y-4">
          {integrations.map((name) => (
            <span
              key={name}
              className="text-sm font-semibold text-(--color-muted) hover:text-(--color-fg) transition-colors"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

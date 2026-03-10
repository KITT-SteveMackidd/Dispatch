type Card = {
  title: string;
  owner: "Steve" | "KITT";
  priority: "High" | "Medium" | "Low";
};

const board: { column: string; cards: Card[] }[] = [
  {
    column: "Backlog",
    cards: [
      { title: "Wire Jody results to auto-refresh Job Postings tab", owner: "KITT", priority: "High" },
      { title: "Add bulk action: queue top 3 postings for application", owner: "KITT", priority: "Medium" },
      { title: "Validate SaaS idea: job-posting triage + apply queue + auto resume-keyword drafts", owner: "KITT", priority: "High" },
      { title: "Research ICPs: job seekers, career coaches, and agencies", owner: "KITT", priority: "High" },
      { title: "Build SaaS pricing test (Free vs Pro monthly tiers)", owner: "KITT", priority: "Medium" },
      { title: "Define MVP scope for Resume Drafting + Job Queue SaaS", owner: "KITT", priority: "High" },
      { title: "Create React Native portfolio case-study page", owner: "Steve", priority: "Medium" },
    ],
  },
  {
    column: "In Progress",
    cards: [
      { title: "Jody refresh for Job Postings mirror (blocked: missing BRAVE_API_KEY; existing 6 eligible postings retained)", owner: "KITT", priority: "High" },
      { title: "Expand Jody crawl to LinkedIn + Indeed Canada with strict Canada filter", owner: "KITT", priority: "High" },
      { title: "Shortlist 15 React Native roles (Calgary + Remote)", owner: "KITT", priority: "High" },
      { title: "SaaS discovery: compile top competitor feature matrix", owner: "KITT", priority: "High" },
      { title: "Draft OpenClaw setup PDF v1", owner: "Steve", priority: "Medium" },
    ],
  },
  {
    column: "Review",
    cards: [
      { title: "Approve LinkedIn profile update draft", owner: "Steve", priority: "High" },
    ],
  },
  {
    column: "Done",
    cards: [
      { title: "Set daily 7:30 AM briefing automation", owner: "KITT", priority: "High" },
      { title: "Create Mission Control initial tabs", owner: "KITT", priority: "High" },
      { title: "Add Job Postings tab with read/queue/delete controls", owner: "KITT", priority: "High" },
    ],
  },
];

const priorityClass: Record<Card["priority"], string> = {
  High: "border-rose-500/40 text-rose-300",
  Medium: "border-amber-500/40 text-amber-300",
  Low: "border-emerald-500/40 text-emerald-300",
};

export default function KanbanPage() {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-2xl font-semibold">Kanban Board</h2>
      <p className="mt-2 text-sm text-zinc-300">Track work across backlog, in progress, review, and done.</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        {board.map((lane) => (
          <article key={lane.column} className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">{lane.column}</h3>
            <div className="mt-3 space-y-3">
              {lane.cards.map((card) => (
                <div key={card.title} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                  <p className="text-sm font-medium">{card.title}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                    <span>Owner: {card.owner}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${priorityClass[card.priority]}`}>
                      {card.priority}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

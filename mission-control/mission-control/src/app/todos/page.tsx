const todos = [
  { title: "Tailor resume for Role #1", priority: "High", owner: "KITT" },
  { title: "Submit 3 job applications", priority: "High", owner: "Steve" },
  { title: "Draft OpenClaw PDF product outline", priority: "Medium", owner: "KITT" },
  { title: "Review side-hustle MVP pricing", priority: "Medium", owner: "Steve" },
];

export default function TodosPage() {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-2xl font-semibold">Todos</h2>
      <p className="mt-2 text-sm text-zinc-300">Shared execution queue for Steve + KITT.</p>

      <ul className="mt-4 space-y-3">
        {todos.map((todo) => (
          <li key={todo.title} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{todo.title}</p>
                <p className="mt-1 text-xs text-zinc-400">Owner: {todo.owner}</p>
              </div>
              <span className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
                {todo.priority}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

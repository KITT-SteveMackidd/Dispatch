import { promises as fs } from "fs";
import path from "path";

type TodoItem = {
  id: string;
  area: string;
  title: string;
  status: string;
  priority: string;
  statusReason?: string;
};

async function loadTodos(): Promise<TodoItem[]> {
  try {
    const file = path.join(process.cwd(), "data", "dispatch-todos.json");
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as TodoItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default async function DispatchPage() {
  const todos = await loadTodos();

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-2xl font-semibold">Dispatch Roadmap</h2>
        <p className="mt-2 text-sm text-zinc-300">
          Source of truth lives in <span className="font-semibold">dispatch/DISPATCH_BIBLE.md</span>. Tasks below are implementation backlog items.
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Area</th>
                <th className="px-3 py-2 text-left">Task</th>
                <th className="px-3 py-2 text-left">Priority</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Status Reason</th>
              </tr>
            </thead>
            <tbody>
              {todos.map((t) => (
                <tr key={t.id} className="border-b border-zinc-800/60">
                  <td className="px-3 py-2 font-mono text-zinc-300">{t.id}</td>
                  <td className="px-3 py-2 text-zinc-200">{t.area}</td>
                  <td className="px-3 py-2 text-zinc-100">{t.title}</td>
                  <td className="px-3 py-2 text-zinc-300">{t.priority}</td>
                  <td className="px-3 py-2"><span className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-300">{t.status}</span></td>
                  <td className="px-3 py-2 text-zinc-400">{t.statusReason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

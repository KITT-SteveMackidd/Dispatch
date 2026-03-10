"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Overview" },
  { href: "/goals", label: "Goals" },
  { href: "/revenue", label: "Revenue Tracker" },
  { href: "/job-postings", label: "Job Postings" },
  { href: "/approvals", label: "Approvals Queue" },
  { href: "/todos", label: "Todos" },
  { href: "/kanban", label: "Kanban" },
  { href: "/monitor", label: "Monitor" },
  { href: "/dispatch", label: "Dispatch" },
  { href: "/core-files", label: "Core Files (Read Only)" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 lg:w-64 lg:shrink-0 lg:sticky lg:top-6 lg:h-fit">
      <p className="text-xs uppercase tracking-[0.22em] text-zinc-400">Mission Control</p>
      <h1 className="mt-2 text-2xl font-semibold">Steve × KITT</h1>
      <p className="mt-2 text-sm text-zinc-300">Command center tabs</p>

      <nav className="mt-5 flex flex-col gap-2 text-sm">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-lg border px-3 py-2 transition ${
                isActive
                  ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-950/70 hover:border-zinc-500"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

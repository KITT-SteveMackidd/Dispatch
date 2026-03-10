"use client";

import { useMemo, useState } from "react";
import { RevenueEntry, RevenueChannel, loadRevenueEntries } from "@/lib/revenue";

const totalTarget = 10000;
const daysTotal = 60;
const daysElapsed = 5;

const weeklyPlan = [
  { week: "Week 1", target: "$1,000", focus: "Launch first digital product + first sales" },
  { week: "Week 2", target: "$1,250", focus: "Second product + improve landing copy" },
  { week: "Week 3", target: "$1,500", focus: "Bundle offer + channel expansion" },
  { week: "Week 4", target: "$1,500", focus: "Double down on converting channel" },
  { week: "Week 5", target: "$1,750", focus: "New variant/product + automation" },
  { week: "Week 6", target: "$1,500", focus: "Optimize conversion + repeat winners" },
  { week: "Week 7", target: "$1,000", focus: "Final push + promo + upsells" },
  { week: "Week 8", target: "$500", focus: "Close gap + cleanup + scale plan" },
];

const channelTargets: Record<RevenueChannel, number> = {
  "Digital PDFs/Guides": 5500,
  "Template/Toolkit Packs": 2500,
  "POD (shirts/mugs)": 1000,
  "Affiliate/Tools": 1000,
  Other: 0,
};

export default function GoalsPage() {
  const [entries] = useState<RevenueEntry[]>(() => loadRevenueEntries());

  const revenueToDate = useMemo(() => entries.reduce((sum, entry) => sum + entry.amount, 0), [entries]);
  const remaining = Math.max(0, totalTarget - revenueToDate);
  const percent = Math.min(100, Math.round((revenueToDate / totalTarget) * 100));
  const idealByNow = Math.round((daysElapsed / daysTotal) * totalTarget);
  const paceDelta = revenueToDate - idealByNow;

  const channelCurrent = useMemo(() => {
    const map: Record<RevenueChannel, number> = {
      "Digital PDFs/Guides": 0,
      "Template/Toolkit Packs": 0,
      "POD (shirts/mugs)": 0,
      "Affiliate/Tools": 0,
      Other: 0,
    };

    entries.forEach((entry) => {
      map[entry.channel] += entry.amount;
    });

    return map;
  }, [entries]);

  const channels = Object.entries(channelTargets) as [RevenueChannel, number][];

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-2xl font-semibold">$10,000 in 2 Months — Goals</h2>
        <p className="mt-2 text-sm text-zinc-300">Live totals pulled from your actual revenue log.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Total Target</p><p className="mt-1 text-2xl font-semibold">$10,000</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Revenue to Date</p><p className="mt-1 text-2xl font-semibold text-emerald-300">${revenueToDate.toLocaleString()}</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Remaining</p><p className="mt-1 text-2xl font-semibold text-amber-300">${remaining.toLocaleString()}</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Pace vs Plan</p><p className={`mt-1 text-2xl font-semibold ${paceDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{paceDelta >= 0 ? "+" : ""}${paceDelta.toLocaleString()}</p></div>
        </div>

        <div className="mt-4"><div className="h-3 rounded-full bg-zinc-800"><div className="h-3 rounded-full bg-emerald-400" style={{ width: `${percent}%` }} /></div></div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-xl font-semibold">Weekly Revenue Plan</h3>
          <ul className="mt-3 space-y-2 text-sm text-zinc-300">{weeklyPlan.map((row) => <li key={row.week} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"><div className="flex items-center justify-between"><span className="font-medium">{row.week}</span><span className="text-emerald-300">Target: {row.target}</span></div><p className="mt-1 text-zinc-400">{row.focus}</p></li>)}</ul>
        </article>

        <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-xl font-semibold">Revenue Channel Breakdown (Actual)</h3>
          <ul className="mt-3 space-y-2 text-sm text-zinc-300">
            {channels.map(([channel, target]) => (
              <li key={channel} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{channel}</span><span className="text-zinc-400">Target: ${target.toLocaleString()}</span></div>
                <p className="mt-1 text-zinc-400">Current: <span className="text-zinc-200">${channelCurrent[channel].toLocaleString()}</span></p>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}

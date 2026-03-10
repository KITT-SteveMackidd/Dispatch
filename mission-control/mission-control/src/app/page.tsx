"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { logActivity } from "@/lib/activity";
import { jobPostings } from "@/lib/jobPostings";
import { mirrorState } from "@/lib/mirror";
import { RevenueEntry, loadRevenueEntries } from "@/lib/revenue";

const totalTarget = 10000;
const daysTotal = 60;
const daysElapsed = 5;

const JOB_UI_STORAGE_KEY = "mission-control.job-postings.ui.v2";
const APP_STATUS_STORAGE_KEY = "mission-control.application-status.v1";

type JobUiState = {
  id: string;
  read: boolean;
  queue: "none" | "queued";
  removed: boolean;
};

type ApplyStatus = "waiting" | "applied";

const quickActions = [
  { title: "Job Hunt Sprint", detail: "Pull fresh React Native roles (Calgary + Remote Canada)" },
  { title: "Resume Tailoring", detail: "Extract keywords and generate targeted resume versions" },
  { title: "Application Queue", detail: "Only jobs queued from Job Postings tab are shown below" },
  { title: "Side-Hustle Build", detail: "Ship one digital product increment today" },
];

const todayPlan = [
  "Source 15 new role postings and shortlist top 5",
  "Tailor resume for 2 postings",
  "Draft 1 side-hustle product page",
  "Review progress + set tomorrow's top 3",
];

const weeklyTargets = [
  "10 quality applications sent",
  "3 tailored resume versions",
  "1 side-hustle asset published for approval",
  "1 automation improvement in workflow",
];

function loadQueuedIds(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(JOB_UI_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as JobUiState[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r.queue === "queued" && !r.removed).map((r) => r.id);
  } catch {
    return [];
  }
}


function loadApplyStatus(): Record<string, ApplyStatus> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(APP_STATUS_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, ApplyStatus>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function saveApplyStatus(state: Record<string, ApplyStatus>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APP_STATUS_STORAGE_KEY, JSON.stringify(state));
  void mirrorState("application-status", state);
}

export default function Home() {
  const [entries] = useState<RevenueEntry[]>(() => loadRevenueEntries());
  const [queuedIds, setQueuedIds] = useState<string[]>(() => loadQueuedIds());
  const [applyStatus, setApplyStatus] = useState<Record<string, ApplyStatus>>(() => loadApplyStatus());

  const revenueToDate = useMemo(() => entries.reduce((sum, entry) => sum + entry.amount, 0), [entries]);
  const percent = Math.min(100, Math.round((revenueToDate / totalTarget) * 100));
  const idealByNow = Math.round((daysElapsed / daysTotal) * totalTarget);
  const paceDelta = revenueToDate - idealByNow;

  const queuedJobs = useMemo(
    () => queuedIds.map((id) => jobPostings.find((j) => j.id === id)).filter(Boolean),
    [queuedIds]
  );

  useEffect(() => {
    saveApplyStatus(applyStatus);
  }, [applyStatus]);

  const setStatus = (id: string, status: ApplyStatus) => {
    const next = { ...applyStatus, [id]: status };
    setApplyStatus(next);
    saveApplyStatus(next);

    const job = jobPostings.find((j) => j.id === id);
    if (job) {
      logActivity({
        agent: "KITT",
        state: "working",
        zone: "computer",
        task: `Set ${job.id} (${job.title}) application status to ${status === "applied" ? "Applied" : "Waiting to Apply"}`,
      });
    }
  };

  const refreshQueue = () => {
    setQueuedIds(loadQueuedIds());
  };


  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-xl font-semibold">Overall Revenue Tracker</h2>
        <p className="mt-1 text-sm text-zinc-300">Mission: $10,000 in 2 months (from Revenue Tracker tab)</p>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Target</p><p className="mt-1 text-2xl font-semibold">$10,000</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Revenue</p><p className="mt-1 text-2xl font-semibold text-emerald-300">${revenueToDate.toLocaleString()}</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Progress</p><p className="mt-1 text-2xl font-semibold">{percent}%</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Pace vs Plan</p><p className={`mt-1 text-2xl font-semibold ${paceDelta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{paceDelta >= 0 ? "+" : ""}${paceDelta.toLocaleString()}</p></div>
        </div>

        <div className="mt-4 h-3 rounded-full bg-zinc-800"><div className="h-3 rounded-full bg-emerald-400" style={{ width: `${percent}%` }} /></div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {quickActions.map((action) => (
          <article key={action.title} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-lg font-semibold">{action.title}</h2>
            <p className="mt-2 text-sm text-zinc-300">{action.detail}</p>

            {action.title === "Application Queue" && (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Queued Applications</p>
                  <button onClick={refreshQueue} type="button" className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">Refresh Queue</button>
                </div>

                {queuedJobs.length ? (
                  <ul className="space-y-2 text-sm text-zinc-200">
                    {queuedJobs.map((job) => {
                      if (!job) return null;
                      const status = applyStatus[job.id] ?? "waiting";
                      return (
                        <li key={job.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="font-medium">{job.title}</span>
                              <span className="text-zinc-400"> — {job.company}</span>
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-xs ${status === "applied" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                              {status === "applied" ? "Applied" : "Waiting to Apply"}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <button type="button" onClick={() => setStatus(job.id, "waiting")} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">Set Waiting</button>
                            <button type="button" onClick={() => setStatus(job.id, "applied")} className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300">Set Applied</button>
                            <Link href={`/job-postings?highlight=${job.id}`} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">View</Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-zinc-400">No items in Application Queue yet. Add items from Job Postings tab.</p>
                )}
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"><h3 className="text-xl font-semibold">Today&apos;s Execution Plan</h3><ul className="mt-3 space-y-2 text-sm text-zinc-300">{todayPlan.map((item) => <li key={item} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">{item}</li>)}</ul></article>
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5"><h3 className="text-xl font-semibold">Weekly Targets</h3><ul className="mt-3 space-y-2 text-sm text-zinc-300">{weeklyTargets.map((item) => <li key={item} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">{item}</li>)}</ul></article>
      </section>
    </div>
  );
}

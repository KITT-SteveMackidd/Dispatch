"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DraftItem, loadApprovals, saveApprovals } from "@/lib/approvals";
import { logActivity } from "@/lib/activity";
import { JobPosting, jobPostings } from "@/lib/jobPostings";
import { mirrorState } from "@/lib/mirror";

type QueueStatus = "none" | "queued";

type JobUiState = {
  id: string;
  read: boolean;
  queue: QueueStatus;
  removed: boolean;
};

// bumped to v2 to reset existing read states to unread "as of now"
const STORAGE_KEY = "mission-control.job-postings.ui.v2";
const MAX_VISIBLE_POSTINGS = 50;

const defaultUiState: JobUiState[] = jobPostings.map((job) => ({
  id: job.id,
  read: false,
  queue: "none",
  removed: false,
}));

function mergeWithDefaults(saved: JobUiState[] | null): JobUiState[] {
  const savedMap = new Map((saved ?? []).map((s) => [s.id, s]));
  return jobPostings.map((job) => {
    const found = savedMap.get(job.id);
    return (
      found ?? {
        id: job.id,
        read: false,
        queue: "none",
        removed: false,
      }
    );
  });
}

function loadUiState(): JobUiState[] {
  if (typeof window === "undefined") return defaultUiState;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultUiState;

  try {
    const parsed = JSON.parse(raw) as JobUiState[];
    if (!Array.isArray(parsed)) return defaultUiState;
    return mergeWithDefaults(parsed);
  } catch {
    return defaultUiState;
  }
}

function saveUiState(state: JobUiState[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void mirrorState("job-ui", state);
}

function statusFor(job: JobPosting, ui: JobUiState | undefined) {
  if (!ui) return { read: false, queue: "none" as QueueStatus, removed: false };
  return ui;
}

export default function JobPostingsPage() {
  const [uiState, setUiState] = useState<JobUiState[]>(() => loadUiState());
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight") ?? "";

  useEffect(() => {
    saveUiState(uiState);
  }, [uiState]);

  const visibleJobs = useMemo(() => {
    return jobPostings
      .filter((job) => !statusFor(job, uiState.find((u) => u.id === job.id)).removed)
      .slice(0, MAX_VISIBLE_POSTINGS);
  }, [uiState]);

  const queuedCount = useMemo(
    () => uiState.filter((u) => u.queue === "queued" && !u.removed).length,
    [uiState]
  );

  const toggleRead = (id: string) => {
    const job = jobPostings.find((j) => j.id === id);
    setUiState((current) => current.map((u) => (u.id === id ? { ...u, read: !u.read } : u)));
    if (job) {
      logActivity({
        agent: "KITT",
        state: "working",
        zone: "computer",
        task: `Updated read status for ${job.id} (${job.title})`,
      });
    }
  };

  const keywordify = (job: JobPosting) => {
    const text = `${job.title} ${job.summary} ${job.location}`.toLowerCase();
    const picks = [
      "react native",
      "javascript",
      "typescript",
      "mobile",
      "api",
      "c#",
      ".net",
      "agile",
      "sql",
      "firebase",
      "expo",
    ].filter((k) => text.includes(k));
    return picks.length ? picks : ["react native", "javascript", "mobile app development"];
  };

  const createResumeDraftForJob = (job: JobPosting) => {
    const existing = loadApprovals();
    const draftId = `R-${job.id}`;
    if (existing.some((d) => d.id === draftId)) return;

    const keywords = keywordify(job);
    const now = new Date().toLocaleString();

    const draft: DraftItem = {
      id: draftId,
      type: "Resume",
      title: `Resume Draft — ${job.title} @ ${job.company}`,
      createdAt: now,
      audience: "Hiring manager / recruiter",
      summary: `Resume draft generated from ${job.id} keywords for targeted application alignment.`,
      content: `Target role: ${job.title}\nCompany: ${job.company}\n\nSuggested keyword emphasis:\n- ${keywords.join("\n- ")}\n\nSuggested summary:\nReact Native-focused software developer with experience delivering mobile and full-stack features using JavaScript and C# ASP.NET. Align accomplishments to ${job.title} responsibilities and emphasize production delivery impact.\n\nSuggested bullet updates:\n- Highlight React Native/mobile project outcomes and release ownership.\n- Mirror ${job.company} requirements using exact posting terminology where truthful.\n- Keep pre-Auxiun experience trimmed unless role specifically benefits from legacy domain context.`,
      status: "Waiting for Steve approval",
    };

    saveApprovals([draft, ...existing]);
    logActivity({
      agent: "Jody",
      state: "working",
      zone: "computer",
      task: `Generated resume draft ${draft.id} from ${job.id} keywords and sent to Approvals Queue`,
    });
  };

  const toggleQueue = (id: string) => {
    const job = jobPostings.find((j) => j.id === id);
    let queuedNow = false;

    setUiState((current) =>
      current.map((u) => {
        if (u.id !== id) return u;
        const nextQueued = u.queue !== "queued";
        queuedNow = nextQueued;

        if (nextQueued && job) {
          createResumeDraftForJob(job);
        }

        return {
          ...u,
          queue: nextQueued ? "queued" : "none",
        };
      })
    );

    if (job) {
      logActivity({
        agent: "KITT",
        state: "working",
        zone: "computer",
        task: `${queuedNow ? "Added" : "Removed"} ${job.id} (${job.title}) ${queuedNow ? "to" : "from"} Apply Queue`,
      });
    }
  };

  const removePosting = (id: string) => {
    const job = jobPostings.find((j) => j.id === id);
    setUiState((current) => current.map((u) => (u.id === id ? { ...u, removed: true, queue: "none" } : u)));
    if (job) {
      logActivity({
        agent: "KITT",
        state: "working",
        zone: "computer",
        task: `Removed ${job.id} (${job.title}) from Job Postings list`,
      });
    }
  };

  const markAllUnread = () => {
    setUiState((current) => current.map((u) => ({ ...u, read: false })));
    logActivity({
      agent: "KITT",
      state: "working",
      zone: "computer",
      task: "Set all visible job postings to unread",
    });
  };

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold">Job Postings</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Dedicated feed for Steve&apos;s target roles (React Native first, Calgary + Remote Canada).
          </p>
          <p className="mt-1 text-xs text-zinc-400">Showing {visibleJobs.length} of up to {MAX_VISIBLE_POSTINGS} postings.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={markAllUnread}
            className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500"
          >
            Mark All Unread
          </button>
          <div className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200">
            Apply Queue: <span className="font-semibold text-emerald-300">{queuedCount}</span>
          </div>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {visibleJobs.map((job) => {
          const ui = statusFor(job, uiState.find((u) => u.id === job.id));

          return (
            <li
              key={job.id}
              className={`rounded-xl border p-4 ${
                highlightId === job.id
                  ? "border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/40"
                  : "border-zinc-800 bg-zinc-950/60"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-2.5 w-2.5 rounded-full ${
                        ui.queue === "queued" ? "bg-emerald-400" : ui.read ? "bg-zinc-500" : "bg-rose-400"
                      }`}
                      title={ui.queue === "queued" ? "In Apply Queue" : ui.read ? "Read" : "Unread"}
                    />
                    <p className="text-xs text-zinc-400">{job.id} · Fit {job.fit}/10</p>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold">{job.title}</h3>
                  <p className="text-sm text-zinc-300">{job.company}</p>
                </div>
                <div className="flex items-center gap-2">
                  {ui.queue === "queued" && (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                      In Apply Queue
                    </span>
                  )}
                  <span className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-300">{job.mode}</span>
                </div>
              </div>

              <p className="mt-2 text-sm text-zinc-400">{job.location} · Posted: {job.posted}</p>
              {job.salary && <p className="mt-1 text-sm text-emerald-300">Salary: {job.salary}</p>}
              <p className="mt-2 text-sm text-zinc-300">{job.summary}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-zinc-500"
                >
                  Open Posting
                </a>

                <button
                  type="button"
                  onClick={() => toggleRead(job.id)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-zinc-500"
                >
                  {ui.read ? "Mark Unread" : "Mark Read"}
                </button>

                <button
                  type="button"
                  onClick={() => toggleQueue(job.id)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    ui.queue === "queued"
                      ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "bg-emerald-500 text-zinc-950"
                  }`}
                >
                  {ui.queue === "queued" ? "Remove from Queue" : "Add to Apply Queue"}
                </button>

                <button
                  type="button"
                  onClick={() => removePosting(job.id)}
                  className="rounded-lg border border-rose-500/40 px-3 py-2 text-sm text-rose-300"
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {!visibleJobs.length && (
        <p className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-400">
          No postings visible. Deleted items are hidden from this list.
        </p>
      )}
    </section>
  );
}

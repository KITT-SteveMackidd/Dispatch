"use client";

import { useEffect, useMemo, useState } from "react";
import { ActivityEvent, loadActivity } from "@/lib/activity";

type UsageSession = {
  key: string;
  sessionId: string;
  updatedAt: number;
  model: string;
  kind: string;
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type SessionTimelineItem = {
  ts: string;
  kind: "prompt" | "tool" | "tool_result" | "assistant" | "error" | "usage";
  label: string;
  detail?: string;
};

const TOKEN_COST_INPUT_PER_M = 5;
const TOKEN_COST_OUTPUT_PER_M = 15;

function isErrorTask(task: string) {
  return /(error|failed|failure|exception|timeout|denied|not found|cannot|unable)/i.test(task);
}

function estimateCost(inputTokens: number, outputTokens: number) {
  return (inputTokens / 1_000_000) * TOKEN_COST_INPUT_PER_M + (outputTokens / 1_000_000) * TOKEN_COST_OUTPUT_PER_M;
}


async function loadActivityFromMirror(): Promise<ActivityEvent[]> {
  try {
    const res = await fetch("/api/mirror/activity", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as ActivityEvent[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function loadUsageSessions(): Promise<UsageSession[]> {
  try {
    const res = await fetch("/api/usage", { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { sessions?: UsageSession[] };
    return Array.isArray(body.sessions) ? body.sessions : [];
  } catch {
    return [];
  }
}

async function loadSessionTimeline(sessionId: string): Promise<SessionTimelineItem[]> {
  try {
    const res = await fetch(`/api/session-timeline/${sessionId}`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: SessionTimelineItem[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}

export default function MonitorPage() {
  const [events, setEvents] = useState<ActivityEvent[]>(() => loadActivity());
  const [usageSessions, setUsageSessions] = useState<UsageSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [timelineItems, setTimelineItems] = useState<SessionTimelineItem[]>([]);

  const selected = useMemo(() => usageSessions.find((s) => s.sessionId === selectedId) ?? usageSessions[0], [usageSessions, selectedId]);

  const totals = useMemo(() => {
    const input = usageSessions.reduce((sum, s) => sum + s.inputTokens, 0);
    const output = usageSessions.reduce((sum, s) => sum + s.outputTokens, 0);
    const total = usageSessions.reduce((sum, s) => sum + s.totalTokens, 0);
    const errors = events.filter((e) => isErrorTask(e.task)).length;
    return { input, output, total, errors, cost: estimateCost(input, output) };
  }, [usageSessions, events]);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      const [mirrorActivity, sessions] = await Promise.all([loadActivityFromMirror(), loadUsageSessions()]);
      const local = loadActivity();
      const nextEvents = mirrorActivity.length ? mirrorActivity : local;
      if (!mounted) return;
      setEvents(nextEvents);
      setUsageSessions(sessions);
    };

    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 8000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const sid = selected?.sessionId;
    if (!sid) return;

    let mounted = true;
    loadSessionTimeline(sid).then((items) => {
      if (mounted) setTimelineItems(items);
    });
    return () => {
      mounted = false;
    };
  }, [selected?.sessionId]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-2xl font-semibold">Monitor</h2>
        <p className="mt-2 text-sm text-zinc-300">Live monitor with actual OpenClaw session usage stream + activity task log.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Sessions</p><p className="mt-1 text-2xl font-semibold">{usageSessions.length}</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Input Tokens</p><p className="mt-1 text-2xl font-semibold">{totals.input.toLocaleString()}</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Output Tokens</p><p className="mt-1 text-2xl font-semibold">{totals.output.toLocaleString()}</p></div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Estimated Cost</p><p className="mt-1 text-2xl font-semibold">${totals.cost.toFixed(2)}</p><p className="text-xs text-zinc-500">Error signals: {totals.errors}</p></div>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-lg font-semibold">Sessions</h3>
          <ul className="mt-3 max-h-[700px] space-y-2 overflow-y-auto pr-1">
            {usageSessions.map((session) => {
              const active = selected?.sessionId === session.sessionId;
              const cost = estimateCost(session.inputTokens, session.outputTokens);
              return (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(session.sessionId)}
                    className={`w-full rounded-lg border p-3 text-left ${active ? "border-emerald-400 bg-emerald-400/10" : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-600"}`}
                  >
                    <p className="text-sm font-medium break-all">{session.key}</p>
                    <p className="mt-1 text-xs text-zinc-400">{new Date(session.updatedAt).toLocaleString()} · {session.model}</p>
                    <p className="mt-1 text-xs text-zinc-400">Tokens: {session.totalTokens.toLocaleString()} ({session.inputTokens.toLocaleString()} in / {session.outputTokens.toLocaleString()} out) · ${cost.toFixed(3)}</p>
                  </button>
                </li>
              );
            })}
            {!usageSessions.length && <li className="text-sm text-zinc-500">No session usage stream available.</li>}
          </ul>
        </aside>

        <article className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-lg font-semibold">Session Timeline</h3>
          {selected ? (
            <>
              <p className="mt-1 break-all text-xs text-zinc-400">{selected.key} · {new Date(selected.updatedAt).toLocaleString()}</p>
              <div className="mt-3 max-h-[700px] overflow-y-auto pr-1">
                <ol className="relative ml-2 border-l border-zinc-700 pl-4">
                  <li className="mb-4 ml-2">
                    <span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-sky-400" />
                    <p className="text-xs text-zinc-400">{new Date(selected.updatedAt - 45 * 60 * 1000).toLocaleTimeString()}</p>
                    <p className="text-sm text-zinc-200">Session observation window opened</p>
                  </li>

                  {timelineItems.map((item, idx) => {
                    const isError = item.kind === "error" || /error|failed|exception/i.test(item.label + " " + (item.detail || ""));
                    const dotColor =
                      item.kind === "prompt"
                        ? "bg-sky-400"
                        : item.kind === "tool"
                          ? "bg-indigo-400"
                          : item.kind === "usage"
                            ? "bg-amber-400"
                            : isError
                              ? "bg-rose-400"
                              : "bg-emerald-400";

                    return (
                      <li key={`${item.ts}-${idx}`} className="mb-4 ml-2">
                        <span className={`absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full ${dotColor}`} />
                        <p className="text-xs text-zinc-400">{new Date(item.ts).toLocaleTimeString()} · {item.kind.replace("_", " ")}</p>
                        <p className={`text-sm ${isError ? "text-rose-200" : "text-zinc-200"}`}>{item.label}</p>
                        {item.detail && <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-400">{item.detail}</pre>}
                      </li>
                    );
                  })}
                </ol>

                {!timelineItems.length && <p className="mt-2 text-sm text-zinc-500">No timeline details found for this session yet.</p>}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Select a session to view timeline.</p>
          )}
        </article>
      </section>
    </div>
  );
}

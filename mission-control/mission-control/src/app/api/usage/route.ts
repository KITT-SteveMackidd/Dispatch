import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

type RawSession = {
  key: string;
  sessionId?: string;
  updatedAt?: number;
  model?: string;
  kind?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  agentId?: string;
};

type RawResponse = {
  sessions?: RawSession[];
};

function normalizeSessions(raw: RawSession[]) {
  const grouped = new Map<string, RawSession[]>();

  raw.forEach((session) => {
    const id = session.sessionId || session.key;
    const list = grouped.get(id) ?? [];
    list.push(session);
    grouped.set(id, list);
  });

  const pickBest = (items: RawSession[]) => {
    return [...items].sort((a, b) => {
      const aRun = a.key.includes(":run:") ? 1 : 0;
      const bRun = b.key.includes(":run:") ? 1 : 0;
      if (aRun !== bRun) return bRun - aRun;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    })[0];
  };

  return Array.from(grouped.values())
    .map(pickBest)
    .map((s) => ({
      key: s.key,
      sessionId: s.sessionId ?? s.key,
      updatedAt: s.updatedAt ?? Date.now(),
      model: s.model ?? "unknown",
      kind: s.kind ?? "unknown",
      agentId: s.agentId ?? "main",
      inputTokens: s.inputTokens ?? 0,
      outputTokens: s.outputTokens ?? 0,
      totalTokens: s.totalTokens ?? (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 120);
}

export async function GET() {
  try {
    const { stdout } = await execFileAsync("openclaw", ["sessions", "--all-agents", "--json"], {
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const parsed = JSON.parse(stdout) as RawResponse;
    const sessions = normalizeSessions(Array.isArray(parsed.sessions) ? parsed.sessions : []);

    return NextResponse.json({ sessions, source: "openclaw.sessions" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "usage stream unavailable";
    return NextResponse.json({ sessions: [], source: "openclaw.sessions", error: message }, { status: 200 });
  }
}

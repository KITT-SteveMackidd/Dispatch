export type AgentName = "KITT" | "Jody" | "David" | "Scout" | "NightShift";
export type AgentState = "working" | "chatting" | "walking" | "idle";
export type Zone = "computer" | "watercooler" | "hall" | "lunch";

export type ActivityEvent = {
  id: string;
  ts: string;
  agent: AgentName;
  state: AgentState;
  zone: Zone;
  task: string;
};

import { mirrorState } from "@/lib/mirror";

const ACTIVITY_STORAGE_KEY = "mission-control.activity.v1";

export function loadActivity(): ActivityEvent[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ActivityEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveActivity(events: ActivityEvent[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(events));
  void mirrorState("activity", events);
}

export function logActivity(event: Omit<ActivityEvent, "id" | "ts">) {
  const nextEvent: ActivityEvent = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ...event,
  };
  const existing = loadActivity();
  const next = [nextEvent, ...existing].slice(0, 300);
  saveActivity(next);
}

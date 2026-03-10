export type DraftItem = {
  id: string;
  type: "LinkedIn Post" | "Email" | "Web Page" | "Resume";
  title: string;
  createdAt: string;
  audience: string;
  summary: string;
  content: string;
  status: "Waiting for Steve approval";
};

import { mirrorState } from "@/lib/mirror";

export const APPROVALS_STORAGE_KEY = "mission-control.approvals.queue.v1";

export const seededDrafts: DraftItem[] = [];

// Revision items received via Telegram that should be re-added to queue if missing.
export const revisionSeedDrafts: DraftItem[] = [
  {
    id: "A-101-R1",
    type: "LinkedIn Post",
    title: "React Native Developer — Open to Calgary/Remote (Revised)",
    createdAt: new Date().toLocaleString(),
    audience: "Recruiters + hiring managers",
    summary: "Revision from Telegram: explicitly mention React + React Native framework expertise.",
    content:
      "Hi Calgary + Canadian tech network — I’m currently open to new opportunities as a React Native Developer (Calgary or remote in Canada).\n\nI bring hands-on experience building mobile-facing products and a practical background across HTML/CSS/JavaScript and C# ASP.NET, with strong working knowledge of both the React and React Native frameworks for building responsive, production-ready applications.\n\nIf your team is hiring for React Native roles, I’d love to connect.",
    status: "Waiting for Steve approval",
  },
];

export function loadApprovals(): DraftItem[] {
  if (typeof window === "undefined") return [...revisionSeedDrafts, ...seededDrafts];

  const raw = window.localStorage.getItem(APPROVALS_STORAGE_KEY);
  let existing: DraftItem[] = [];

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DraftItem[];
      existing = Array.isArray(parsed) ? parsed : [];
    } catch {
      existing = [];
    }
  }

  const existingIds = new Set(existing.map((d) => d.id));
  const merged = [...existing];

  for (const draft of revisionSeedDrafts) {
    if (!existingIds.has(draft.id)) {
      merged.unshift(draft);
      existingIds.add(draft.id);
    }
  }

  if (!raw) {
    for (const draft of seededDrafts) {
      if (!existingIds.has(draft.id)) {
        merged.push(draft);
      }
    }
  }

  window.localStorage.setItem(APPROVALS_STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function saveApprovals(items: DraftItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APPROVALS_STORAGE_KEY, JSON.stringify(items));
  void mirrorState("approvals", items);
}

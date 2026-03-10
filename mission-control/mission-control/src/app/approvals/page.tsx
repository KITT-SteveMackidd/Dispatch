"use client";

import { useEffect, useMemo, useState } from "react";
import { DraftItem, loadApprovals, saveApprovals } from "@/lib/approvals";
import { logActivity } from "@/lib/activity";

type PlannedChange = {
  lineIndex: number;
  original: string;
  revised: string;
};

type SectionName = "expertise" | "technical" | "experience" | "other";

function stripExperienceBeforeAuxiun(template: string): string {
  const lines = template.split("\n");
  const profIdx = lines.findIndex((l) => l.toLowerCase().includes("professional experience"));
  if (profIdx === -1) return template;

  // End of Professional Experience section (next all-caps heading)
  const sectionEndIdx = lines.findIndex((l, i) => {
    if (i <= profIdx) return false;
    const t = l.trim();
    return t.length > 2 && t === t.toUpperCase() && /[A-Z]/.test(t);
  });
  const end = sectionEndIdx === -1 ? lines.length : sectionEndIdx;

  // Keep these experience blocks, remove older entries after Auxiun.
  const auxiunIdx = lines.findIndex((l, i) => i > profIdx && /auxiun/i.test(l));
  const cutoffIdx = lines.findIndex((l, i) => {
    if (auxiunIdx === -1 || i <= auxiunIdx || i >= end) return false;
    return /(absolute|sensor|geo-?x)/i.test(l);
  });

  const keepUntil = cutoffIdx === -1 ? end : cutoffIdx;

  const keptExperience = lines
    .slice(profIdx + 1, keepUntil)
    .filter((l) => !/(absolute|sensor|geo-?x)/i.test(l));

  return [
    ...lines.slice(0, profIdx + 1),
    ...keptExperience,
    ...lines.slice(end),
  ].join("\n");
}

function extractKeywordsFromDraft(draftContent: string): string[] {
  const lines = draftContent.split("\n").map((l) => l.trim());

  const requirementsStart = lines.findIndex((l) => /suggested keyword emphasis|requirements|keywords/i.test(l));
  const requirementLines =
    requirementsStart >= 0
      ? lines.slice(requirementsStart + 1).filter((l) => l.startsWith("-")).map((l) => l.replace(/^-\s*/, ""))
      : [];

  const fallback = lines
    .map((l) => l.replace(/^-\s*/, ""))
    .filter((l) => l.length > 0)
    .filter((l) => !l.toLowerCase().startsWith("subject:"));

  const merged = (requirementLines.length ? requirementLines : fallback)
    .map((k) => k.replace(/[•.]/g, "").trim())
    .filter(Boolean);

  return Array.from(new Set(merged)).slice(0, 20);
}

function isSectionHeading(line: string) {
  const t = line.trim();
  return t.length > 2 && t === t.toUpperCase() && /[A-Z]/.test(t);
}

function sectionFromHeading(line: string): SectionName {
  const t = line.trim().toLowerCase();
  if (t.includes("expertise")) return "expertise";
  if (t.includes("technical competency") || t.includes("technical skills") || t.includes("skills")) return "technical";
  if (t.includes("professional experience")) return "experience";
  return "other";
}

function isBulletLine(line: string) {
  const t = line.trim();
  return /^[-•*]\s+/.test(t);
}

function contextualKeywords(line: string, keywords: string[]): string[] {
  const lower = line.toLowerCase();

  const mobile = keywords.filter((k) => /react native|mobile|ios|android|expo|detox|app store|play store/i.test(k));
  const frontend = keywords.filter((k) => /react|javascript|typescript|ui|accessibility|performance/i.test(k));
  const backend = keywords.filter((k) => /c#|asp\.net|api|sql|azure|aws|cloud|rest|graphql/i.test(k));
  const process = keywords.filter((k) => /agile|scrum|ci\/cd|testing|monitoring|mentoring/i.test(k));

  let pool: string[] = [];
  if (/react|mobile|ios|android|app|native/.test(lower)) pool = [...mobile, ...frontend];
  else if (/api|backend|server|database|sql|c#|asp\.net|cloud/.test(lower)) pool = [...backend, ...process];
  else if (/team|lead|deliver|project|feature|quality|release/.test(lower)) pool = [...process, ...frontend];
  else pool = [...mobile, ...frontend, ...backend];

  return Array.from(new Set(pool)).filter((k) => !lower.includes(k.toLowerCase())).slice(0, 2);
}

function applyContextualInsertion(line: string, add: string[]) {
  if (!add.length) return line;
  const phrase = add.join("; ");

  const prefixMatch = line.match(/^([-•*]\s+)/);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  const body = prefix ? line.replace(/^[-•*]\s+/, "") : line;

  let revisedBody = body;
  if (body.endsWith(".")) {
    revisedBody = body.replace(/\.$/, `, emphasizing ${phrase}.`);
  } else if (body.includes(" - ")) {
    revisedBody = `${body}; aligned to ${phrase}`;
  } else {
    revisedBody = `${body} (aligned to ${phrase})`;
  }

  return `${prefix}${revisedBody}`;
}

function planLineChanges(cleanTemplate: string, keywords: string[]): PlannedChange[] {
  const lines = cleanTemplate.split("\n");
  const changes: PlannedChange[] = [];

  let section: SectionName = "other";

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (isSectionHeading(trimmed)) {
      section = sectionFromHeading(trimmed);
      return;
    }

    const targetSection = section === "expertise" || section === "technical" || section === "experience";
    if (!targetSection) return;
    if (!isBulletLine(line)) return;

    const add = contextualKeywords(trimmed, keywords);
    if (!add.length) return;

    const revised = applyContextualInsertion(line, add);
    if (revised !== line) {
      changes.push({ lineIndex: idx, original: line, revised });
    }
  });

  return changes;
}

function ResumeApprovalView({ draft, template }: { draft: DraftItem; template: string }) {
  const cleanedTemplate = useMemo(() => stripExperienceBeforeAuxiun(template), [template]);
  const keywords = useMemo(() => extractKeywordsFromDraft(draft.content), [draft.content]);
  const changes = useMemo(() => planLineChanges(cleanedTemplate, keywords), [cleanedTemplate, keywords]);

  const lineMap = useMemo(() => {
    const map = new Map<number, PlannedChange>();
    changes.forEach((c) => map.set(c.lineIndex, c));
    return map;
  }, [changes]);

  const templateLines = useMemo(() => cleanedTemplate.split("\n"), [cleanedTemplate]);

  return (
    <>
      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-400">Resume Template (Pre-Auxiun experience removed)</p>
        <p className="mt-1 text-xs text-zinc-500">
          Showing planned line edits aligned to job-posting requirements/keywords: original line in red, proposed revised line in green.
        </p>

        <div className="mt-3 max-h-[560px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/30">
          {templateLines.map((line, idx) => {
            const planned = lineMap.get(idx);
            if (!planned) {
              return (
                <div key={`ctx-${idx}`} className="grid grid-cols-[28px_1fr] border-b border-zinc-800/60 text-sm">
                  <div className="flex items-center justify-center text-xs text-zinc-500"> </div>
                  <pre className="whitespace-pre-wrap px-3 py-1.5 text-zinc-300">{line}</pre>
                </div>
              );
            }

            return (
              <div key={`chg-${idx}`} className="border-b border-zinc-800/60 text-sm">
                <div className="grid grid-cols-[28px_1fr] bg-rose-500/10">
                  <div className="flex items-center justify-center text-xs font-bold text-rose-300">-</div>
                  <pre className="whitespace-pre-wrap px-3 py-1.5 text-rose-200">{planned.original}</pre>
                </div>
                <div className="grid grid-cols-[28px_1fr] bg-emerald-500/10">
                  <div className="flex items-center justify-center text-xs font-bold text-emerald-300">+</div>
                  <pre className="whitespace-pre-wrap px-3 py-1.5 text-emerald-200">{planned.revised}</pre>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-400">Keyword Injection List (from posting requirements)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {keywords.slice(0, 14).map((k, i) => (
            <span key={`${k}-${i}`} className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
              {k}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

export default function ApprovalsPage() {
  const [drafts, setDrafts] = useState<DraftItem[]>(() => loadApprovals());
  const [selectedId, setSelectedId] = useState<string>(() => loadApprovals()[0]?.id ?? "");
  const [savedMessage, setSavedMessage] = useState("");
  const [resumeTemplate, setResumeTemplate] = useState("");

  const selected = useMemo(() => drafts.find((d) => d.id === selectedId) ?? drafts[0], [drafts, selectedId]);

  useEffect(() => {
    saveApprovals(drafts);
  }, [drafts]);

  useEffect(() => {
    const loadTemplate = async () => {
      try {
        const res = await fetch("/api/resume-template", { cache: "no-store" });
        const data = (await res.json()) as { text?: string };
        setResumeTemplate(data.text ?? "");
      } catch {
        setResumeTemplate("");
      }
    };
    void loadTemplate();
  }, []);

  const persist = (next: DraftItem[]) => {
    setDrafts(next);
    saveApprovals(next);
  };

  const removeFromQueue = (id: string, message: string) => {
    const removed = drafts.find((d) => d.id === id);
    const remaining = drafts.filter((d) => d.id !== id);
    persist(remaining);
    setSelectedId(remaining[0]?.id ?? "");
    setSavedMessage(message);

    if (removed) {
      logActivity({
        agent: "KITT",
        state: "working",
        zone: "computer",
        task: `Processed approvals action for ${removed.id} (${removed.title})`,
      });
    }
  };

  const approveDraft = () => {
    if (!selected) return;
    removeFromQueue(selected.id, `Draft ${selected.id} approved and removed from queue.`);
  };

  const requestRevisionsViaTelegram = () => {
    if (!selected) return;
    const preview = selected.content.slice(0, 1200);
    const text = `Revision request for ${selected.id} (${selected.title})\n\nDraft preview:\n${preview}\n\nPlease reply in Telegram with requested revisions.`;
    const url = `https://t.me/share/url?url=${encodeURIComponent("https://docs.openclaw.ai")}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    removeFromQueue(selected.id, `Opened Telegram share for ${selected.id}. Reply with revisions in Telegram.`);
  };

  const rejectDraft = () => {
    if (!selected) return;
    removeFromQueue(selected.id, `Draft ${selected.id} rejected and removed from queue.`);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-2xl font-semibold">Approvals Queue</h2>
        <p className="mt-2 text-sm text-zinc-300">Drafts completed by KITT. Click an item to review before approval.</p>

        <ul className="mt-4 space-y-3">
          {drafts.map((item) => {
            const active = selected?.id === item.id;
            return (
              <li key={item.id}>
                <button
                  className={`w-full rounded-xl border p-4 text-left transition ${active ? "border-emerald-400 bg-emerald-400/10" : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-600"}`}
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id);
                    setSavedMessage("");
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-zinc-400">{item.id} · {item.type}</p>
                      <h3 className="mt-1 font-medium">{item.title}</h3>
                      <p className="mt-1 text-xs text-zinc-400">{item.createdAt}</p>
                    </div>
                    <span className="rounded-full border border-amber-500/40 px-2 py-1 text-xs text-amber-300">{item.status}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        {selected ? (
          <>
            <h3 className="text-xl font-semibold">Draft Preview</h3>
            <p className="mt-2 text-sm text-zinc-300">{selected.summary}</p>

            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="mb-3 text-xs text-zinc-400">
                <p><span className="text-zinc-300">Type:</span> {selected.type}</p>
                <p><span className="text-zinc-300">Audience:</span> {selected.audience}</p>
                <p><span className="text-zinc-300">Created:</span> {selected.createdAt}</p>
              </div>

              {selected.type === "Resume" ? (
                <ResumeApprovalView draft={selected} template={resumeTemplate} />
              ) : (
                <pre className="whitespace-pre-wrap text-sm leading-6 text-zinc-200">{selected.content}</pre>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950" type="button" onClick={approveDraft}>Approve Draft</button>
              <button className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white" type="button" onClick={requestRevisionsViaTelegram}>Request Revisions (Telegram)</button>
              <button className="rounded-lg border border-rose-500/50 px-3 py-2 text-sm font-medium text-rose-300" type="button" onClick={rejectDraft}>Reject</button>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-400">No drafts available.</p>
        )}

        {savedMessage && <p className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{savedMessage}</p>}
      </aside>
    </div>
  );
}

export type MirrorKind = "job-ui" | "approvals" | "activity" | "application-status";

export async function mirrorState(kind: MirrorKind, payload: unknown) {
  if (typeof window === "undefined") return;
  try {
    await fetch(`/api/mirror/${kind}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // best-effort mirror only
  }
}

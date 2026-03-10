import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

type TimelineItem = {
  ts: string;
  kind: "prompt" | "tool" | "tool_result" | "assistant" | "error" | "usage";
  label: string;
  detail?: string;
};

type JsonObj = Record<string, unknown>;

function sessionFile(id: string) {
  return path.join(process.env.HOME || "/home/steve", ".openclaw", "agents", "main", "sessions", `${id}.jsonl`);
}

function asObj(v: unknown): JsonObj {
  return v && typeof v === "object" ? (v as JsonObj) : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function safeString(v: unknown) {
  return typeof v === "string" ? v : "";
}

function extractTextContent(content: unknown): string {
  const parts = asArray(content)
    .map((entry) => {
      const c = asObj(entry);
      const type = safeString(c.type);
      if (type === "text") return safeString(c.text);
      if (type === "thinking") return safeString(c.thinking);
      return "";
    })
    .filter(Boolean);
  return parts.join("\n").trim();
}

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const raw = await fs.readFile(sessionFile(id), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const items: TimelineItem[] = [];

    for (const line of lines) {
      let rowUnknown: unknown;
      try {
        rowUnknown = JSON.parse(line);
      } catch {
        continue;
      }

      const row = asObj(rowUnknown);
      const ts = safeString(row.timestamp) || new Date().toISOString();
      if (safeString(row.type) !== "message") continue;

      const message = asObj(row.message);
      const role = safeString(message.role);

      if (role === "user") {
        const detail = extractTextContent(message.content).slice(0, 1200);
        items.push({ ts, kind: "prompt", label: "Prompt", detail });
      }

      if (role === "assistant") {
        const content = asArray(message.content);
        const assistantText = content
          .map((entry) => asObj(entry))
          .filter((c) => safeString(c.type) === "text")
          .map((c) => safeString(c.text))
          .join("\n")
          .trim();

        if (assistantText) {
          items.push({ ts, kind: "assistant", label: "Assistant response", detail: assistantText.slice(0, 1200) });
        }

        content
          .map((entry) => asObj(entry))
          .filter((c) => safeString(c.type) === "toolCall")
          .forEach((c) => {
            items.push({
              ts,
              kind: "tool",
              label: `Tool used: ${safeString(c.name)}`,
              detail: JSON.stringify(c.arguments ?? {}, null, 2).slice(0, 800),
            });
          });

        const usage = asObj(message.usage);
        if (Object.keys(usage).length) {
          const input = Number(usage.input || 0);
          const output = Number(usage.output || 0);
          const total = Number(usage.totalTokens || input + output);
          items.push({
            ts,
            kind: "usage",
            label: "Usage snapshot",
            detail: `input=${input.toLocaleString()} output=${output.toLocaleString()} total=${total.toLocaleString()}`,
          });
        }
      }

      if (role === "toolResult") {
        const toolName = safeString(message.toolName);
        const contentText = extractTextContent(message.content).slice(0, 800);
        const details = asObj(message.details);
        const detailsText = safeString(details.error);
        const isError = /error|failed|not found|exception|denied|timeout/i.test(contentText + " " + detailsText);
        items.push({
          ts,
          kind: isError ? "error" : "tool_result",
          label: `${isError ? "Tool error" : "Tool result"}: ${toolName || "unknown"}`,
          detail: (detailsText || contentText || "(no output)").slice(0, 1000),
        });
      }
    }

    return NextResponse.json({ sessionId: id, items });
  } catch (error) {
    return NextResponse.json({ sessionId: id, items: [], error: error instanceof Error ? error.message : "failed" });
  }
}

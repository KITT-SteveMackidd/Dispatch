import { promises as fs } from "fs";
import path from "path";

const CORE_FILE_ORDER = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
  "HEARTBEAT.md",
] as const;

async function safeRead(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "File not found.";
  }
}

async function listMemoryMarkdownFiles(memoryDir: string) {
  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

export default async function CoreFilesPage() {
  const workspaceRoot = path.join(process.cwd(), "..");

  const coreFiles = await Promise.all(
    CORE_FILE_ORDER.map(async (name) => ({
      name,
      content: await safeRead(path.join(workspaceRoot, name)),
    }))
  );

  const memoryDir = path.join(workspaceRoot, "memory");
  const memoryFiles = await listMemoryMarkdownFiles(memoryDir);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-2xl font-semibold">Core Files (Read Only)</h2>
        <p className="mt-2 text-sm text-zinc-300">
          Live read-only view of key markdown files from your workspace root plus the memory
          folder index.
        </p>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="text-xl font-semibold">memory/ (folder index)</h3>
        {memoryFiles.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No markdown files found in memory/.</p>
        ) : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-200">
            {memoryFiles.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
      </section>

      {coreFiles.map((file) => (
        <section key={file.name} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="text-xl font-semibold">{file.name}</h3>
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-200">
            {file.content}
          </pre>
        </section>
      ))}
    </div>
  );
}

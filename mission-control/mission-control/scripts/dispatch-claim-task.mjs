#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";

const CANDIDATE_DATA_DIRS = [
  path.resolve(process.cwd(), "mission-control", "mission-control", "data"),
  path.resolve(process.cwd(), "mission-control", "data"),
  path.resolve(process.cwd(), "data"),
];

async function resolveDataDir() {
  for (const dir of CANDIDATE_DATA_DIRS) {
    try {
      const st = await fs.stat(path.join(dir, "dispatch-todos.json"));
      if (st.isFile()) return dir;
    } catch {
      // try next candidate
    }
  }
  throw new Error("Could not locate dispatch-todos.json in expected Mission Control data paths.");
}

function parseArgs(argv) {
  const parsed = {
    agent: "DispatchBot",
    reasonPrefix: "Claimed by automation",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--agent" && next) {
      parsed.agent = next;
      i += 1;
      continue;
    }

    if (token === "--reason-prefix" && next) {
      parsed.reasonPrefix = next;
      i += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      return parsed;
    }
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLock(lockPath, task, timeoutMs = 10_000) {
  const startedAt = Date.now();

  while (true) {
    try {
      const lockHandle = await fs.open(lockPath, "wx");
      try {
        return await task();
      } finally {
        await lockHandle.close();
        await fs.unlink(lockPath).catch(() => {});
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockPath}`);
      }
      await sleep(120);
    }
  }
}

function formatNowIso() {
  return new Date().toISOString();
}

function buildActivityEvent(taskId, agent, ts) {
  const stamp = ts.replace(/[-:.]/g, "").slice(0, 15) + "Z";
  return {
    id: `evt-dispatch-claim-${taskId.toLowerCase()}-${stamp}`,
    ts,
    agent: "KITT",
    state: "working",
    zone: "computer",
    task: `Dispatch automation claim: ${agent} claimed ${taskId} and marked it In Progress.`,
  };
}

async function claimNextBacklogTask({ agent, reasonPrefix }) {
  const dataDir = await resolveDataDir();
  const todosPath = path.join(dataDir, "dispatch-todos.json");
  const activityPath = path.join(dataDir, "activity.json");
  const lockPath = path.join(dataDir, ".dispatch-todos.lock");

  return withLock(lockPath, async () => {
    const rawTodos = await fs.readFile(todosPath, "utf8");
    const todos = JSON.parse(rawTodos);

    if (!Array.isArray(todos)) {
      throw new Error("dispatch-todos.json is not an array");
    }

    const idx = todos.findIndex((item) => {
      const status = String(item?.status || "").trim().toLowerCase();
      return status === "backlog" || status === "to do" || status === "todo";
    });
    if (idx === -1) {
      return { claimed: false, task: null };
    }

    const ts = formatNowIso();
    const task = todos[idx];
    const updatedTask = {
      ...task,
      status: "In Progress",
      statusReason: `${reasonPrefix}: ${agent} at ${ts}`,
    };

    todos[idx] = updatedTask;
    await fs.writeFile(todosPath, `${JSON.stringify(todos, null, 2)}\n`, "utf8");

    const rawActivity = await fs.readFile(activityPath, "utf8").catch(() => "[]");
    const activity = JSON.parse(rawActivity);
    const nextActivity = Array.isArray(activity) ? activity : [];
    nextActivity.push(buildActivityEvent(updatedTask.id, agent, ts));
    await fs.writeFile(activityPath, `${JSON.stringify(nextActivity, null, 2)}\n`, "utf8");

    return { claimed: true, task: updatedTask };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Usage: node mission-control/scripts/dispatch-claim-task.mjs [options]

Options:
  --agent <name>            Agent name written into statusReason.
  --reason-prefix <text>    Prefix for statusReason.
  -h, --help                Show this help.
`);
    return;
  }

  const result = await claimNextBacklogTask({
    agent: args.agent,
    reasonPrefix: args.reasonPrefix,
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

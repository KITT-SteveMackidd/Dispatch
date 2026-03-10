import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

const allowedKinds = new Set(["job-ui", "approvals", "activity", "application-status"]);

function filePathFor(kind: string) {
  return path.join(process.cwd(), "data", `${kind}.json`);
}

async function ensureDir() {
  await fs.mkdir(path.join(process.cwd(), "data"), { recursive: true });
}

export async function GET(_: NextRequest, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!allowedKinds.has(kind)) {
    return NextResponse.json({ error: "unsupported kind" }, { status: 400 });
  }

  const filePath = filePathFor(kind);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json(kind === "application-status" ? {} : []);
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  if (!allowedKinds.has(kind)) {
    return NextResponse.json({ error: "unsupported kind" }, { status: 400 });
  }

  const body = await req.json();
  await ensureDir();
  await fs.writeFile(filePathFor(kind), JSON.stringify(body, null, 2), "utf8");

  return NextResponse.json({ ok: true });
}

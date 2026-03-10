import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

export async function GET() {
  const filePath = path.join(process.cwd(), "data", "resume-template.txt");
  try {
    const text = await fs.readFile(filePath, "utf8");
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ text: "" });
  }
}

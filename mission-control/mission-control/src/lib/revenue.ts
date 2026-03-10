export type RevenueChannel = "Digital PDFs/Guides" | "Template/Toolkit Packs" | "POD (shirts/mugs)" | "Affiliate/Tools" | "Other";

export const REVENUE_CHANNELS: RevenueChannel[] = [
  "Digital PDFs/Guides",
  "Template/Toolkit Packs",
  "POD (shirts/mugs)",
  "Affiliate/Tools",
  "Other",
];

export type RevenueEntry = {
  id: string;
  date: string;
  channel: RevenueChannel;
  source: string;
  amount: number;
};

export const REVENUE_STORAGE_KEY = "mission-control.revenue.entries.v1";

export const defaultRevenueEntries: RevenueEntry[] = [];

export function loadRevenueEntries(): RevenueEntry[] {
  if (typeof window === "undefined") return defaultRevenueEntries;
  const raw = window.localStorage.getItem(REVENUE_STORAGE_KEY);
  if (!raw) return defaultRevenueEntries;

  try {
    const parsed = JSON.parse(raw) as RevenueEntry[];
    return Array.isArray(parsed) ? parsed : defaultRevenueEntries;
  } catch {
    return defaultRevenueEntries;
  }
}

export function saveRevenueEntries(entries: RevenueEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REVENUE_STORAGE_KEY, JSON.stringify(entries));
}

"use client";

import { useMemo, useState } from "react";
import {
  REVENUE_CHANNELS,
  RevenueChannel,
  RevenueEntry,
  loadRevenueEntries,
  saveRevenueEntries,
} from "@/lib/revenue";

type DateFilter = "all" | "week" | "month" | "60d";

function inRange(dateIso: string, filter: DateFilter) {
  if (filter === "all") return true;
  const now = new Date();
  const dt = new Date(dateIso);
  const diffMs = now.getTime() - dt.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (filter === "week") return diffMs <= 7 * dayMs;
  if (filter === "month") return diffMs <= 30 * dayMs;
  return diffMs <= 60 * dayMs;
}

function toCsv(rows: RevenueEntry[]) {
  const header = "date,channel,source,amount";
  const lines = rows.map((r) => {
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    return [esc(r.date), esc(r.channel), esc(r.source), r.amount.toFixed(2)].join(",");
  });
  return [header, ...lines].join("\n");
}

export default function RevenuePage() {
  const [entries, setEntries] = useState<RevenueEntry[]>(() => loadRevenueEntries());
  const [source, setSource] = useState("");
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<RevenueChannel>("Digital PDFs/Guides");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSource, setEditSource] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editChannel, setEditChannel] = useState<RevenueChannel>("Digital PDFs/Guides");

  const filtered = useMemo(
    () => entries.filter((e) => inRange(e.date, dateFilter)),
    [entries, dateFilter]
  );

  const totalFiltered = useMemo(
    () => filtered.reduce((sum, e) => sum + e.amount, 0),
    [filtered]
  );

  const totalAll = useMemo(
    () => entries.reduce((sum, e) => sum + e.amount, 0),
    [entries]
  );

  const addRevenue = () => {
    const value = Number(amount);
    if (!source.trim() || !Number.isFinite(value) || value <= 0) return;

    const next: RevenueEntry[] = [
      {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        channel,
        source: source.trim(),
        amount: value,
      },
      ...entries,
    ];

    setEntries(next);
    saveRevenueEntries(next);
    setSource("");
    setAmount("");
  };

  const removeEntry = (id: string) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    saveRevenueEntries(next);
  };

  const startEdit = (entry: RevenueEntry) => {
    setEditingId(entry.id);
    setEditSource(entry.source);
    setEditAmount(String(entry.amount));
    setEditChannel(entry.channel);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const value = Number(editAmount);
    if (!editSource.trim() || !Number.isFinite(value) || value <= 0) return;

    const next = entries.map((e) =>
      e.id === editingId
        ? { ...e, source: editSource.trim(), amount: value, channel: editChannel }
        : e
    );

    setEntries(next);
    saveRevenueEntries(next);
    setEditingId(null);
  };

  const exportCsv = () => {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `revenue-${dateFilter}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-2xl font-semibold">Revenue Tracker</h2>
        <p className="mt-2 text-sm text-zinc-300">Log, edit, delete, filter, and export your real revenue data.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-400">Total (All Time)</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-300">${totalAll.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-400">Total (Filtered)</p>
            <p className="mt-1 text-2xl font-semibold">${totalFiltered.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-400">Entries (All)</p>
            <p className="mt-1 text-2xl font-semibold">{entries.length}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-400">Entries (Filtered)</p>
            <p className="mt-1 text-2xl font-semibold">{filtered.length}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="text-xl font-semibold">Add Revenue</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <input
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            placeholder="Revenue source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <select
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            value={channel}
            onChange={(e) => setChannel(e.target.value as RevenueChannel)}
          >
            {REVENUE_CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
          <button
            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950"
            onClick={addRevenue}
            type="button"
          >
            Add Revenue
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xl font-semibold">Revenue Log</h3>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            >
              <option value="all">All time</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
              <option value="60d">Last 60 days</option>
            </select>
            <button
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm hover:border-zinc-500"
              onClick={exportCsv}
              type="button"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 text-zinc-400">{new Date(entry.date).toLocaleString()}</td>
                  <td className="px-3 py-2">{entry.source}</td>
                  <td className="px-3 py-2 text-zinc-300">{entry.channel}</td>
                  <td className="px-3 py-2 font-medium text-emerald-300">${entry.amount.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button className="rounded-md border border-zinc-700 px-2 py-1 text-xs" onClick={() => startEdit(entry)} type="button">Edit</button>
                      <button className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-300" onClick={() => removeEntry(entry.id)} type="button">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p className="mt-3 text-sm text-zinc-500">No entries in this date filter.</p>}
        </div>
      </section>

      {editingId && (
        <section className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
          <h3 className="text-xl font-semibold">Edit Revenue Entry</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <input className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" value={editSource} onChange={(e) => setEditSource(e.target.value)} />
            <select className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" value={editChannel} onChange={(e) => setEditChannel(e.target.value as RevenueChannel)}>
              {REVENUE_CHANNELS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} inputMode="decimal" />
            <div className="flex gap-2">
              <button className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950" onClick={saveEdit} type="button">Save</button>
              <button className="rounded-lg border border-zinc-700 px-3 py-2 text-sm" onClick={() => setEditingId(null)} type="button">Cancel</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

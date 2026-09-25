import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

// Exercise the real service save functions without loading Firebase or device SDKs.
function fixture({ failCommit = false } = {}) {
  const documents = new Map([
    ["users/manager", { organizationId: "org", role: "manager" }],
  ]);
  const commits = [];
  let sequence = 0;
  const firestore = {
    collection: (_db, collection) => ({ collection }),
    doc: (source, collection, id) =>
      collection
        ? { collection, id }
        : { collection: source.collection, id: "event-" + ++sequence },
    serverTimestamp: () => ({ serverTimestamp: true }),
    getDoc: async (ref) => ({
      exists: () => documents.has(ref.collection + "/" + ref.id),
      data: () => documents.get(ref.collection + "/" + ref.id),
    }),
    addDoc: async (ref, value) => {
      const id = "template-" + ++sequence;
      documents.set(ref.collection + "/" + id, structuredClone(value));
      return { id };
    },
    updateDoc: async (ref, value) => {
      const key = ref.collection + "/" + ref.id;
      documents.set(key, { ...documents.get(key), ...structuredClone(value) });
    },
    writeBatch: () => {
      const writes = [];
      return {
        set: (ref, value) =>
          writes.push({ ref, value: structuredClone(value) }),
        commit: async () => {
          if (failCommit) throw new Error("Mock batch rejected");
          commits.push(writes);
          writes.forEach(({ ref, value }) =>
            documents.set(ref.collection + "/" + ref.id, value),
          );
        },
      };
    },
  };
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const module = { exports: {} };
    cache.set(relative, module.exports);
    const code = ts.transpileModule(
      readFileSync(path.join(root, relative), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText;
    const localRequire = (specifier) => {
      if (specifier === "firebase/firestore") return firestore;
      if (specifier === "@/lib/firebase") return { db: {} };
      if (
        [
          "@/lib/event-recurrence",
          "@/lib/event-schedule",
          "@/lib/firestore-event-data",
        ].includes(specifier)
      )
        return load(specifier.slice(2) + ".ts");
      if (specifier.startsWith("@/") || specifier.startsWith("firebase/"))
        return {};
      return require(specifier);
    };
    new Function("require", "module", "exports", code)(
      localRequire,
      module,
      module.exports,
    );
    return module.exports;
  }
  return { service: load("services/dispatch.ts"), documents, commits };
}

const role = {
  id: "crew",
  name: "Crew",
  tasks: [
    {
      id: "doors",
      name: "Open doors",
      description: "Check tickets",
      expectedOffsetMinutes: 30,
      notifyManagerWhenOverdue: false,
    },
  ],
};
const input = {
  managerId: "manager",
  name: "Rehearsal",
  date: "2026-09-21",
  time: "19:00",
  endTime: "01:00",
  description: "",
  location: "Fixture theatre",
  locationPlaceId: "fixture",
  roles: [role],
};
const recurrence = {
  frequency: "weekly",
  interval: 1,
  end: { type: "count", count: 3 },
};

test("mobile saves every occurrence in one batch with distinct deadlines and clean completion state", async () => {
  const { service, commits, documents } = fixture();
  const events = await service.createDispatchEventSeries({
    ...input,
    recurrence,
  });
  assert.equal(events.length, 3);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].length, 3);
  assert.equal(new Set(events.map((event) => event.id)).size, 3);
  for (const [index, event] of events.entries()) {
    assert.equal(event.seriesId, events[0].id);
    assert.equal(event.seriesIndex, index);
    assert.equal(event.organizationId, "org");
    assert.equal(event.seriesCount, 3);
    assert.equal(
      Date.parse(event.endsAt) - Date.parse(event.startsAt),
      6 * 3600000,
    );
    assert.equal(
      Date.parse(event.roles[0].tasks[0].dueAt) - Date.parse(event.startsAt),
      30 * 60000,
    );
    assert.equal(event.roles[0].tasks[0].description, "Check tickets");
    assert.equal(event.roles[0].tasks[0].notifyManagerWhenOverdue, false);
    assert.deepEqual(event.roles[0].tasks[0].completedBy, []);
    assert.equal(documents.has("events/" + event.id), true);
  }
  events[0].roles[0].tasks[0].completedBy.push("worker");
  assert.deepEqual(events[1].roles[0].tasks[0].completedBy, []);
});

test("mobile one-off creation keeps its existing return contract", async () => {
  const { service, commits } = fixture();
  const event = await service.createDispatchEvent(input);
  assert.equal(typeof event.id, "string");
  assert.equal(event.seriesId, undefined);
  assert.equal(commits[0].length, 1);
});

test("invalid mobile series do not write anything", async () => {
  const { service, documents, commits } = fixture();
  await assert.rejects(
    service.createDispatchEventSeries({
      ...input,
      recurrence: { ...recurrence, end: { type: "count", count: 101 } },
    }),
    /100/,
  );
  assert.equal(documents.size, 1);
  assert.equal(commits.length, 0);
});

test("a rejected mobile batch leaves no partial series", async () => {
  const { service, documents } = fixture({ failCommit: true });
  await assert.rejects(
    service.createDispatchEventSeries({ ...input, recurrence }),
    /Mock batch rejected/,
  );
  assert.equal(documents.size, 1);
});

test("mobile template repeats persist without creating events and reject date endings", async () => {
  const { service, documents, commits } = fixture();
  const id = await service.createEventTemplate("manager", {
    name: "Crew",
    roles: [role],
    defaultRecurrence: recurrence,
  });
  assert.deepEqual(
    documents.get("eventTemplates/" + id).defaultRecurrence,
    recurrence,
  );
  await service.updateEventTemplate({
    managerId: "manager",
    templateId: id,
    input: { name: "Crew edit", roles: [role] },
  });
  assert.deepEqual(
    documents.get("eventTemplates/" + id).defaultRecurrence,
    recurrence,
  );
  await service.updateEventTemplate({
    managerId: "manager",
    templateId: id,
    input: { name: "Crew edit", roles: [role], defaultRecurrence: null },
  });
  assert.equal(documents.get("eventTemplates/" + id).defaultRecurrence, null);
  await assert.rejects(
    service.createEventTemplate("manager", {
      name: "Invalid",
      roles: [role],
      defaultRecurrence: {
        ...recurrence,
        end: { type: "date", date: "2026-12-01" },
      },
    }),
    /Templates/,
  );
  assert.equal(commits.length, 0);
  assert.equal(
    [...documents.keys()].some((key) => key.startsWith("events/")),
    false,
  );
});

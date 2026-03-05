# HEARTBEAT.md

Heartbeat operations for Dispatch execution:

1. Read `dispatch/DISPATCH_BIBLE.md` first (this is the canonical product spec).
2. Spawn 2 non-threaded agents. Each agent must **self-claim** exactly one backlog task before coding by running:
   - `node mission-control/scripts/dispatch-claim-task.mjs --agent "<agent-name>"`
   - If output is `{"claimed":false,...}` there is nothing to do; agent exits.
3. After claiming, each agent implements only its claimed task from the bible, runs tests/lint/build relevant to changed code, then merges directly into `master` and pushes to GitHub (no PR creation).
4. Keep task status updated in `mission-control/data/dispatch-todos.json` (`In Progress`, `Done`, `Blocked`) with clear `statusReason`.
5. Log real activity to Mission Control activity mirror (`mission-control/data/activity.json`).
6. If no actionable task exists for both agents, reply HEARTBEAT_OK.

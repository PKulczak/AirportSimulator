# Implementation History

A running log of changes made while working through [nextSteps.md](nextSteps.md). Newest
entries go at the **top**. One entry per shipped slice (or per meaningful standalone
change). Keep entries factual and specific — what changed, where, and how it was verified.

## Entry format

```
## YYYY-MM-DD — <Slice ref or short title>

**Slice:** <e.g. 1.1 — Poll the history list> (or "n/a" for ad-hoc work)
**Status:** Done | In progress | Reverted

**Changes**
- <file/path> — <what changed and why>

**Verification**
- <how it was tested: pytest command + result, manual steps, etc.>

**Notes**
- <follow-ups, caveats, deviations from the plan, or "none">
```

---

<!-- Add new entries below this line, newest first. -->

## 2026-07-28 — Backlog + tracking docs created

**Slice:** n/a (planning)
**Status:** Done

**Changes**
- [nextSteps.md](nextSteps.md) — created the feature backlog, organised into 12 epics of
  independently testable vertical slices.
- [implementationHistory.md](implementationHistory.md) — created this change log.

**Verification**
- n/a (documentation only).

**Notes**
- No code changes yet. First planned slice: **1.1 — Poll the history list**.

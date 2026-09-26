import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecordActivation,
  buildWorkflowActivation,
  evaluateCel,
  evaluateExpressionValueTemplate,
  parseMarkdownRecord
} from "../dist/index.js";

const record = parseMarkdownRecord(
  "tasks/open.md",
  `---
type: task
title: Open task
due: "2026-06-20"
created: "2026-06-19T22:30:00+10:00"
priority: 3
estimate: 1.5
tags: [project/alpha, urgent]
metadata: {}
---
Body mentions runtime and #body/tag.

\`\`\`
#ignored
\`\`\`
`
);

const activation = buildRecordActivation(record, {
  readDefaults: { status: "open" },
  dateTimeFields: ["created"]
});

function value(expression, options) {
  const result = evaluateCel(expression, activation, options);
  assert.deepEqual(result.diagnostics, [], `${expression}: ${JSON.stringify(result.diagnostics)}`);
  return result.value;
}

function evaluationError(expression, options) {
  const result = evaluateCel(expression, activation, options);
  assert.equal(result.valid, true);
  assert.equal(result.value, null);
  assert.equal(result.diagnostics[0]?.code, "expression_evaluation_error", expression);
}

test("builds the record activation without note or present namespaces", () => {
  assert.equal(activation.status, "open");
  assert.equal(activation.record.status, "open");
  assert.equal(Object.hasOwn(activation.raw, "status"), false);
  assert.equal(Object.hasOwn(activation, "note"), false);
  assert.equal(Object.hasOwn(activation, "present"), false);
  assert.equal(activation.file.path, "tasks/open.md");
  assert.deepEqual(activation.file.tags, ["body/tag", "project/alpha", "urgent"]);
});

test("has() distinguishes persisted and effective presence", () => {
  assert.equal(value("!has(raw.status) && has(record.status)"), true);
});

test("missing top-level fields are null but missing map keys are errors", () => {
  assert.equal(value("assignee == null"), true);
  evaluationError('raw.status == "open"');
  evaluationError("metadata.owner == 1");
});

test("logical operators absorb errors commutatively", () => {
  assert.equal(value('raw.status == "open" || true'), true);
  assert.equal(value('false && raw.status == "open"'), false);
});

test("optional selection gives null-safe access", () => {
  assert.equal(value('raw.?status.orValue("none") == "none" && record.?status.hasValue()'), true);
  assert.equal(value('metadata.?owner.orValue("unassigned")'), "unassigned");
});

test("YAML integers are CEL ints and other numbers are doubles", () => {
  assert.equal(value("priority >= 3 && type(priority) == int"), true);
  assert.equal(value("type(estimate) == double && estimate > priority - 2"), true);
});

test("date strings compare chronologically and support calendar methods", () => {
  assert.equal(
    value(
      'due < "2026-07-01" && due.addMonths(1) == "2026-07-20" && due.addDays(11) == "2026-07-01" && ' +
        'due.daysUntil("2026-06-25") == 5 && due.year() == 2026 && due.month() == 6 && due.day() == 20 && ' +
        "due.dayOfWeek() == 6"
    ),
    true
  );
  assert.equal(value('"2026-01-31".addMonths(1) == "2026-02-28" && "2024-02-29".addYears(1) == "2025-02-28"'), true);
  evaluationError('title.addDays(1) == "x"');
});

test("today, date, and startOfDay use the effective timezone", () => {
  const options = { timezone: "Australia/Melbourne", now: new Date("2026-06-20T15:30:00Z") };
  assert.equal(value("today()", options), "2026-06-21");
  assert.equal(value('startOfDay(due) == timestamp("2026-06-19T14:00:00Z")', options), true);
  assert.equal(value('date(timestamp("2026-06-20T15:30:00Z")) == "2026-06-21"', options), true);
  assert.equal(value("now()", options), "2026-06-20T15:30:00Z");
});

test("date-time fields are timestamps and never compare with date strings", () => {
  assert.equal(value('created == timestamp("2026-06-19T12:30:00Z")'), true);
  assert.equal(value('created + duration("36h") == timestamp("2026-06-21T00:30:00Z")'), true);
  assert.equal(value('duration("90m")'), "5400s");
  evaluationError("due < now()");
});

test("file helpers are available as methods", () => {
  assert.equal(value('file.inFolder("tasks") && file.hasTag("project") && !file.hasTag("proj")'), true);
  assert.equal(value('file.body.contains("runtime")'), true);
});

test("explicit null is preserved instead of replaced by read defaults", () => {
  const nullRecord = parseMarkdownRecord("tasks/null-status.md", "---\ntype: task\nstatus:\n---\n");
  const nullActivation = buildRecordActivation(nullRecord, { readDefaults: { status: "open" } });
  assert.equal(evaluateCel("status == null && has(raw.status) && has(record.status)", nullActivation).value, true);
});

test("reserved names are never shadowed by frontmatter", () => {
  const shadowRecord = parseMarkdownRecord("notes/shadow.md", "---\nfile: frontmatter-file\nraw: x\n---\n");
  const shadowActivation = buildRecordActivation(shadowRecord);
  assert.equal(evaluateCel('record.file == "frontmatter-file"', shadowActivation).value, true);
  assert.equal(evaluateCel('file.path == "notes/shadow.md"', shadowActivation).value, true);
  assert.equal(evaluateCel('raw.raw == "x"', shadowActivation).value, true);
});

test("parse errors are compilation diagnostics", () => {
  const result = evaluateCel("status ==", activation);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "expression_compile_error");
});

test("builds workflow activation and evaluates expression templates", () => {
  const workflow = buildWorkflowActivation({
    event: { type: "canvas.drop", data: { file: { path: "tasks/card-001.md" }, zone: { id: "doing" } } },
    steps: { "patch-task-status": { status: "succeeded", output: { path: "tasks/card-001.md" } } }
  });

  assert.equal(evaluateCel('has(event.data.file.path) && event.data.zone.id == "doing"', workflow).value, true);
  assert.equal(evaluateCel('steps["patch-task-status"].status == "succeeded"', workflow).value, true);
  assert.deepEqual(
    evaluateExpressionValueTemplate(
      {
        path: { $expr: "event.data.file.path" },
        patch: { status: { $expr: "event.data.zone.id" }, literal: "event.data.zone.id" }
      },
      workflow
    ),
    { path: "tasks/card-001.md", patch: { status: "doing", literal: "event.data.zone.id" } }
  );
});

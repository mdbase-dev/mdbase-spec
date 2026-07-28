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
tags: [project/alpha, urgent]
---
Body mentions runtime and #body/tag.

\`\`\`
#ignored
\`\`\`
`
);

test("builds the record activation shape passed to CEL", () => {
  const activation = buildRecordActivation(record, {
    knownFields: ["type", "title", "due", "tags", "status"],
    readDefaults: {
      status: "open"
    }
  });

  assert.deepEqual(activation, {
    type: "task",
    title: "Open task",
    due: "2026-06-20",
    tags: ["project/alpha", "urgent"],
    status: "open",
    raw: {
      type: "task",
      title: "Open task",
      due: "2026-06-20",
      tags: ["project/alpha", "urgent"]
    },
    record: {
      type: "task",
      title: "Open task",
      due: "2026-06-20",
      tags: ["project/alpha", "urgent"],
      status: "open"
    },
    note: {
      type: "task",
      title: "Open task",
      due: "2026-06-20",
      tags: ["project/alpha", "urgent"],
      status: "open"
    },
    present: {
      raw: {
        due: true,
        status: false,
        tags: true,
        title: true,
        type: true
      },
      record: {
        due: true,
        status: true,
        tags: true,
        title: true,
        type: true
      },
      note: {
        due: true,
        status: true,
        tags: true,
        title: true,
        type: true
      }
    },
    file: {
      path: "tasks/open.md",
      name: "open.md",
      basename: "open",
      ext: "md",
      folder: "tasks",
      body: "Body mentions runtime and #body/tag.\n\n```\n#ignored\n```\n",
      tags: ["body/tag", "project/alpha", "urgent"],
      links: [],
      embeds: []
    }
  });
});

test("evaluates record expressions through @bufbuild/cel", () => {
  const activation = buildRecordActivation(record, {
    knownFields: ["type", "title", "due", "tags", "status"],
    readDefaults: {
      status: "open"
    }
  });

  assert.deepEqual(evaluateCel('status == "open"', activation), {
    valid: true,
    value: true,
    diagnostics: []
  });
  assert.deepEqual(evaluateCel("present.raw.status == false", activation), {
    valid: true,
    value: true,
    diagnostics: []
  });
  assert.deepEqual(evaluateCel("present.record.status", activation), {
    valid: true,
    value: true,
    diagnostics: []
  });
  assert.deepEqual(evaluateCel('file.inFolder("tasks")', activation), {
    valid: true,
    value: true,
    diagnostics: []
  });
  assert.deepEqual(evaluateCel('file.hasTag("project") && !file.hasTag("proj")', activation), {
    valid: true,
    value: true,
    diagnostics: []
  });
  assert.deepEqual(evaluateCel('file.body.contains("runtime")', activation), {
    valid: true,
    value: true,
    diagnostics: []
  });
});

test("explicit null is preserved instead of replaced by read defaults", () => {
  const nullRecord = parseMarkdownRecord(
    "tasks/null-status.md",
    `---
type: task
title: Null status
status:
---
`
  );
  const activation = buildRecordActivation(nullRecord, {
    knownFields: ["type", "title", "due", "tags", "status"],
    readDefaults: {
      status: "open"
    }
  });

  assert.equal(activation.status, null);
  assert.equal(evaluateCel("status == null", activation).value, true);
  assert.equal(evaluateCel("present.raw.status", activation).value, true);
  assert.equal(evaluateCel("present.record.status", activation).value, true);
});

test("system bindings shadow same-named frontmatter at the top level", () => {
  const shadowRecord = parseMarkdownRecord(
    "notes/shadow.md",
    `---
file: frontmatter-file
present: frontmatter-present
---
`
  );
  const activation = buildRecordActivation(shadowRecord, {
    knownFields: ["file", "present"]
  });

  assert.equal(activation.file.path, "notes/shadow.md");
  assert.equal(activation.record.file, "frontmatter-file");
  assert.equal(activation.record.present, "frontmatter-present");
  assert.equal(evaluateCel('record.file == "frontmatter-file"', activation).value, true);
  assert.equal(evaluateCel('file.path == "notes/shadow.md"', activation).value, true);
});

test("evaluation errors return null with diagnostics", () => {
  const activation = buildRecordActivation(record, {
    knownFields: ["type", "title", "due", "tags", "status"],
    readDefaults: {
      status: "open"
    }
  });
  const result = evaluateCel("missing.field == 1", activation);

  assert.equal(result.valid, true);
  assert.equal(result.value, null);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "expression_evaluation_error");
});

test("builds workflow activation and evaluates expression templates", () => {
  const activation = buildWorkflowActivation({
    event: {
      type: "canvas.drop",
      data: {
        file: {
          path: "tasks/card-001.md"
        },
        zone: {
          id: "doing"
        }
      }
    },
    steps: {
      "patch-task-status": {
        status: "succeeded",
        output: {
          path: "tasks/card-001.md"
        }
      }
    }
  });

  assert.equal(
    evaluateCel('has(event.data.file.path) && event.data.zone.id == "doing"', activation).value,
    true
  );
  assert.equal(evaluateCel('steps["patch-task-status"].status == "succeeded"', activation).value, true);

  assert.deepEqual(
    evaluateExpressionValueTemplate(
      {
        path: {
          $expr: "event.data.file.path"
        },
        patch: {
          status: {
            $expr: "event.data.zone.id"
          },
          literal: "event.data.zone.id"
        }
      },
      activation
    ),
    {
      path: "tasks/card-001.md",
      patch: {
        status: "doing",
        literal: "event.data.zone.id"
      }
    }
  );
});

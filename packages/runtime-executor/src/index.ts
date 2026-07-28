import type {
  ActionOutcome,
  BridgeDescription,
  CloudEvent,
  InteropClient
} from "@callumalpass/mdbase-interop";
import {
  admitWorkflow,
  type RuntimeDiagnostic,
  type RuntimePolicy,
  type RuntimeWorkflow,
  type RuntimeWorkflowStep
} from "@callumalpass/mdbase-runtime";
import {
  buildWorkflowActivation,
  evaluateCel,
  evaluateTemplate
} from "@mdbase/cel-host";

export interface ExecuteRuntimeEventOptions {
  workflow: RuntimeWorkflow;
  trigger_id: string;
  event: CloudEvent;
  bridge: BridgeDescription;
  client: InteropClient;
  policy: RuntimePolicy;
  run_id?: string;
}

export interface RuntimeExecutionResult {
  valid: boolean;
  diagnostics: RuntimeDiagnostic[];
  workflow: string;
  trigger: string;
  status: "succeeded" | "failed" | "skipped";
  steps: StepExecutionResult[];
}

export interface StepExecutionResult {
  id: string;
  action: string;
  status: "succeeded" | "failed" | "skipped";
  input?: unknown;
  output?: unknown;
  outcome?: ActionOutcome;
  diagnostics: RuntimeDiagnostic[];
}

export async function executeRuntimeEvent(
  options: ExecuteRuntimeEventOptions
): Promise<RuntimeExecutionResult> {
  const admission = await admitWorkflow(options);
  if (!admission.valid || !admission.plan) {
    return result(options, "failed", admission.diagnostics, []);
  }
  const trigger = options.workflow.triggers.find(({ id }) => id === options.trigger_id);
  if (!trigger) {
    return result(options, "failed", [diagnostic(
      "trigger_not_found",
      `Workflow ${options.workflow.id} has no trigger ${options.trigger_id}.`
    )], []);
  }
  const runId = options.run_id ?? `run:${options.event.id}:${options.workflow.id}:${trigger.id}`;
  const steps: Record<string, StepExecutionResult> = {};
  const vars = evaluateExpressionValue(
    options.workflow.vars ?? {},
    buildWorkflowActivation({ event: options.event, steps: {}, vars: {} }) as unknown as Record<string, unknown>,
    options.workflow.id
  );
  if (vars.diagnostics.length > 0) {
    return result(options, "failed", vars.diagnostics, []);
  }
  const activation = () => buildWorkflowActivation({
    event: options.event,
    steps,
    vars: vars.value as Record<string, unknown>
  }) as unknown as Record<string, unknown>;
  const condition = evaluateCondition(trigger.if, activation(), trigger.id);
  if (condition.diagnostics.length > 0) {
    return result(options, "failed", condition.diagnostics, []);
  }
  if (!condition.matched) return result(options, "skipped", [], []);

  const executed: StepExecutionResult[] = [];
  for (const [index, step] of options.workflow.steps.entries()) {
    const binding = admission.plan.steps[index];
    const stepResult = await executeStep(
      step,
      binding,
      activation(),
      options.client,
      runId,
      options.event
    );
    steps[step.id] = stepResult;
    executed.push(stepResult);
    if (stepResult.status === "failed" && options.workflow.run?.on_error !== "continue") {
      return result(
        options,
        "failed",
        executed.flatMap(({ diagnostics }) => diagnostics),
        executed
      );
    }
  }
  return result(
    options,
    executed.some(({ status }) => status === "failed") ? "failed" : "succeeded",
    executed.flatMap(({ diagnostics }) => diagnostics),
    executed
  );
}

async function executeStep(
  step: RuntimeWorkflowStep,
  binding: NonNullable<Awaited<ReturnType<typeof admitWorkflow>>["plan"]>["steps"][number],
  activation: Record<string, unknown>,
  client: InteropClient,
  runId: string,
  event: CloudEvent
): Promise<StepExecutionResult> {
  const condition = evaluateCondition(step.if, activation, step.id);
  if (condition.diagnostics.length > 0) {
    return failedStep(step, condition.diagnostics);
  }
  if (!condition.matched) {
    return {
      id: step.id,
      action: step.action.id,
      status: "skipped",
      diagnostics: []
    };
  }
  if (step.for_each) {
    return failedStep(step, [diagnostic(
      "unsupported_for_each",
      "The reference non-durable executor does not implement for_each; durable hosts must implement deterministic ordered iteration."
    )]);
  }

  const evaluated = evaluateExpressionValue(step.input ?? {}, activation, step.id);
  if (evaluated.diagnostics.length > 0) return failedStep(step, evaluated.diagnostics);
  const outcome = await client.invokeAction({
    request_id: `${runId}:${step.id}`,
    contract: binding.contract,
    correlation_id: event.correlationid ?? runId,
    causation_id: event.id,
    subject: event.subject,
    idempotency_key: `${runId}:${step.id}`,
    requested_provider: {
      application: binding.provider.application,
      implementation: binding.provider.implementation,
      ...(binding.provider.instance_id ? { instance_id: binding.provider.instance_id } : {})
    },
    input: evaluated.value
  });
  if (outcome.status !== "succeeded") {
    return failedStep(step, [diagnostic(
      outcome.error.code,
      outcome.error.message,
      outcome.error.details
    )], evaluated.value, outcome);
  }
  return {
    id: step.id,
    action: step.action.id,
    status: "succeeded",
    input: evaluated.value,
    output: outcome.output,
    outcome,
    diagnostics: []
  };
}

function evaluateCondition(
  condition: { $expr: string } | undefined,
  activation: Record<string, unknown>,
  source: string
): { matched: boolean; diagnostics: RuntimeDiagnostic[] } {
  if (!condition) return { matched: true, diagnostics: [] };
  const evaluated = evaluateCel(condition.$expr, activation as Parameters<typeof evaluateCel>[1]);
  return {
    matched: evaluated.value === true,
    diagnostics: evaluated.diagnostics.map((item) => diagnostic(item.code, item.message, { source }))
  };
}

function evaluateExpressionValue(
  value: unknown,
  activation: Record<string, unknown>,
  source: string
): { value: unknown; diagnostics: RuntimeDiagnostic[] } {
  const diagnostics: RuntimeDiagnostic[] = [];
  const evaluated = evaluateTemplate(value, activation, (expr, nestedActivation) => {
    const evaluatedExpression = evaluateCel(
      expr,
      nestedActivation as Parameters<typeof evaluateCel>[1]
    );
    diagnostics.push(...evaluatedExpression.diagnostics.map((item) =>
      diagnostic(item.code, item.message, { source })
    ));
    return evaluatedExpression.value;
  });
  return { value: evaluated, diagnostics };
}

function failedStep(
  step: RuntimeWorkflowStep,
  diagnostics: RuntimeDiagnostic[],
  input?: unknown,
  outcome?: ActionOutcome
): StepExecutionResult {
  return {
    id: step.id,
    action: step.action.id,
    status: "failed",
    ...(input === undefined ? {} : { input }),
    ...(outcome === undefined ? {} : { outcome }),
    diagnostics
  };
}

function result(
  options: ExecuteRuntimeEventOptions,
  status: RuntimeExecutionResult["status"],
  diagnostics: RuntimeDiagnostic[],
  steps: StepExecutionResult[]
): RuntimeExecutionResult {
  return {
    valid: !diagnostics.some(({ severity }) => severity === "error"),
    workflow: options.workflow.id,
    trigger: options.trigger_id,
    status,
    diagnostics,
    steps
  };
}

function diagnostic(code: string, message: string, details?: unknown): RuntimeDiagnostic {
  return {
    severity: "error",
    code,
    message,
    ...(details === undefined ? {} : { details })
  };
}

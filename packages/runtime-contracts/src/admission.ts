import { intersects, maxSatisfying, validRange } from "semver";
import { portableDigest } from "@callumalpass/mdbase-interop";
import type {
  ActionProviderDeclaration,
  BridgeDescription,
  CloudEvent,
  ContractRequirement,
  EventSourceDeclaration,
  ExactContractReference,
  ImplementationIdentity,
  ProviderSelector
} from "@callumalpass/mdbase-interop";
import type {
  AdmittedWorkflowPlan,
  RuntimeAdmissionInput,
  RuntimeAdmissionResult,
  RuntimeDiagnostic,
  RuntimePolicy,
  RuntimePreflightPlan,
  RuntimePreflightResult,
  RuntimeWorkflow
} from "./types.js";

export async function preflightWorkflow(
  workflow: RuntimeWorkflow,
  bridge: BridgeDescription,
  policy: RuntimePolicy
): Promise<RuntimePreflightResult> {
  const diagnostics: RuntimeDiagnostic[] = [];
  if (!workflow.enabled) {
    diagnostics.push(error("workflow_disabled", `Workflow ${workflow.id} is disabled.`));
  }
  if (!policy.enabled) {
    diagnostics.push(error("runtime_policy_disabled", `Runtime policy ${policy.id} is disabled.`));
  }
  assertUniqueIds(workflow.triggers, "trigger", diagnostics);
  assertUniqueIds(workflow.steps, "step", diagnostics);
  authorizeCapabilities(
    workflow.requires?.capabilities ?? [],
    undefined,
    undefined,
    policy,
    diagnostics
  );

  const triggers: RuntimePreflightPlan["triggers"] = [];
  for (const trigger of workflow.triggers) {
    const contract = resolveContract(trigger.event, "event", bridge, diagnostics);
    if (!contract) continue;
    const sources = bridge.event_sources.filter((declaration) =>
      declaration.contracts.some((candidate) => sameReference(candidate.resolved, contract))
    );
    if (sources.length === 0) {
      diagnostics.push(error(
        "event_source_unavailable",
        `No verified event source implements ${contract.id} ${contract.version}.`,
        { contract }
      ));
      continue;
    }
    triggers.push({
      trigger_id: trigger.id,
      contract,
      sources: structuredClone(sources)
    });
  }

  const steps: RuntimePreflightPlan["steps"] = [];
  for (const step of workflow.steps) {
    const contract = resolveContract(step.action, "action", bridge, diagnostics);
    if (!contract) continue;
    const candidates = actionCandidates(contract, bridge);
    const selector = step.provider ?? policySelector(step.action, policy, diagnostics);
    const eligible = selector
      ? candidates.filter(({ declaration }) => matchesSelector(declaration.provider, selector))
      : candidates;
    if (eligible.length === 0) {
      diagnostics.push(error(
        selector ? "requested_provider_unavailable" : "no_provider",
        selector
          ? `No verified provider matching the explicit selector implements ${contract.id} ${contract.version}.`
          : `No verified provider implements ${contract.id} ${contract.version}.`,
        { contract, selector }
      ));
      continue;
    }
    if (eligible.length > 1) {
      diagnostics.push(error(
        "ambiguous_provider",
        `${contract.id} ${contract.version} has ${eligible.length} eligible providers; select one in the workflow or runtime policy.`,
        {
          contract,
          providers: eligible.map(({ declaration }) => declaration.provider)
        }
      ));
      continue;
    }
    const [{ declaration, handler }] = eligible;
    authorizeCapabilities(
      step.requires?.capabilities ?? [],
      step.action,
      declaration.provider,
      policy,
      diagnostics
    );
    steps.push({
      id: step.id,
      contract,
      provider: structuredClone(declaration.provider),
      provider_declaration_digest: declaration.declaration_digest,
      handler_id: handler.handler_id,
      handler: structuredClone(handler)
    });
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { valid: false, diagnostics };
  }
  return {
    valid: true,
    diagnostics,
    plan: {
      profile_version: "0.2",
      workflow_revision: await portableDigest(workflow),
      triggers,
      steps
    }
  };
}

export async function admitWorkflow(input: RuntimeAdmissionInput): Promise<RuntimeAdmissionResult> {
  const preflight = await preflightWorkflow(input.workflow, input.bridge, input.policy);
  if (!preflight.valid || !preflight.plan) {
    return { valid: false, diagnostics: preflight.diagnostics };
  }

  const trigger = preflight.plan.triggers.find((candidate) => candidate.trigger_id === input.trigger_id);
  if (!trigger) {
    return invalid(
      "trigger_not_found",
      `Workflow ${input.workflow.id} has no admitted trigger ${input.trigger_id}.`
    );
  }
  const eventContract: ExactContractReference = {
    id: input.event.type,
    version: input.event.mdbasecontractversion,
    digest: input.event.mdbasecontractdigest
  };
  if (!sameReference(trigger.contract, eventContract)) {
    return invalid(
      "event_contract_mismatch",
      `Event ${input.event.id} does not match the contract pinned for trigger ${input.trigger_id}.`,
      { expected: trigger.contract, actual: eventContract }
    );
  }
  const sourceIdentity = eventIdentity(input.event);
  const source = trigger.sources.find((candidate) =>
    sameIdentity(candidate.source, sourceIdentity)
    && candidate.contracts.some((contract) => sameReference(contract.resolved, eventContract))
  );
  if (!source) {
    return invalid(
      "event_source_unavailable",
      `Event ${input.event.id} does not identify an admitted source for ${eventContract.id}.`,
      { source: sourceIdentity, contract: eventContract }
    );
  }

  const plan: AdmittedWorkflowPlan = {
    profile_version: "0.2",
    workflow_revision: preflight.plan.workflow_revision,
    event: {
      contract: eventContract,
      source: sourceIdentity,
      source_declaration_digest: source.declaration_digest
    },
    steps: preflight.plan.steps.map(({ handler: _handler, ...step }) => step)
  };
  return { valid: true, diagnostics: preflight.diagnostics, plan };
}

function resolveContract(
  requirement: ContractRequirement,
  contractType: "event" | "action",
  bridge: BridgeDescription,
  diagnostics: RuntimeDiagnostic[]
): ExactContractReference | undefined {
  if (!validRange(requirement.version)) {
    diagnostics.push(error(
      "invalid_contract_requirement",
      `${requirement.id} has invalid SemVer requirement ${requirement.version}.`
    ));
    return undefined;
  }
  const candidates = bridge.contracts.filter(({ artifact, reference }) =>
    artifact.contract_type === contractType
    && reference.id === requirement.id
    && (requirement.digest === undefined || reference.digest === requirement.digest)
  );
  const version = maxSatisfying(
    candidates.map(({ reference }) => reference.version),
    requirement.version,
    { includePrerelease: true }
  );
  if (!version) {
    diagnostics.push(error(
      "unknown_contract",
      `No ${contractType} contract ${requirement.id} satisfies ${requirement.version}.`,
      { requirement }
    ));
    return undefined;
  }
  const matching = candidates.filter(({ reference }) => reference.version === version);
  const digests = new Set(matching.map(({ reference }) => reference.digest));
  if (digests.size !== 1) {
    diagnostics.push(error(
      "contract_digest_conflict",
      `${requirement.id} ${version} resolves to conflicting digests.`,
      { requirement, digests: [...digests] }
    ));
    return undefined;
  }
  return structuredClone(matching[0].reference);
}

function actionCandidates(contract: ExactContractReference, bridge: BridgeDescription): Array<{
  declaration: ActionProviderDeclaration;
  handler: ActionProviderDeclaration["handlers"][number];
}> {
  return bridge.action_providers.flatMap((declaration) =>
    declaration.handlers
      .filter((handler) => sameReference(handler.resolved, contract))
      .map((handler) => ({ declaration, handler }))
  );
}

function policySelector(
  requirement: ContractRequirement,
  policy: RuntimePolicy,
  diagnostics: RuntimeDiagnostic[]
): ProviderSelector | undefined {
  const matches = (policy.provider_selections ?? []).filter((selection) =>
    selection.contract.id === requirement.id
    && rangesOverlap(selection.contract.version, requirement.version)
  );
  if (matches.length > 1) {
    diagnostics.push(error(
      "ambiguous_provider_policy",
      `Runtime policy ${policy.id} has multiple provider selections for ${requirement.id}.`
    ));
    return undefined;
  }
  return matches[0]?.selector;
}

function authorizeCapabilities(
  capabilities: string[],
  action: ContractRequirement | undefined,
  provider: ImplementationIdentity | undefined,
  policy: RuntimePolicy,
  diagnostics: RuntimeDiagnostic[]
): void {
  for (const capability of capabilities) {
    const matching = policy.grants.filter((grant) =>
      grant.capability === capability
      && (grant.actions === undefined || action !== undefined && grant.actions.some((candidate) =>
        candidate.id === action.id && rangesOverlap(candidate.version, action.version)
      ))
      && (grant.providers === undefined || provider !== undefined && grant.providers.some((selector) =>
        matchesSelector(provider, selector)
      ))
    );
    const allowed = matching.some((grant) => grant.mode === "allow")
      && !matching.some((grant) => grant.mode === "deny");
    if (!allowed) {
      diagnostics.push(error(
        "capability_denied",
        `Runtime policy ${policy.id} does not allow capability ${capability} in this context.`,
        { capability, action, provider }
      ));
    }
  }
}

function rangesOverlap(left: string, right: string): boolean {
  if (!validRange(left) || !validRange(right)) return false;
  return intersects(left, right, { includePrerelease: true });
}

function matchesSelector(identity: ImplementationIdentity, selector: ProviderSelector): boolean {
  return (selector.application === undefined || selector.application === identity.application)
    && (selector.implementation === undefined || selector.implementation === identity.implementation)
    && (selector.instance_id === undefined || selector.instance_id === identity.instance_id);
}

function eventIdentity(event: CloudEvent): ImplementationIdentity {
  return {
    application: event.mdbaseapplication,
    implementation: event.mdbaseimplementation,
    version: event.mdbaseimplementationversion,
    ...(event.mdbaseinstanceid ? { instance_id: event.mdbaseinstanceid } : {})
  };
}

function sameIdentity(left: ImplementationIdentity, right: ImplementationIdentity): boolean {
  return left.application === right.application
    && left.implementation === right.implementation
    && left.version === right.version
    && left.instance_id === right.instance_id;
}

function sameReference(left: ExactContractReference, right: ExactContractReference): boolean {
  return left.id === right.id
    && left.version === right.version
    && left.digest === right.digest;
}

function assertUniqueIds(
  values: Array<{ id: string }>,
  label: string,
  diagnostics: RuntimeDiagnostic[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      diagnostics.push(error(
        `duplicate_${label}_id`,
        `Workflow repeats ${label} ID ${value.id}.`
      ));
    }
    seen.add(value.id);
  }
}

function invalid(code: string, message: string, details?: unknown): RuntimeAdmissionResult {
  return { valid: false, diagnostics: [error(code, message, details)] };
}

function error(code: string, message: string, details?: unknown): RuntimeDiagnostic {
  return {
    severity: "error",
    code,
    message,
    ...(details === undefined ? {} : { details })
  };
}

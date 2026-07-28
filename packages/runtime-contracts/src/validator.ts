import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import { satisfies } from "semver";
import { parse as parseYaml } from "yaml";
import type {
  ActionContract,
  AuthorizationContext,
  CapabilityContract,
  EventContract,
  LoadContractsOptions,
  MarkdownRecord,
  ProviderContract,
  ProviderRequirement,
  RuntimeContractRecord,
  RuntimeCheckpointRecord,
  RuntimeDiagnostic,
  RuntimeDiagnosticRecord,
  RuntimeLoadResult,
  RuntimePackage,
  RuntimePolicyContract,
  RuntimeRecordType,
  RuntimeRegistry,
  RuntimeRunRecord,
  RuntimeTimerRecord,
  ValidationResult,
  WorkflowContract
} from "./types.js";
import { parseMarkdownRecord } from "./markdown.js";
import type { CanonicalSchemas } from "./schemas.js";
import { createAjv, loadCanonicalSchemas } from "./schemas.js";
import { isPlainObject } from "./markdown.js";

const runtimeTypes = new Set<RuntimeRecordType>([
  "provider",
  "action",
  "event",
  "capability",
  "workflow",
  "runtime_policy",
  "runtime_run",
  "runtime_checkpoint",
  "runtime_timer",
  "runtime_diagnostic"
]);

const ignoredDirectories = new Set([".git", ".mdbase", "node_modules", "dist"]);

export class RuntimeContractValidator {
  private readonly validators: Record<string, ValidateFunction>;

  private constructor(
    private readonly schemas: CanonicalSchemas
  ) {
    const ajv = createAjv();
    this.validators = {
      typeFile: ajv.compile(schemas.typeFile),
      provider: ajv.compile(schemas.provider),
      action: ajv.compile(schemas.action),
      event: ajv.compile(schemas.event),
      capability: ajv.compile(schemas.capability),
      workflow: ajv.compile(schemas.workflow),
      runtime_policy: ajv.compile(schemas.runtimePolicy),
      runtime_run: ajv.compile(schemas.run),
      runtime_checkpoint: ajv.compile(schemas.checkpoint),
      runtime_timer: ajv.compile(schemas.timer),
      runtime_diagnostic: ajv.compile(schemas.diagnostic),
      eventEnvelope: ajv.compile(schemas.eventEnvelope)
    };
  }

  static async create(options: LoadContractsOptions = {}): Promise<RuntimeContractValidator> {
    return new RuntimeContractValidator(await loadCanonicalSchemas(options.schemaRoot));
  }

  async loadContracts(collectionRoot: string, options: LoadContractsOptions = {}): Promise<RuntimePackage> {
    const files = await walkMarkdownFiles(collectionRoot);
    const diagnostics: RuntimeDiagnostic[] = [];
    const typeFiles: MarkdownRecord[] = [];
    const records: MarkdownRecord<RuntimeContractRecord>[] = [];
    const providers: MarkdownRecord<ProviderContract>[] = [];
    const actions: MarkdownRecord<ActionContract>[] = [];
    const events: MarkdownRecord<EventContract>[] = [];
    const capabilities: MarkdownRecord<CapabilityContract>[] = [];
    const workflows: MarkdownRecord<WorkflowContract>[] = [];
    const policies: MarkdownRecord<RuntimePolicyContract>[] = [];
    const runs: MarkdownRecord<RuntimeRunRecord>[] = [];
    const checkpoints: MarkdownRecord<RuntimeCheckpointRecord>[] = [];
    const timers: MarkdownRecord<RuntimeTimerRecord>[] = [];
    const runtimeDiagnostics: MarkdownRecord<RuntimeDiagnosticRecord>[] = [];

    for (const absolutePath of files) {
      const path = relative(collectionRoot, absolutePath).replaceAll("\\", "/");
      const parsed = parseMarkdownRecord(path, await readFile(absolutePath, "utf8"));
      diagnostics.push(...parsed.diagnostics);
      if (!parsed.record) {
        continue;
      }

      const frontmatter = parsed.record.frontmatter;
      if (path.startsWith("_types/")) {
        typeFiles.push(parsed.record);
        if (options.includeTypeFiles !== false) {
          diagnostics.push(...this.validateWith("typeFile", frontmatter, path).diagnostics);
        }
        continue;
      }

      const type = frontmatter.type;
      if (typeof type !== "string" || !runtimeTypes.has(type as RuntimeRecordType)) {
        continue;
      }

      const runtimeRecord = parsed.record as MarkdownRecord<RuntimeContractRecord>;
      records.push(runtimeRecord);
      diagnostics.push(...this.validateWith(type, frontmatter, path).diagnostics);
      diagnostics.push(...this.validateEmbeddedSchemas(type as RuntimeRecordType, frontmatter, path).diagnostics);

      switch (type) {
        case "provider":
          providers.push(runtimeRecord as MarkdownRecord<ProviderContract>);
          break;
        case "action":
          actions.push(runtimeRecord as MarkdownRecord<ActionContract>);
          break;
        case "event":
          events.push(runtimeRecord as MarkdownRecord<EventContract>);
          break;
        case "capability":
          capabilities.push(runtimeRecord as MarkdownRecord<CapabilityContract>);
          break;
        case "workflow":
          workflows.push(runtimeRecord as MarkdownRecord<WorkflowContract>);
          break;
        case "runtime_policy":
          policies.push(runtimeRecord as MarkdownRecord<RuntimePolicyContract>);
          break;
        case "runtime_run":
          runs.push(runtimeRecord as MarkdownRecord<RuntimeRunRecord>);
          break;
        case "runtime_checkpoint":
          checkpoints.push(runtimeRecord as MarkdownRecord<RuntimeCheckpointRecord>);
          break;
        case "runtime_timer":
          timers.push(runtimeRecord as MarkdownRecord<RuntimeTimerRecord>);
          break;
        case "runtime_diagnostic":
          runtimeDiagnostics.push(runtimeRecord as MarkdownRecord<RuntimeDiagnosticRecord>);
          break;
      }
    }

    return {
      root: collectionRoot,
      typeFiles,
      records,
      providers,
      actions,
      events,
      capabilities,
      workflows,
      policies,
      runs,
      checkpoints,
      timers,
      runtimeDiagnostics,
      diagnostics
    };
  }

  async loadRuntimeContracts(collectionRoot: string, options: LoadContractsOptions = {}): Promise<RuntimeLoadResult> {
    const runtimePackage = await this.loadContracts(collectionRoot, options);
    const selectedPolicy = await this.resolveSelectedPolicy(collectionRoot, runtimePackage, options);
    const registry = this.composeRegistry(runtimePackage, options.implicitContracts ?? [], selectedPolicy.id);
    registry.diagnostics.push(...selectedPolicy.diagnostics);
    const preflight = this.preflightWorkflows(registry);
    return {
      contracts: runtimePackage,
      registry,
      preflight,
      valid: preflight.valid,
      diagnostics: preflight.diagnostics
    };
  }

  composeRegistry(
    runtimePackage: RuntimePackage,
    implicitContracts: RuntimeContractRecord[] = [],
    selectedPolicyId?: string
  ): RuntimeRegistry {
    const diagnostics: RuntimeDiagnostic[] = [...runtimePackage.diagnostics];
    const registry: RuntimeRegistry = {
      providerContracts: new Map(),
      actions: new Map(),
      events: new Map(),
      capabilities: new Map(),
      capabilityIds: new Set(),
      workflows: new Map(),
      policies: new Map(),
      providers: new Set(),
      selectedPolicyId,
      diagnostics
    };

    for (const contract of implicitContracts) {
      this.addRecordToRegistry(registry, { path: `<implicit:${contract.id}>`, frontmatter: contract, body: "" });
    }
    for (const record of runtimePackage.records) {
      this.addRecordToRegistry(registry, record);
    }

    return registry;
  }

  resolveWorkflowContracts(registry: RuntimeRegistry, workflow: WorkflowContract): ValidationResult {
    const diagnostics: RuntimeDiagnostic[] = [];

    diagnostics.push(...this.resolveRequires(registry, workflow.requires, workflow.id));
    diagnostics.push(...this.validateWorkflowLocalIds(workflow));
    diagnostics.push(...this.validateWorkflowExecutionPolicy(registry, workflow));

    for (const trigger of workflow.triggers ?? []) {
      if (!registry.events.has(trigger.event)) {
        diagnostics.push(unresolved("unresolved_event", trigger.event, workflow.id));
      }
    }

    for (const step of workflow.steps ?? []) {
      const action = registry.actions.get(step.action);
      if (!action) {
        diagnostics.push(unresolved("unresolved_action", step.action, workflow.id));
        continue;
      }

      diagnostics.push(...this.resolveRequires(registry, action.requires, action.id));

      for (const emitted of action.emits ?? []) {
        if (!registry.events.has(emitted)) {
          diagnostics.push(unresolved("unresolved_emitted_event", emitted, action.id));
        }
      }

      diagnostics.push(...this.resolveRequires(registry, step.requires, workflow.id));
    }

    return result(diagnostics);
  }

  preflightWorkflows(registry: RuntimeRegistry): ValidationResult {
    const diagnostics = [...registry.diagnostics];
    diagnostics.push(...this.validateProviderContractListings(registry));
    diagnostics.push(...this.validateRuntimePolicies(registry));
    for (const workflow of registry.workflows.values()) {
      diagnostics.push(...this.resolveWorkflowContracts(registry, workflow).diagnostics);
    }
    return result(diagnostics);
  }

  validateEventEnvelope(registry: RuntimeRegistry, envelope: unknown): ValidationResult {
    const diagnostics = this.validateWith("eventEnvelope", envelope, "<event>").diagnostics;
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return result(diagnostics);
    }

    const eventType = (envelope as { type?: unknown }).type;
    if (typeof eventType !== "string") {
      diagnostics.push({
        severity: "error",
        code: "invalid_event_type",
        message: "Event envelope type must be a string."
      });
      return result(diagnostics);
    }

    const contract = registry.events.get(eventType);
    if (!contract) {
      diagnostics.push({
        severity: "error",
        code: "unresolved_event",
        message: `Event contract ${eventType} was not found.`,
        id: eventType
      });
      return result(diagnostics);
    }

    const contractVersion = (envelope as { contract_version?: unknown }).contract_version;
    if (contractVersion !== contract.version) {
      diagnostics.push({
        severity: "error",
        code: "runtime_contract_version_mismatch",
        message: `Event ${eventType} declares contract version ${String(contractVersion)}, but the registry provides ${String(contract.version)}.`,
        id: eventType,
        details: {
          expected: contract.version,
          actual: contractVersion
        }
      });
    }

    const sourceProvider = (envelope as { source?: { provider?: unknown } }).source?.provider;
    if (typeof sourceProvider === "string" && typeof contract.provider === "string" && sourceProvider !== contract.provider) {
      diagnostics.push({
        severity: "error",
        code: "event_provider_mismatch",
        message: `Event ${eventType} was delivered by provider ${sourceProvider}, but its contract belongs to ${contract.provider}.`,
        id: eventType
      });
    }

    diagnostics.push(
      ...this.validateAgainstSchema(contract.schemas.payload, (envelope as { payload?: unknown }).payload, "<event.payload>").diagnostics
    );
    return result(diagnostics);
  }

  validateActionInput(registry: RuntimeRegistry, actionId: string, input: unknown): ValidationResult {
    const action = registry.actions.get(actionId);
    if (!action) {
      return result([unresolved("unresolved_action", actionId)]);
    }
    return this.validateAgainstSchema(action.schemas.input, input, `<action:${actionId}.input>`);
  }

  validateActionOutput(registry: RuntimeRegistry, actionId: string, output: unknown): ValidationResult {
    const action = registry.actions.get(actionId);
    if (!action) {
      return result([unresolved("unresolved_action", actionId)]);
    }
    if (action.schemas.output == null) {
      return result([]);
    }
    return this.validateAgainstSchema(action.schemas.output, output, `<action:${actionId}.output>`);
  }

  authorizeAction(registry: RuntimeRegistry, actionId: string, context: AuthorizationContext): ValidationResult {
    const action = registry.actions.get(actionId);
    if (!action) {
      return result([unresolved("unresolved_action", actionId)]);
    }

    const capabilities = new Set([...(action.requires?.capabilities ?? []), ...(action.effects ?? [])]);
    if (capabilities.size === 0) {
      return result([]);
    }

    const policy = selectedPolicy(registry);
    if (!policy) {
      return result([{
        severity: "error",
        code: "policy_not_selected",
        message: `Action ${actionId} has effects but no runtime policy is selected.`,
        id: actionId,
        details: { context }
      }]);
    }

    const diagnostics: RuntimeDiagnostic[] = [];
    for (const capability of capabilities) {
      if (policy.capabilities?.[capability]?.mode !== "allow") {
        diagnostics.push({
          severity: "error",
          code: "capability_denied",
          message: `Capability ${capability} is not explicitly allowed by selected policy ${policy.id}.`,
          id: capability,
          details: { policy: policy.id, context }
        });
      }
    }
    return result(diagnostics);
  }

  private validateWith(name: string, value: unknown, path: string): ValidationResult {
    const validate = this.validators[name];
    if (!validate) {
      return result([
        {
          severity: "error",
          code: "unknown_schema",
          message: `Unknown schema ${name}.`,
          path
        }
      ]);
    }
    return this.runValidator(validate, value, path);
  }

  private validateAgainstSchema(schema: Record<string, unknown>, value: unknown, path: string): ValidationResult {
    const ajv = createAjv();
    if (!ajv.validateSchema(schema)) {
      return result(schemaDiagnostics(ajv.errors, path, "invalid_embedded_schema"));
    }
    try {
      return this.runValidator(ajv.compile(schema), value, path);
    } catch (error) {
      return result([
        {
          severity: "error",
          code: "invalid_embedded_schema",
          message: error instanceof Error ? error.message : "Embedded JSON Schema could not be compiled.",
          path
        }
      ]);
    }
  }

  private runValidator(validate: ValidateFunction, value: unknown, path: string): ValidationResult {
    const valid = validate(value);
    if (valid) {
      return result([]);
    }
    return result((validate.errors ?? []).map((error) => toDiagnostic(error, path)));
  }

  private addRecordToRegistry(registry: RuntimeRegistry, record: MarkdownRecord<RuntimeContractRecord>): void {
    const contract = record.frontmatter;
    if (!contract.id || !contract.type) {
      return;
    }

    const target = registryMapFor(registry, contract.type);
    if (!target) {
      return;
    }

    const existing = target.get(contract.id);
    if (existing) {
      if (canonicalJson(existing) === canonicalJson(contract)) {
        return;
      }
      registry.diagnostics.push({
        severity: "error",
        code: "runtime_contract_conflict",
        message: `Conflicting ${contract.type} contract ${contract.id}.`,
        path: record.path,
        id: contract.id,
        details: {
          existingVersion: existing.version,
          newVersion: contract.version
        }
      });
      return;
    }

    target.set(contract.id, contract as never);
    this.addEffectiveIds(registry, contract);
    if (typeof contract.provider === "string" && contract.provider.length > 0) {
      registry.providers.add(contract.provider);
    }
  }

  private addEffectiveIds(registry: RuntimeRegistry, contract: RuntimeContractRecord): void {
    if (contract.type === "provider") {
      registry.providers.add(contract.id);
      const provider = contract as ProviderContract;
      for (const capability of provider.contracts?.capabilities ?? []) {
        registry.capabilityIds.add(capability);
      }
    }

    if (contract.type === "capability") {
      registry.capabilityIds.add(contract.id);
    }

    if (contract.type === "action") {
      const action = contract as ActionContract;
      for (const capability of action.effects ?? []) {
        registry.capabilityIds.add(capability);
      }
      for (const capability of action.requires?.capabilities ?? []) {
        registry.capabilityIds.add(capability);
      }
    }
  }

  private validateEmbeddedSchemas(type: RuntimeRecordType, value: Record<string, unknown>, path: string): ValidationResult {
    const schemas = value.schemas;
    if (!isPlainObject(schemas)) {
      return result([]);
    }

    const diagnostics: RuntimeDiagnostic[] = [];
    if (type === "action") {
      diagnostics.push(...validateEmbeddedJsonSchema(schemas.input, `${path}#/schemas/input`));
      if (schemas.output != null) {
        diagnostics.push(...validateEmbeddedJsonSchema(schemas.output, `${path}#/schemas/output`));
      }
    }
    if (type === "event") {
      diagnostics.push(...validateEmbeddedJsonSchema(schemas.payload, `${path}#/schemas/payload`));
    }
    return result(diagnostics);
  }

  private resolveRequires(
    registry: RuntimeRegistry,
    requires: { capabilities?: string[]; providers?: ProviderRequirement[] } | undefined,
    source: string
  ): RuntimeDiagnostic[] {
    const diagnostics: RuntimeDiagnostic[] = [];
    for (const capability of requires?.capabilities ?? []) {
      if (!registry.capabilityIds.has(capability)) {
        diagnostics.push(unresolved("unresolved_capability", capability, source));
      }
    }
    for (const requirement of requires?.providers ?? []) {
      const providerId = typeof requirement === "string" ? requirement : requirement.id;
      const provider = registry.providerContracts.get(providerId);
      if (!registry.providers.has(providerId)) {
        diagnostics.push(unresolved("unresolved_provider", providerId, source));
        continue;
      }
      if (typeof requirement !== "string") {
        if (!provider || !satisfies(provider.provider_version, requirement.version, { includePrerelease: true })) {
          diagnostics.push({
            severity: "error",
            code: "provider_version_mismatch",
            message: `Provider ${providerId} does not satisfy ${requirement.version}.`,
            id: providerId,
            details: {
              required: requirement.version,
              actual: provider?.provider_version
            }
          });
        }
      }
    }
    return diagnostics;
  }

  private validateWorkflowLocalIds(workflow: WorkflowContract): RuntimeDiagnostic[] {
    const diagnostics: RuntimeDiagnostic[] = [];
    diagnostics.push(...duplicatesById(workflow.triggers ?? [], "duplicate_trigger", workflow.id));
    diagnostics.push(...duplicatesById(workflow.steps ?? [], "duplicate_step", workflow.id));
    return diagnostics;
  }

  private validateProviderContractListings(registry: RuntimeRegistry): RuntimeDiagnostic[] {
    const diagnostics: RuntimeDiagnostic[] = [];
    for (const provider of registry.providerContracts.values()) {
      diagnostics.push(...missingListedContracts(provider.contracts?.events, registry.events, "unresolved_provider_event", provider.id));
      diagnostics.push(...missingListedContracts(provider.contracts?.actions, registry.actions, "unresolved_provider_action", provider.id));
      diagnostics.push(...missingListedContracts(provider.contracts?.workflows, registry.workflows, "unresolved_provider_workflow", provider.id));
      for (const capability of provider.contracts?.capabilities ?? []) {
        if (!registry.capabilityIds.has(capability)) {
          diagnostics.push(unresolved("unresolved_provider_capability", capability, provider.id));
        }
      }
    }
    return diagnostics;
  }

  private validateRuntimePolicies(registry: RuntimeRegistry): RuntimeDiagnostic[] {
    const diagnostics: RuntimeDiagnostic[] = [];
    for (const policy of registry.policies.values()) {
      if (policy.enabled === false) {
        continue;
      }
      for (const workflowId of Object.keys(policy.executors?.workflows ?? {})) {
        if (!registry.workflows.has(workflowId)) {
          diagnostics.push(unresolved("unresolved_policy_workflow", workflowId, policy.id));
        }
      }
      for (const capability of Object.keys(policy.capabilities ?? {})) {
        if (!registry.capabilityIds.has(capability)) {
          diagnostics.push(unresolved("unresolved_policy_capability", capability, policy.id));
        }
      }
    }
    return diagnostics;
  }

  private validateWorkflowExecutionPolicy(registry: RuntimeRegistry, workflow: WorkflowContract): RuntimeDiagnostic[] {
    const diagnostics: RuntimeDiagnostic[] = [];
    if (workflow.run?.execution?.mode === "single_executor" && !selectedExecutorForWorkflow(registry, workflow.id)) {
      diagnostics.push({
        severity: "error",
        code: "executor_not_selected",
        message: `Workflow ${workflow.id} uses single_executor but no enabled runtime policy selects an executor.`,
        id: workflow.id
      });
    }

    const requiredCapabilities = requiredCapabilitiesForWorkflow(registry, workflow);
    if (requiredCapabilities.size > 0 && !selectedPolicy(registry)) {
      diagnostics.push({
        severity: "error",
        code: "policy_not_selected",
        message: `Workflow ${workflow.id} can dispatch effectful actions but no runtime policy is selected.`,
        id: workflow.id
      });
      return diagnostics;
    }

    for (const capability of requiredCapabilities) {
      const policy = capabilityPolicyFor(registry, capability);
      if (policy?.mode === "deny") {
        diagnostics.push({
          severity: "error",
          code: "capability_denied",
          message: `Capability ${capability} is denied by runtime policy.`,
          id: capability
        });
      }
    }
    return diagnostics;
  }

  private async resolveSelectedPolicy(
    collectionRoot: string,
    runtimePackage: RuntimePackage,
    options: LoadContractsOptions
  ): Promise<{ id?: string; diagnostics: RuntimeDiagnostic[] }> {
    if (options.selectedPolicyId) {
      return { id: options.selectedPolicyId, diagnostics: [] };
    }

    let selectedPath = options.selectedPolicyPath;
    if (!selectedPath) {
      try {
        const config = parseYaml(await readFile(join(collectionRoot, "mdbase.yaml"), "utf8")) as {
          runtime?: { policy?: unknown };
        } | null;
        if (typeof config?.runtime?.policy === "string") {
          selectedPath = config.runtime.policy;
        }
      } catch {
        return { diagnostics: [] };
      }
    }

    if (!selectedPath) {
      return { diagnostics: [] };
    }
    const normalizedPath = selectedPath.replaceAll("\\", "/").replace(/^\.\//, "");
    const record = runtimePackage.policies.find((policy) => policy.path === normalizedPath);
    if (!record) {
      return {
        diagnostics: [{
          severity: "error",
          code: "policy_not_selected",
          message: `Selected runtime policy ${normalizedPath} was not found.`,
          path: normalizedPath
        }]
      };
    }
    return { id: record.frontmatter.id, diagnostics: [] };
  }
}

export async function loadContracts(collectionRoot: string, options: LoadContractsOptions = {}): Promise<RuntimePackage> {
  return (await RuntimeContractValidator.create(options)).loadContracts(collectionRoot, options);
}

export async function loadRuntimeContracts(collectionRoot: string, options: LoadContractsOptions = {}): Promise<RuntimeLoadResult> {
  return (await RuntimeContractValidator.create(options)).loadRuntimeContracts(collectionRoot, options);
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await walk(join(directory, entry.name));
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(join(directory, entry.name));
      }
    }
  }
  await walk(root);
  return results.sort();
}

function registryMapFor(registry: RuntimeRegistry, type: RuntimeRecordType): Map<string, RuntimeContractRecord> | undefined {
  switch (type) {
    case "provider":
      return registry.providerContracts as Map<string, RuntimeContractRecord>;
    case "action":
      return registry.actions as Map<string, RuntimeContractRecord>;
    case "event":
      return registry.events as Map<string, RuntimeContractRecord>;
    case "capability":
      return registry.capabilities as Map<string, RuntimeContractRecord>;
    case "workflow":
      return registry.workflows as Map<string, RuntimeContractRecord>;
    case "runtime_policy":
      return registry.policies as Map<string, RuntimeContractRecord>;
    default:
      return undefined;
  }
}

function missingListedContracts<T extends RuntimeContractRecord>(
  ids: string[] | undefined,
  registry: Map<string, T>,
  code: string,
  providerId: string
): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [];
  for (const id of ids ?? []) {
    if (!registry.has(id)) {
      diagnostics.push(unresolved(code, id, providerId));
    }
  }
  return diagnostics;
}

function selectedPolicy(registry: RuntimeRegistry): RuntimePolicyContract | undefined {
  if (!registry.selectedPolicyId) {
    return undefined;
  }
  const policy = registry.policies.get(registry.selectedPolicyId);
  return policy?.enabled === false ? undefined : policy;
}

function selectedExecutorForWorkflow(registry: RuntimeRegistry, workflowId: string): string | undefined {
  const policy = selectedPolicy(registry);
  return policy?.executors?.workflows?.[workflowId] ?? policy?.executors?.default;
}

function capabilityPolicyFor(registry: RuntimeRegistry, capability: string): NonNullable<RuntimePolicyContract["capabilities"]>[string] | undefined {
  return selectedPolicy(registry)?.capabilities?.[capability];
}

function requiredCapabilitiesForWorkflow(registry: RuntimeRegistry, workflow: WorkflowContract): Set<string> {
  const capabilities = new Set<string>();
  for (const capability of workflow.requires?.capabilities ?? []) {
    capabilities.add(capability);
  }
  for (const step of workflow.steps ?? []) {
    for (const capability of step.requires?.capabilities ?? []) {
      capabilities.add(capability);
    }
    const action = registry.actions.get(step.action);
    for (const capability of action?.requires?.capabilities ?? []) {
      capabilities.add(capability);
    }
    for (const capability of action?.effects ?? []) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}

function toDiagnostic(error: ErrorObject, path: string): RuntimeDiagnostic {
  return {
    severity: "error",
    code: `schema_${snakeCaseKeyword(error.keyword)}`,
    message: error.message ?? `Schema validation failed at ${error.instancePath || "/"}.`,
    path,
    field: error.instancePath || undefined,
    details: error.params
  };
}

function snakeCaseKeyword(keyword: string): string {
  return keyword.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function validateEmbeddedJsonSchema(schema: unknown, path: string): RuntimeDiagnostic[] {
  if (!isPlainObject(schema)) {
    return [];
  }
  const ajv = createAjv();
  if (ajv.validateSchema(schema)) {
    return [];
  }
  return schemaDiagnostics(ajv.errors, path, "invalid_embedded_schema");
}

function schemaDiagnostics(errors: ErrorObject[] | null | undefined, path: string, code: string): RuntimeDiagnostic[] {
  return (errors ?? []).map((error) => ({
    severity: "error" as const,
    code,
    message: error.message ?? "Embedded JSON Schema is invalid.",
    path,
    field: error.instancePath || undefined,
    details: error.params
  }));
}

function duplicatesById(values: Array<{ id?: string }>, code: string, source: string): RuntimeDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: RuntimeDiagnostic[] = [];
  for (const value of values) {
    if (typeof value.id !== "string") {
      continue;
    }
    if (seen.has(value.id)) {
      diagnostics.push({
        severity: "error",
        code,
        message: `${value.id} is duplicated in workflow ${source}.`,
        id: value.id
      });
      continue;
    }
    seen.add(value.id);
  }
  return diagnostics;
}

function unresolved(code: string, id: string, source?: string): RuntimeDiagnostic {
  return {
    severity: "error",
    code,
    message: `${id} could not be resolved${source ? ` from ${source}` : ""}.`,
    id
  };
}

function result(diagnostics: RuntimeDiagnostic[]): ValidationResult {
  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

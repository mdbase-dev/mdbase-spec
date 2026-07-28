import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { satisfies, valid } from "semver";
import {
  getEventEnvelopeSchema,
  getProviderRuntimeContractSchemas,
  getProviderSchema,
  type ProviderRuntimeContractType
} from "./canonical-schemas.js";
import type {
  ActionContract,
  AuthorizationContext,
  EventContract,
  ProviderContract,
  ProviderRequirementInput,
  RuntimeContractRecord,
  RuntimeDisposable,
  RuntimeEventEnvelope,
  RuntimeEventHandler,
  RuntimeHost,
  RuntimePolicyInfo,
  RuntimeProvider,
  RuntimeProviderInfo,
  RuntimeProviderRegistration,
  RuntimeRequirements,
  ValidationResult
} from "./types.js";
import { MDBASE_RUNTIME_PROFILE_VERSION } from "./version.js";

interface RegisteredProvider {
  provider: RuntimeProvider;
  descriptor: ProviderContract;
  contracts: RuntimeContractRecord[];
  subscriptions: RuntimeDisposable[];
}

export interface RuntimeHostOptions {
  policy?: RuntimePolicyInfo;
  policyResolver?: () => RuntimePolicyInfo;
  recentEventLimit?: number;
  onDiagnostic?: (diagnostic: RuntimeHostDiagnostic) => void;
}

export interface RuntimeHostDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  providerId?: string;
  contractId?: string;
  cause?: unknown;
}

export const DEFAULT_DENY_RUNTIME_POLICY: RuntimePolicyInfo = {
  id: "mdbase.default-deny",
  selected: true,
  capabilities: {}
};

export class InMemoryRuntimeHost implements RuntimeHost {
  readonly profileVersion = MDBASE_RUNTIME_PROFILE_VERSION;

  private readonly ajv = createHostAjv();
  private readonly providerValidator = this.ajv.compile(getProviderSchema());
  private readonly contractValidators = compileProviderContractValidators(this.ajv);
  private readonly eventEnvelopeValidator = this.ajv.compile(getEventEnvelopeSchema());
  private readonly providerRegistry = new Map<string, RegisteredProvider>();
  private readonly actionOwners = new Map<string, string>();
  private readonly eventOwners = new Map<string, string>();
  private readonly actionValidators = new Map<string, { input: ValidateFunction; output?: ValidateFunction }>();
  private readonly eventValidators = new Map<string, ValidateFunction>();
  private readonly eventHandlers = new Map<string, Set<RuntimeEventHandler>>();
  private readonly recentEventIds = new Set<string>();
  private readonly policyResolver: () => RuntimePolicyInfo;
  private readonly recentEventLimit: number;
  private registrationQueue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: RuntimeHostOptions = {}) {
    if (options.policy && options.policyResolver) {
      throw new RuntimeHostError("invalid_runtime_options", "Specify policy or policyResolver, not both.");
    }
    const fixedPolicy = clone(options.policy ?? DEFAULT_DENY_RUNTIME_POLICY);
    this.policyResolver = options.policyResolver ?? (() => fixedPolicy);
    this.recentEventLimit = Math.max(1, options.recentEventLimit ?? 1000);
  }

  registerProvider(provider: RuntimeProvider): Promise<RuntimeProviderRegistration> {
    const registration = this.registrationQueue.then(() => this.registerProviderAtomic(provider));
    this.registrationQueue = registration.then(() => undefined, () => undefined);
    return registration;
  }

  providers(): RuntimeProviderInfo[] {
    return [...this.providerRegistry.values()]
      .map(({ descriptor, contracts }) => ({
        descriptor: clone(descriptor),
        contracts: clone(contracts)
      }))
      .sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id));
  }

  contracts(): RuntimeContractRecord[] {
    return this.providers().flatMap((provider) => [provider.descriptor, ...provider.contracts]);
  }

  policy(): RuntimePolicyInfo {
    return this.resolvePolicy();
  }

  preflight(requirements: RuntimeRequirements = {}): ValidationResult {
    const diagnostics = [];
    const selectedPolicy = this.resolvePolicy();
    for (const requirement of requirements.providers ?? []) {
      const normalized = normalizeProviderRequirement(requirement);
      const registered = this.providerRegistry.get(normalized.id);
      if (!registered) {
        diagnostics.push(errorDiagnostic("provider_unavailable", `Required provider ${normalized.id} is not registered.`));
        continue;
      }
      if (
        normalized.version &&
        !satisfies(registered.descriptor.provider_version, normalized.version, { includePrerelease: true })
      ) {
        diagnostics.push(errorDiagnostic(
          "provider_version_mismatch",
          `Provider ${normalized.id} ${registered.descriptor.provider_version} does not satisfy ${normalized.version}.`
        ));
      }
    }

    const availableCapabilities = new Set<string>();
    for (const contract of this.contracts()) {
      if (contract.type === "capability") availableCapabilities.add(contract.id);
      if (contract.type === "action") {
        for (const effect of (contract as ActionContract).effects ?? []) availableCapabilities.add(effect);
      }
    }
    for (const capability of Object.keys(selectedPolicy.capabilities)) {
      availableCapabilities.add(capability);
    }
    for (const capability of requirements.capabilities ?? []) {
      if (!availableCapabilities.has(capability)) {
        diagnostics.push(errorDiagnostic("capability_unavailable", `Required capability ${capability} is unavailable.`));
      } else if (selectedPolicy.capabilities[capability] === "deny") {
        diagnostics.push(errorDiagnostic("capability_denied", `Selected policy denies capability ${capability}.`));
      }
    }
    for (const action of requirements.actions ?? []) {
      if (!this.actionOwners.has(action)) {
        diagnostics.push(errorDiagnostic("action_unavailable", `Required action ${action} is unavailable.`));
      }
    }
    return { valid: diagnostics.length === 0, diagnostics };
  }

  subscribe(eventId: string, handler: RuntimeEventHandler): RuntimeDisposable {
    this.assertActive();
    const handlers = this.eventHandlers.get(eventId) ?? new Set<RuntimeEventHandler>();
    handlers.add(handler);
    this.eventHandlers.set(eventId, handlers);
    let active = true;
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        handlers.delete(handler);
        if (handlers.size === 0) this.eventHandlers.delete(eventId);
      }
    };
  }

  async dispatch(actionId: string, input: unknown, context: AuthorizationContext): Promise<unknown> {
    this.assertActive();
    validateDispatchContext(context);
    const providerId = this.actionOwners.get(actionId);
    const registered = providerId ? this.providerRegistry.get(providerId) : undefined;
    if (!registered) throw new RuntimeHostError("action_unavailable", `Action ${actionId} is unavailable.`);
    const contract = registered.contracts.find(
      (candidate): candidate is ActionContract => candidate.type === "action" && candidate.id === actionId
    );
    if (!contract) throw new RuntimeHostError("contract_missing", `Action contract ${actionId} is missing.`);

    const requirements = this.preflight({
      providers: contract.requires?.providers,
      capabilities: contract.requires?.capabilities
    });
    if (!requirements.valid) {
      const diagnostic = requirements.diagnostics[0];
      throw new RuntimeHostError(
        diagnostic?.code ?? "action_preflight_failed",
        diagnostic?.message ?? `Action ${actionId} failed preflight.`
      );
    }
    const selectedPolicy = this.resolvePolicy();

    const validators = this.actionValidators.get(actionId);
    if (!validators?.input(input)) {
      throw new RuntimeHostError("invalid_action_input", formatValidationErrors(actionId, validators?.input));
    }
    for (const capability of new Set([...(contract.requires?.capabilities ?? []), ...(contract.effects ?? [])])) {
      if (selectedPolicy.capabilities[capability] !== "allow") {
        throw new RuntimeHostError("capability_denied", `Selected policy does not allow ${capability}.`);
      }
    }

    const output = await registered.provider.dispatch(actionId, input, context);
    if (validators.output && !validators.output(output)) {
      throw new RuntimeHostError("invalid_action_output", formatValidationErrors(actionId, validators.output));
    }
    return output;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.registrationQueue;
    for (const providerId of [...this.providerRegistry.keys()]) {
      await this.unregisterProvider(providerId);
    }
    this.eventHandlers.clear();
    this.recentEventIds.clear();
  }

  private async registerProviderAtomic(provider: RuntimeProvider): Promise<RuntimeProviderRegistration> {
    this.assertActive();
    const subscriptions: RuntimeDisposable[] = [];
    let providerId: string | undefined;
    try {
      const descriptor = await provider.descriptor();
      providerId = descriptor.id;
      const contracts = await provider.contracts();
      const readiness = await provider.readiness();
      if (!readiness.valid || readiness.status === "unavailable") {
        throw new RuntimeHostError(
          "provider_not_ready",
          readiness.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || `${descriptor.id} is not ready.`
        );
      }
      this.validateProvider(descriptor, contracts);
      const compiled = this.compileContracts(contracts);

      for (const contract of contracts) {
        if (contract.type !== "event") continue;
        subscriptions.push(provider.subscribe(contract.id, (event) => this.deliverProviderEvent(descriptor.id, event)));
      }

      this.providerRegistry.set(descriptor.id, {
        provider,
        descriptor: clone(descriptor),
        contracts: clone(contracts),
        subscriptions
      });
      for (const [actionId, validators] of compiled.actions) {
        this.actionOwners.set(actionId, descriptor.id);
        this.actionValidators.set(actionId, validators);
      }
      for (const [eventId, validator] of compiled.events) {
        this.eventOwners.set(eventId, descriptor.id);
        this.eventValidators.set(eventId, validator);
      }

      return {
        providerId: descriptor.id,
        unregister: async () => this.unregisterProvider(descriptor.id)
      };
    } catch (error) {
      await Promise.allSettled(subscriptions.map(async (subscription) => subscription.dispose()));
      try {
        await provider.dispose();
      } catch (cause) {
        this.report({
          severity: "warning",
          code: "provider_cleanup_failed",
          message: "Provider cleanup failed after registration error.",
          providerId,
          cause
        });
      }
      throw error;
    }
  }

  private validateProvider(descriptor: ProviderContract, contracts: RuntimeContractRecord[]): void {
    assertCanonicalRecord(this.providerValidator, descriptor, "invalid_provider", "Provider descriptor");
    if (!valid(descriptor.provider_version)) {
      throw new RuntimeHostError("invalid_provider_version", `${descriptor.id} provider_version must be SemVer.`);
    }
    if (this.providerRegistry.has(descriptor.id)) {
      throw new RuntimeHostError("provider_conflict", `Provider ${descriptor.id} is already registered.`);
    }

    const ids = new Set<string>();
    for (const contract of contracts) {
      if (!isProviderRuntimeContractType(contract.type)) {
        throw new RuntimeHostError(
          "invalid_contract",
          `Provider ${descriptor.id} supplied unsupported ${contract.type} contract ${contract.id}.`
        );
      }
      assertCanonicalRecord(
        this.contractValidators[contract.type],
        contract,
        "invalid_contract",
        `${contract.type} contract ${contract.id || "<missing-id>"}`
      );
      const key = `${contract.type}:${contract.id}`;
      if (ids.has(key)) {
        throw new RuntimeHostError("runtime_contract_conflict", `Provider ${descriptor.id} repeats ${key}.`);
      }
      ids.add(key);
      if (
        (contract.type === "action" || contract.type === "event" || contract.type === "capability") &&
        contract.provider !== undefined &&
        contract.provider !== descriptor.id
      ) {
        throw new RuntimeHostError("provider_contract_mismatch", `${contract.id} names provider ${String(contract.provider)}.`);
      }
      if (contract.type === "action" && this.actionOwners.has(contract.id)) {
        throw new RuntimeHostError("runtime_contract_conflict", `Action ${contract.id} is already registered.`);
      }
      if (contract.type === "event" && this.eventOwners.has(contract.id)) {
        throw new RuntimeHostError("runtime_contract_conflict", `Event ${contract.id} is already registered.`);
      }
    }
    assertAdvertisedContracts(descriptor, contracts, "actions", "action");
    assertAdvertisedContracts(descriptor, contracts, "events", "event");
    assertAdvertisedContracts(descriptor, contracts, "capabilities", "capability");
    assertAdvertisedContracts(descriptor, contracts, "workflows", "workflow");
  }

  private compileContracts(contracts: RuntimeContractRecord[]): {
    actions: Map<string, { input: ValidateFunction; output?: ValidateFunction }>;
    events: Map<string, ValidateFunction>;
  } {
    const actions = new Map<string, { input: ValidateFunction; output?: ValidateFunction }>();
    const events = new Map<string, ValidateFunction>();
    try {
      for (const contract of contracts) {
        if (contract.type === "action") {
          const action = contract as ActionContract;
          actions.set(action.id, {
            input: this.ajv.compile(action.schemas.input),
            output: action.schemas.output ? this.ajv.compile(action.schemas.output) : undefined
          });
        }
        if (contract.type === "event") {
          const event = contract as EventContract;
          events.set(event.id, this.ajv.compile(event.schemas.payload));
        }
      }
    } catch (error) {
      throw new RuntimeHostError(
        "invalid_contract_schema",
        error instanceof Error ? error.message : "A contract schema could not be compiled."
      );
    }
    return { actions, events };
  }

  private deliverProviderEvent(providerId: string, event: RuntimeEventEnvelope): void {
    const envelope: unknown = event;
    if (!this.eventEnvelopeValidator(envelope)) {
      this.rejectEvent(
        "invalid_event_envelope",
        formatValidationErrors(event.type || "event", this.eventEnvelopeValidator),
        providerId,
        event.type || "<missing-type>"
      );
      return;
    }
    const expectedProvider = this.eventOwners.get(event.type);
    const registered = this.providerRegistry.get(providerId);
    const contract = registered?.contracts.find(
      (candidate): candidate is EventContract => candidate.type === "event" && candidate.id === event.type
    );
    if (!contract || expectedProvider !== providerId) {
      this.rejectEvent("event_provider_mismatch", `Provider ${providerId} cannot emit ${event.type}.`, providerId, event.type);
      return;
    }
    if (
      event.contract_version !== contract.version ||
      (event.source.provider !== undefined && event.source.provider !== providerId)
    ) {
      this.rejectEvent("runtime_contract_version_mismatch", `Event ${event.type} does not match its registered contract.`, providerId, event.type);
      return;
    }
    if (this.recentEventIds.has(event.id)) return;
    const validator = this.eventValidators.get(event.type);
    if (!validator?.(event.payload)) {
      this.rejectEvent("invalid_event_payload", formatValidationErrors(event.type, validator), providerId, event.type);
      return;
    }

    this.recentEventIds.add(event.id);
    if (this.recentEventIds.size > this.recentEventLimit) {
      const oldest = this.recentEventIds.values().next().value as string | undefined;
      if (oldest) this.recentEventIds.delete(oldest);
    }
    for (const handler of this.eventHandlers.get(event.type) ?? []) {
      void Promise.resolve(handler(clone(event))).catch((cause: unknown) => {
        this.report({
          severity: "error",
          code: "event_handler_failed",
          message: `Event handler failed for ${event.type}.`,
          providerId,
          contractId: event.type,
          cause
        });
      });
    }
  }

  private async unregisterProvider(providerId: string): Promise<void> {
    const registered = this.providerRegistry.get(providerId);
    if (!registered) return;
    this.providerRegistry.delete(providerId);
    for (const contract of registered.contracts) {
      if (contract.type === "action") {
        this.actionOwners.delete(contract.id);
        this.actionValidators.delete(contract.id);
      }
      if (contract.type === "event") {
        this.eventOwners.delete(contract.id);
        this.eventValidators.delete(contract.id);
      }
    }
    for (const subscription of registered.subscriptions) await subscription.dispose();
    await registered.provider.dispose();
  }

  private rejectEvent(code: string, message: string, providerId: string, contractId: string): void {
    this.report({ severity: "warning", code, message, providerId, contractId });
  }

  private report(diagnostic: RuntimeHostDiagnostic): void {
    this.options.onDiagnostic?.(diagnostic);
  }

  private assertActive(): void {
    if (this.disposed) throw new RuntimeHostError("runtime_disposed", "Runtime provider host is disposed.");
  }

  private resolvePolicy(): RuntimePolicyInfo {
    const policy = this.policyResolver();
    if (
      !policy ||
      policy.selected !== true ||
      typeof policy.id !== "string" ||
      policy.id.length === 0 ||
      typeof policy.capabilities !== "object"
    ) {
      throw new RuntimeHostError("invalid_runtime_policy", "The host policy resolver returned an invalid policy.");
    }
    for (const mode of Object.values(policy.capabilities)) {
      if (mode !== "allow" && mode !== "deny") {
        throw new RuntimeHostError("invalid_runtime_policy", "Runtime policy capability modes must be allow or deny.");
      }
    }
    return clone(policy);
  }
}

export class RuntimeHostError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RuntimeHostError";
  }
}

function normalizeProviderRequirement(requirement: ProviderRequirementInput): { id: string; version?: string } {
  return typeof requirement === "string" ? { id: requirement } : requirement;
}

function assertAdvertisedContracts(
  descriptor: ProviderContract,
  contracts: RuntimeContractRecord[],
  key: "actions" | "events" | "capabilities" | "workflows",
  type: RuntimeContractRecord["type"]
): void {
  const advertised = [...(descriptor.contracts?.[key] ?? [])].sort();
  const provided = contracts.filter((contract) => contract.type === type).map((contract) => contract.id).sort();
  if (advertised.length !== provided.length || advertised.some((id, index) => id !== provided[index])) {
    throw new RuntimeHostError(
      "provider_contract_mismatch",
      `${descriptor.id} advertised ${key} do not match its supplied contracts.`
    );
  }
}

function validateDispatchContext(context: AuthorizationContext): void {
  if (
    !context.actor?.id ||
    !context.actor.kind ||
    !context.origin ||
    !context.run_id ||
    !context.invocation_id ||
    !Number.isInteger(context.attempt) ||
    context.attempt < 1 ||
    !context.correlation_id ||
    !context.executor
  ) {
    throw new RuntimeHostError("invalid_dispatch_context", "Dispatch context is missing required provenance fields.");
  }
}

function formatValidationErrors(contractId: string, validator?: ValidateFunction): string {
  const details = validator?.errors
    ?.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
  return `${contractId} validation failed${details ? `: ${details}` : "."}`;
}

function errorDiagnostic(code: string, message: string) {
  return { code, message, severity: "error" as const };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createHostAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const addFormats = addFormatsImport as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  return ajv;
}

function compileProviderContractValidators(
  ajv: Ajv2020
): Record<ProviderRuntimeContractType, ValidateFunction> {
  const schemas = getProviderRuntimeContractSchemas();
  return {
    action: ajv.compile(schemas.action),
    event: ajv.compile(schemas.event),
    capability: ajv.compile(schemas.capability),
    workflow: ajv.compile(schemas.workflow)
  };
}

function isProviderRuntimeContractType(type: RuntimeContractRecord["type"]): type is ProviderRuntimeContractType {
  return type === "action" || type === "event" || type === "capability" || type === "workflow";
}

function assertCanonicalRecord(
  validator: ValidateFunction,
  value: unknown,
  code: string,
  label: string
): void {
  if (validator(value)) return;
  throw new RuntimeHostError(code, formatValidationErrors(label, validator));
}

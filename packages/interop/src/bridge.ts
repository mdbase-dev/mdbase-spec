import type { ValidateFunction } from "ajv";
import { maxSatisfying, satisfies, valid, validRange } from "semver";
import {
  assertSchemaValue,
  compileActionValidators,
  compileEventValidators,
  contractDigest,
  portableDigest
} from "./contracts.js";
import { ActionHandlerError, InteropError } from "./errors.js";
import {
  compileInteropSchema,
  createInteropAjv,
  formatSchemaErrors
} from "./schemas.js";
import {
  MDBASE_INTEROP_PROFILE_VERSION,
  type ActionContractArtifact,
  type ActionHandler,
  type ActionInvocation,
  type ActionOutcome,
  type ActionProviderDeclaration,
  type ActionProviderHandlerDeclaration,
  type ActionProviderRegistration,
  type AuthorizationRequest,
  type BridgeDescription,
  type BridgeDiagnostic,
  type CloudEvent,
  type ContractArtifact,
  type ContractRequirement,
  type Disposable,
  type EventContractArtifact,
  type EventHandler,
  type EventSourceDeclaration,
  type EventSourceRegistration,
  type EventSubscription,
  type ExactContractReference,
  type ImplementationIdentity,
  type InteropClient,
  type InvokeActionInput,
  type PortableError,
  type ProviderSelector,
  type PublishEventInput,
  type PublishEventResult,
  type RegisterActionProviderInput,
  type RegisterEventSourceInput,
  type TransportCapabilities
} from "./types.js";

interface StoredEventContract {
  artifact: EventContractArtifact;
  reference: ExactContractReference;
  dataValidator: ValidateFunction;
  sourceValidator?: ValidateFunction;
}

interface StoredActionContract {
  artifact: ActionContractArtifact;
  reference: ExactContractReference;
  inputValidator: ValidateFunction;
  outputValidator?: ValidateFunction;
  errorValidator?: ValidateFunction;
  providerValidator?: ValidateFunction;
}

type StoredContract = StoredEventContract | StoredActionContract;

interface RegisteredEventSource {
  id: string;
  clientId: string;
  declaration: EventSourceDeclaration;
  contracts: Map<string, {
    contract: StoredEventContract;
    binding?: unknown;
  }>;
}

interface RegisteredActionHandler {
  registrationId: string;
  clientId: string;
  declaration: ActionProviderDeclaration;
  handlerDeclaration: ActionProviderHandlerDeclaration;
  contract: StoredActionContract;
  handler: ActionHandler;
  active: number;
}

interface RegisteredActionProvider {
  id: string;
  clientId: string;
  declaration: ActionProviderDeclaration;
  handlers: RegisteredActionHandler[];
}

interface RegisteredSubscription {
  id: string;
  clientId: string;
  principal: ImplementationIdentity;
  subscription: EventSubscription;
  handler: EventHandler;
}

interface ActiveAction {
  clientId: string;
  requestId: string;
  requestDigest: string;
  handler: RegisteredActionHandler;
  invocation: ActionInvocation;
  controller: AbortController;
  promise: Promise<ActionOutcome>;
}

interface CompletedAction {
  clientId: string;
  requestDigest: string;
  outcome: ActionOutcome;
  reusable: boolean;
  expiresAt: number;
}

interface ClientState {
  identity: ImplementationIdentity;
  disposed: boolean;
  sources: Set<string>;
  providers: Set<string>;
  subscriptions: Set<string>;
}

export interface InMemoryInteropBridgeOptions {
  authorize?: (request: AuthorizationRequest) => boolean | Promise<boolean>;
  now?: () => Date;
  idFactory?: (prefix: string) => string;
  transport?: Partial<TransportCapabilities>;
  recentEventLimit?: number;
  completedRequestLimit?: number;
  onDiagnostic?: (diagnostic: BridgeDiagnostic) => void;
  authorizationContext?: (request: AuthorizationRequest) => string | undefined | Promise<string | undefined>;
  onInvocation?: (invocation: ActionInvocation) => void | Promise<void>;
}

const DEFAULT_TRANSPORT: TransportCapabilities = {
  delivery: ["ephemeral"],
  ordering: ["none"],
  cancellation: true,
  deadlines: true,
  provider_discovery: true,
  request_deduplication: true,
  cross_process_identity: false
};

const RESERVED_EVENT_ATTRIBUTES = new Set([
  "specversion",
  "id",
  "source",
  "type",
  "time",
  "subject",
  "datacontenttype",
  "dataschema",
  "data",
  "mdbaseprofile",
  "mdbasecontractversion",
  "mdbasecontractdigest",
  "mdbaseapplication",
  "mdbaseimplementation",
  "mdbaseimplementationversion",
  "mdbaseinstanceid",
  "correlationid",
  "causationid"
]);

export class InMemoryInteropBridge implements Disposable {
  readonly profileVersion = MDBASE_INTEROP_PROFILE_VERSION;
  readonly transport: TransportCapabilities;

  private readonly ajv = createInteropAjv();
  private readonly contractValidator = compileInteropSchema(this.ajv, "contract");
  private readonly eventValidator = compileInteropSchema(this.ajv, "event");
  private readonly actionRequestValidator = compileInteropSchema(this.ajv, "actionRequest");
  private readonly actionInvocationValidator = compileInteropSchema(this.ajv, "actionInvocation");
  private readonly actionOutcomeValidator = compileInteropSchema(this.ajv, "actionOutcome");
  private readonly eventSourceDeclarationValidator = compileInteropSchema(
    this.ajv,
    "eventSourceDeclaration"
  );
  private readonly actionProviderDeclarationValidator = compileInteropSchema(
    this.ajv,
    "actionProviderDeclaration"
  );
  private readonly contracts = new Map<string, StoredContract>();
  private readonly clients = new Map<string, ClientState>();
  private readonly eventSources = new Map<string, RegisteredEventSource>();
  private readonly actionProviders = new Map<string, RegisteredActionProvider>();
  private readonly subscriptions = new Map<string, RegisteredSubscription>();
  private readonly activeActions = new Map<string, ActiveAction>();
  private readonly completedActions = new Map<string, CompletedAction>();
  private readonly admissionLocks = new Map<string, Promise<void>>();
  private readonly recentEvents = new Map<string, CloudEvent>();
  private readonly authorize: NonNullable<InMemoryInteropBridgeOptions["authorize"]>;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly recentEventLimit: number;
  private readonly completedRequestLimit: number;
  private nextSequence = 0;
  private disposed = false;

  constructor(private readonly options: InMemoryInteropBridgeOptions = {}) {
    this.authorize = options.authorize ?? (() => false);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? ((prefix) => {
      this.nextSequence += 1;
      const random = typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${this.now().getTime().toString(36)}-${this.nextSequence.toString(36)}`;
      return `${prefix}_${random}`;
    });
    this.recentEventLimit = Math.max(1, options.recentEventLimit ?? 1000);
    this.completedRequestLimit = Math.max(1, options.completedRequestLimit ?? 1000);
    this.transport = {
      ...DEFAULT_TRANSPORT,
      ...structuredClone(options.transport ?? {}),
      delivery: [...(options.transport?.delivery ?? DEFAULT_TRANSPORT.delivery)],
      ordering: [...(options.transport?.ordering ?? DEFAULT_TRANSPORT.ordering)]
    };
  }

  connect(identity: ImplementationIdentity): InteropClient {
    this.assertActive();
    assertIdentity(identity);
    const clientId = this.idFactory("client");
    const state: ClientState = {
      identity: structuredClone(identity),
      disposed: false,
      sources: new Set(),
      providers: new Set(),
      subscriptions: new Set()
    };
    this.clients.set(clientId, state);
    return {
      identity: structuredClone(identity),
      registerEventSource: (input) => this.registerEventSource(clientId, input),
      publishEvent: (input) => this.publishEvent(clientId, input),
      subscribeEvents: (subscription, handler) =>
        this.subscribeEvents(clientId, subscription, handler as EventHandler),
      registerActionProvider: (input) => this.registerActionProvider(clientId, input),
      invokeAction: (input) => this.invokeAction(clientId, input),
      cancelAction: (requestId, reason) => this.cancelAction(clientId, requestId, reason),
      dispose: () => this.disposeClient(clientId)
    };
  }

  describe(): BridgeDescription {
    this.assertActive();
    return {
      profile_version: MDBASE_INTEROP_PROFILE_VERSION,
      transport: structuredClone(this.transport),
      contracts: [...this.contracts.values()]
        .map(({ artifact, reference }) => ({
          artifact: structuredClone(artifact),
          reference: structuredClone(reference)
        }))
        .sort((left, right) =>
          left.reference.id.localeCompare(right.reference.id)
          || left.reference.version.localeCompare(right.reference.version)
        ),
      event_sources: [...this.eventSources.values()]
        .map(({ declaration }) => structuredClone(declaration))
        .sort((left, right) => left.declaration_id.localeCompare(right.declaration_id)),
      action_providers: [...this.actionProviders.values()]
        .map(({ declaration }) => structuredClone(declaration))
        .sort((left, right) => left.declaration_id.localeCompare(right.declaration_id))
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const clientId of [...this.clients.keys()]) await this.disposeClient(clientId, true);
    this.contracts.clear();
    this.recentEvents.clear();
    this.completedActions.clear();
  }

  private async registerEventSource(
    clientId: string,
    input: RegisterEventSourceInput
  ): Promise<EventSourceRegistration> {
    const client = this.requireClient(clientId);
    if (input.contracts.length === 0) {
      throw new InteropError("request_rejected", "An event-source declaration must include a contract.");
    }
    const registrationId = `${clientId}:${input.declaration_id}`;
    if (this.eventSources.has(registrationId)) {
      throw new InteropError("request_rejected", `Event-source declaration ${input.declaration_id} is already registered.`);
    }

    const prepared = new Map<string, {
      contract: StoredEventContract;
      binding?: unknown;
      requirement: ContractRequirement;
      ordering?: Array<"none" | "source" | "subject">;
    }>();
    for (const declared of input.contracts) {
      const stored = await this.prepareEventContract(declared.contract);
      const requirement = normalizeRequirement(declared.requirement, stored.reference);
      assertRequirementMatches(requirement, stored.reference);
      await this.assertAuthorized({
        operation: "register_event_source",
        principal: client.identity,
        contract: stored.reference
      });
      if (stored.sourceValidator && !stored.sourceValidator(declared.binding ?? {})) {
        throw new InteropError(
          "request_rejected",
          `${stored.reference.id} source binding is invalid: ${formatSchemaErrors(stored.sourceValidator.errors)}`
        );
      }
      const key = contractKey(stored.reference);
      if (prepared.has(key)) {
        throw new InteropError("contract_digest_conflict", `Event contract ${key} is repeated by one declaration.`);
      }
      prepared.set(key, {
        contract: stored,
        requirement,
        ...(declared.binding === undefined ? {} : { binding: structuredClone(declared.binding) }),
        ...(declared.ordering === undefined ? {} : { ordering: [...declared.ordering] })
      });
    }

    const declarationWithoutDigest = {
      kind: "mdbase.event-source" as const,
      profile_version: MDBASE_INTEROP_PROFILE_VERSION,
      declaration_id: input.declaration_id,
      source: structuredClone(client.identity),
      contracts: [...prepared.values()].map(({ contract, requirement, binding, ordering }) => ({
        requirement: structuredClone(requirement),
        resolved: structuredClone(contract.reference),
        ...(binding === undefined ? {} : { binding }),
        ...(ordering === undefined ? {} : { ordering })
      }))
    };
    const declaration: EventSourceDeclaration = {
      ...declarationWithoutDigest,
      declaration_digest: await portableDigest(declarationWithoutDigest)
    };
    assertCanonical(
      this.eventSourceDeclarationValidator,
      declaration,
      "request_rejected",
      "Event-source declaration"
    );
    this.commitContracts([...prepared.values()].map(({ contract }) => contract));
    this.eventSources.set(registrationId, {
      id: registrationId,
      clientId,
      declaration: structuredClone(declaration),
      contracts: new Map(
        [...prepared.entries()].map(([key, value]) => [
          key,
          {
            contract: value.contract,
            ...(value.binding === undefined ? {} : { binding: value.binding })
          }
        ])
      )
    });
    client.sources.add(registrationId);
    let active = true;
    return {
      declaration: structuredClone(declaration),
      dispose: () => {
        if (!active) return;
        active = false;
        this.removeEventSource(registrationId);
      }
    };
  }

  private async publishEvent<T>(
    clientId: string,
    input: PublishEventInput<T>
  ): Promise<PublishEventResult<T>> {
    const client = this.requireClient(clientId);
    const exactKey = contractKey(input.contract);
    const source = [...client.sources]
      .map((id) => this.eventSources.get(id))
      .find((candidate) => candidate?.contracts.has(exactKey));
    if (!source) {
      throw new InteropError(
        "unknown_contract",
        `This client has not registered event contract ${input.contract.id} ${input.contract.version}.`
      );
    }
    const stored = source.contracts.get(exactKey)?.contract;
    if (!stored) throw new InteropError("unknown_contract", `Event contract ${exactKey} is unavailable.`);
    if (input.contract.digest && input.contract.digest !== stored.reference.digest) {
      throw new InteropError("contract_digest_conflict", `Event contract ${exactKey} has a different digest.`);
    }
    await this.assertAuthorized({
      operation: "publish_event",
      principal: client.identity,
      contract: stored.reference,
      ...(input.subject === undefined ? {} : { subject: input.subject })
    });
    assertPortableJson(input.data, "invalid_event_data", `Event ${stored.reference.id} data`);
    assertSchemaValue(
      stored.dataValidator,
      input.data,
      "invalid_event_data",
      `Event ${stored.reference.id} data`
    );
    const extensions = input.extensions ?? {};
    for (const key of Object.keys(extensions)) {
      if (RESERVED_EVENT_ATTRIBUTES.has(key)) {
        throw new InteropError("request_rejected", `Event extension ${key} is reserved.`);
      }
    }
    const event: CloudEvent<T> = {
      ...structuredClone(extensions),
      specversion: "1.0",
      id: input.id ?? this.idFactory("evt"),
      source: sourceUri(client.identity),
      type: stored.reference.id,
      time: input.time ?? this.now().toISOString(),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      datacontenttype: "application/json",
      dataschema: contractUrn(stored.reference),
      data: structuredClone(input.data),
      mdbaseprofile: MDBASE_INTEROP_PROFILE_VERSION,
      mdbasecontractversion: stored.reference.version,
      mdbasecontractdigest: stored.reference.digest,
      mdbaseapplication: client.identity.application,
      mdbaseimplementation: client.identity.implementation,
      mdbaseimplementationversion: client.identity.version,
      ...(client.identity.instance_id === undefined
        ? {}
        : { mdbaseinstanceid: client.identity.instance_id }),
      ...(input.correlation_id === undefined ? {} : { correlationid: input.correlation_id }),
      ...(input.causation_id === undefined ? {} : { causationid: input.causation_id })
    };
    assertCanonical(this.eventValidator, event, "invalid_event_data", "Event envelope");
    assertPayloadSize(this.transport, event);
    assertEventContractEvidence(event, stored.reference);

    const duplicateKey = `${event.source}\u0000${event.id}`;
    const prior = this.recentEvents.get(duplicateKey) as CloudEvent<T> | undefined;
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(event)) {
        throw new InteropError(
          "contract_digest_conflict",
          `Event ${event.source} ${event.id} was reused with different content.`
        );
      }
      return { event: structuredClone(prior), deliveries: 0, duplicate: true };
    }
    this.recentEvents.set(duplicateKey, structuredClone(event));
    trimMap(this.recentEvents, this.recentEventLimit);

    const matches = [...this.subscriptions.values()].filter(({ subscription }) =>
      requirementMatches(subscription.contract, stored.reference)
    );
    const results = await Promise.allSettled(matches.map(async (subscription) => {
      const allowed = await this.isAuthorized({
        operation: "subscribe_event",
        principal: subscription.principal,
        contract: stored.reference,
        ...(event.subject === undefined ? {} : { subject: event.subject })
      });
      if (!allowed) return false;
      await subscription.handler(structuredClone(event));
      return true;
    }));
    let deliveries = 0;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        deliveries += 1;
      } else if (result.status === "rejected") {
        this.report({
          severity: "error",
          code: "event_consumer_failed",
          message: `An event consumer failed while handling ${event.type}.`,
          contract: stored.reference,
          cause: result.reason
        });
      }
    }
    return { event: structuredClone(event), deliveries, duplicate: false };
  }

  private async subscribeEvents(
    clientId: string,
    subscription: EventSubscription,
    handler: EventHandler
  ): Promise<Disposable> {
    const client = this.requireClient(clientId);
    assertRequirement(subscription.contract);
    assertTransportRequirements(this.transport, subscription.require_transport);
    await this.assertAuthorized({
      operation: "subscribe_event",
      principal: client.identity,
      contract: subscription.contract
    });
    const id = this.idFactory("subscription");
    this.subscriptions.set(id, {
      id,
      clientId,
      principal: structuredClone(client.identity),
      subscription: structuredClone(subscription),
      handler
    });
    client.subscriptions.add(id);
    let active = true;
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        this.removeSubscription(id);
      }
    };
  }

  private async registerActionProvider(
    clientId: string,
    input: RegisterActionProviderInput
  ): Promise<ActionProviderRegistration> {
    const client = this.requireClient(clientId);
    if (input.handlers.length === 0) {
      throw new InteropError("request_rejected", "An action-provider declaration must include a handler.");
    }
    const registrationId = `${clientId}:${input.declaration_id}`;
    if (this.actionProviders.has(registrationId)) {
      throw new InteropError("request_rejected", `Action-provider declaration ${input.declaration_id} is already registered.`);
    }

    const prepared: Array<{
      contract: StoredActionContract;
      declaration: ActionProviderHandlerDeclaration;
      handler: ActionHandler;
    }> = [];
    const handlerIds = new Set<string>();
    for (const supplied of input.handlers) {
      if (handlerIds.has(supplied.handler_id)) {
        throw new InteropError("request_rejected", `Handler ${supplied.handler_id} is repeated.`);
      }
      handlerIds.add(supplied.handler_id);
      const stored = await this.prepareActionContract(supplied.contract);
      const requirement = normalizeRequirement(supplied.requirement, stored.reference);
      assertRequirementMatches(requirement, stored.reference);
      await this.assertAuthorized({
        operation: "register_action_provider",
        principal: client.identity,
        contract: stored.reference,
        provider: client.identity
      });
      if (stored.providerValidator && !stored.providerValidator(supplied.binding ?? {})) {
        throw new InteropError(
          "request_rejected",
          `${stored.reference.id} provider binding is invalid: ${formatSchemaErrors(stored.providerValidator.errors)}`
        );
      }
      const contractIdempotency = supplied.contract.behavior?.idempotency ?? "none";
      if (supplied.idempotency?.mode === "request" && contractIdempotency === "none") {
        throw new InteropError(
          "request_rejected",
          `${stored.reference.id} does not permit request deduplication.`
        );
      }
      if (
        contractIdempotency === "required"
        && supplied.idempotency?.mode !== "request"
      ) {
        throw new InteropError(
          "request_rejected",
          `${stored.reference.id} requires a provider with request deduplication.`
        );
      }
      const contractCancellation = supplied.contract.behavior?.cancellation ?? "none";
      if (supplied.cancellation === "cooperative" && contractCancellation !== "cooperative") {
        throw new InteropError(
          "request_rejected",
          `${stored.reference.id} does not declare cooperative cancellation.`
        );
      }
      prepared.push({
        contract: stored,
        declaration: {
          handler_id: supplied.handler_id,
          requirement,
          resolved: structuredClone(stored.reference),
          ...(supplied.binding === undefined ? {} : { binding: structuredClone(supplied.binding) }),
          ...(supplied.idempotency === undefined
            ? {}
            : { idempotency: structuredClone(supplied.idempotency) }),
          ...(supplied.cancellation === undefined
            ? {}
            : { cancellation: supplied.cancellation }),
          ...(supplied.max_concurrency === undefined
            ? {}
            : { max_concurrency: supplied.max_concurrency })
        },
        handler: supplied.handler
      });
    }

    const declarationWithoutDigest = {
      kind: "mdbase.action-provider" as const,
      profile_version: MDBASE_INTEROP_PROFILE_VERSION,
      declaration_id: input.declaration_id,
      provider: structuredClone(client.identity),
      handlers: prepared.map(({ declaration }) => structuredClone(declaration))
    };
    const declaration: ActionProviderDeclaration = {
      ...declarationWithoutDigest,
      declaration_digest: await portableDigest(declarationWithoutDigest)
    };
    assertCanonical(
      this.actionProviderDeclarationValidator,
      declaration,
      "request_rejected",
      "Action-provider declaration"
    );
    this.commitContracts(prepared.map(({ contract }) => contract));
    const handlers: RegisteredActionHandler[] = prepared.map(({ contract, declaration: handlerDeclaration, handler }) => ({
      registrationId,
      clientId,
      declaration: structuredClone(declaration),
      handlerDeclaration: structuredClone(handlerDeclaration),
      contract,
      handler,
      active: 0
    }));
    this.actionProviders.set(registrationId, {
      id: registrationId,
      clientId,
      declaration: structuredClone(declaration),
      handlers
    });
    client.providers.add(registrationId);
    let active = true;
    return {
      declaration: structuredClone(declaration),
      dispose: () => {
        if (!active) return;
        active = false;
        this.removeActionProvider(registrationId);
      }
    };
  }

  private async invokeAction<TInput, TOutput>(
    clientId: string,
    input: InvokeActionInput<TInput>
  ): Promise<ActionOutcome<TOutput>> {
    const client = this.requireClient(clientId);
    assertRequirement(input.contract);
    const requestId = input.request_id ?? this.idFactory("req");
    this.cleanCompletedActions();
    assertPortableJson(input.input, "invalid_action_input", `Action ${input.contract.id} input`);
    const request = {
      kind: "mdbase.action.request" as const,
      profile_version: MDBASE_INTEROP_PROFILE_VERSION,
      request_id: requestId,
      contract: structuredClone(input.contract),
      caller: structuredClone(client.identity),
      created_at: input.created_at ?? this.now().toISOString(),
      ...(input.correlation_id === undefined ? {} : { correlation_id: input.correlation_id }),
      ...(input.causation_id === undefined ? {} : { causation_id: input.causation_id }),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      ...(input.idempotency_key === undefined ? {} : { idempotency_key: input.idempotency_key }),
      ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
      ...(input.requested_provider === undefined
        ? {}
        : { requested_provider: structuredClone(input.requested_provider) }),
      input: structuredClone(input.input)
    };
    assertCanonical(this.actionRequestValidator, request, "request_rejected", "Action request");
    assertPayloadSize(this.transport, request);
    const releaseAdmission = await this.acquireAdmission(requestId);
    try {
      const requestDigest = await portableDigest(requestFingerprint(request));
      const active = this.activeActions.get(requestId);
      if (active) {
        assertSameRequest(clientId, requestId, requestDigest, active);
        if (active.handler.handlerDeclaration.idempotency?.mode !== "request") {
          throw new InteropError("request_rejected", `Action request ${requestId} is already active without deduplication.`);
        }
        return structuredClone(await active.promise) as ActionOutcome<TOutput>;
      }
      const completed = this.completedActions.get(requestId);
      if (completed) {
        assertSameRequest(clientId, requestId, requestDigest, completed);
        if (!completed.reusable) {
          throw new InteropError("request_rejected", `Action request ${requestId} was already completed without deduplication.`);
        }
        return structuredClone(completed.outcome) as ActionOutcome<TOutput>;
      }
    if (request.deadline && new Date(request.deadline).getTime() <= this.now().getTime()) {
      throw new InteropError("deadline_exceeded", `Action request ${requestId} passed its deadline before admission.`);
    }
    if (request.deadline && !this.transport.deadlines) {
      throw new InteropError(
        "unsupported_transport_capability",
        "The active transport cannot enforce action deadlines."
      );
    }

    const candidates = this.resolveActionCandidates(request.contract, request.requested_provider);
    if (candidates.length === 0) this.throwResolutionFailure(request.contract, request.requested_provider);
    const authorized: RegisteredActionHandler[] = [];
    for (const candidate of candidates) {
      if (await this.isAuthorized({
        operation: "invoke_action",
        principal: client.identity,
        contract: candidate.contract.reference,
        provider: candidate.declaration.provider,
        ...(request.subject === undefined ? {} : { subject: request.subject })
      })) {
        authorized.push(candidate);
      }
    }
    if (authorized.length === 0) {
      throw new InteropError("unauthorized", `No authorized provider can execute ${request.contract.id}.`);
    }
    if (authorized.length > 1) {
      throw new InteropError(
        "ambiguous_provider",
        `Action ${request.contract.id} has ${authorized.length} eligible providers; select one explicitly.`
      );
    }
    const selected = authorized[0]!;
    if (
      selected.handlerDeclaration.max_concurrency !== undefined
      && selected.active >= selected.handlerDeclaration.max_concurrency
    ) {
      throw new InteropError("request_rejected", `Provider ${selected.declaration.provider.implementation} is at capacity.`);
    }
    const idempotency = selected.contract.artifact.behavior?.idempotency ?? "none";
    if (idempotency === "required" && !request.idempotency_key) {
      throw new InteropError("request_rejected", `${selected.contract.reference.id} requires an idempotency key.`);
    }
    assertSchemaValue(
      selected.contract.inputValidator,
      request.input,
      "invalid_action_input",
      `Action ${selected.contract.reference.id} input`
    );

    const authorizationRequest: AuthorizationRequest = {
      operation: "invoke_action",
      principal: client.identity,
      contract: selected.contract.reference,
      provider: selected.declaration.provider,
      ...(request.subject === undefined ? {} : { subject: request.subject })
    };
    const authorizationContext = await this.options.authorizationContext?.(authorizationRequest);
    const invocation: ActionInvocation<TInput> = {
      kind: "mdbase.action.invocation",
      profile_version: MDBASE_INTEROP_PROFILE_VERSION,
      invocation_id: this.idFactory("inv"),
      attempt_id: this.idFactory("attempt"),
      request_id: requestId,
      contract: structuredClone(selected.contract.reference),
      caller: structuredClone(client.identity),
      provider: structuredClone(selected.declaration.provider),
      provider_declaration_digest: selected.declaration.declaration_digest,
      handler_id: selected.handlerDeclaration.handler_id,
      admitted_at: this.now().toISOString(),
      ...(request.correlation_id === undefined ? {} : { correlation_id: request.correlation_id }),
      ...(request.causation_id === undefined ? {} : { causation_id: request.causation_id }),
      ...(request.subject === undefined ? {} : { subject: request.subject }),
      ...(request.idempotency_key === undefined ? {} : { idempotency_key: request.idempotency_key }),
      ...(request.deadline === undefined ? {} : { deadline: request.deadline }),
      ...(authorizationContext === undefined ? {} : { authorization_context: authorizationContext }),
      input: structuredClone(request.input)
    };
    assertCanonical(
      this.actionInvocationValidator,
      invocation,
      "request_rejected",
      "Action invocation"
    );
    await this.options.onInvocation?.(structuredClone(invocation));

    const controller = new AbortController();
    let deadlineHandle: ReturnType<typeof setTimeout> | undefined;
    if (invocation.deadline) {
      const remaining = Math.max(0, new Date(invocation.deadline).getTime() - this.now().getTime());
      deadlineHandle = setTimeout(() => controller.abort(new InteropError(
        "deadline_exceeded",
        `Action request ${requestId} exceeded its deadline.`
      )), remaining);
    }
    selected.active += 1;
    const promise = this.executeAction(selected, invocation, controller)
      .finally(() => {
        if (deadlineHandle !== undefined) clearTimeout(deadlineHandle);
        selected.active = Math.max(0, selected.active - 1);
        this.activeActions.delete(requestId);
      });
    this.activeActions.set(requestId, {
      clientId,
      requestId,
      requestDigest,
      handler: selected,
      invocation,
      controller,
      promise
    });
    releaseAdmission();
    const outcome = await promise;
    const retention = selected.handlerDeclaration.idempotency?.retention_seconds ?? 300;
    this.completedActions.set(requestId, {
      clientId,
      requestDigest,
      outcome: structuredClone(outcome),
      reusable: selected.handlerDeclaration.idempotency?.mode === "request",
      expiresAt: this.now().getTime() + retention * 1000
    });
    trimMap(this.completedActions, this.completedRequestLimit);
    return structuredClone(outcome) as ActionOutcome<TOutput>;
    } finally {
      releaseAdmission();
    }
  }

  private async executeAction(
    selected: RegisteredActionHandler,
    invocation: ActionInvocation,
    controller: AbortController
  ): Promise<ActionOutcome> {
    try {
      const output = await selected.handler(structuredClone(invocation.input), {
        invocation: structuredClone(invocation),
        signal: controller.signal
      });
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof InteropError && reason.code === "deadline_exceeded") {
          return this.failureOutcome(invocation, "failed", reason.toPortableError());
        }
        return this.failureOutcome(invocation, "cancelled", {
          code: "cancelled",
          message: `Action request ${invocation.request_id} was cancelled.`
        });
      }
      assertPortableJson(
        output,
        "invalid_action_output",
        `Action ${selected.contract.reference.id} output`
      );
      assertSchemaValue(
        selected.contract.outputValidator,
        output,
        "invalid_action_output",
        `Action ${selected.contract.reference.id} output`
      );
      const outcome: ActionOutcome = {
        kind: "mdbase.action.outcome",
        profile_version: MDBASE_INTEROP_PROFILE_VERSION,
        outcome_id: this.idFactory("outcome"),
        request_id: invocation.request_id,
        invocation_id: invocation.invocation_id,
        attempt_id: invocation.attempt_id,
        contract: structuredClone(invocation.contract),
        provider: structuredClone(invocation.provider),
        provider_declaration_digest: invocation.provider_declaration_digest,
        status: "succeeded",
        completed_at: this.now().toISOString(),
        output: structuredClone(output)
      };
      assertCanonical(this.actionOutcomeValidator, outcome, "invalid_action_output", "Action outcome");
      assertPayloadSize(this.transport, outcome);
      return outcome;
    } catch (error) {
      if (error instanceof ActionHandlerError) {
        if (
          selected.contract.errorValidator
          && !selected.contract.errorValidator(error.error.details ?? {})
        ) {
          return this.failureOutcome(invocation, "failed", {
            code: "handler_failure",
            message: `Provider returned invalid declared error details: ${formatSchemaErrors(selected.contract.errorValidator.errors)}`
          });
        }
        return this.failureOutcome(invocation, error.status, error.error);
      }
      if (error instanceof InteropError) {
        return this.failureOutcome(
          invocation,
          error.code === "cancelled"
            ? "cancelled"
            : error.code === "outcome_indeterminate"
              ? "outcome_indeterminate"
              : "failed",
          error.toPortableError()
        );
      }
      if (controller.signal.aborted || isAbortError(error)) {
        const reason = controller.signal.reason;
        if (reason instanceof InteropError && reason.code === "deadline_exceeded") {
          return this.failureOutcome(invocation, "failed", reason.toPortableError());
        }
        return this.failureOutcome(invocation, "cancelled", {
          code: "cancelled",
          message: `Action request ${invocation.request_id} was cancelled.`
        });
      }
      this.report({
        severity: "error",
        code: "action_handler_failed",
        message: `Provider ${invocation.provider.implementation} failed ${invocation.contract.id}.`,
        principal: invocation.provider,
        contract: invocation.contract,
        cause: error
      });
      return this.failureOutcome(invocation, "failed", {
        code: "handler_failure",
        message: "The selected provider failed while executing the action."
      });
    }
  }

  private failureOutcome(
    invocation: ActionInvocation,
    status: "rejected" | "failed" | "cancelled" | "outcome_indeterminate",
    error: PortableError
  ): ActionOutcome {
    const outcome: ActionOutcome = {
      kind: "mdbase.action.outcome",
      profile_version: MDBASE_INTEROP_PROFILE_VERSION,
      outcome_id: this.idFactory("outcome"),
      request_id: invocation.request_id,
      invocation_id: invocation.invocation_id,
      attempt_id: invocation.attempt_id,
      contract: structuredClone(invocation.contract),
      provider: structuredClone(invocation.provider),
      provider_declaration_digest: invocation.provider_declaration_digest,
      status,
      completed_at: this.now().toISOString(),
      error: structuredClone(error)
    };
    assertCanonical(this.actionOutcomeValidator, outcome, "invalid_action_output", "Action outcome");
    return outcome;
  }

  private async cancelAction(
    clientId: string,
    requestId: string,
    reason?: string
  ): Promise<ActionOutcome | null> {
    const client = this.requireClient(clientId);
    const admission = this.admissionLocks.get(requestId);
    if (admission) await admission;
    const active = this.activeActions.get(requestId);
    if (!active) {
      const completed = this.completedActions.get(requestId);
      if (completed && completed.clientId !== clientId) {
        throw new InteropError("unauthorized", `Action request ${requestId} belongs to another caller.`);
      }
      return completed ? structuredClone(completed.outcome) : null;
    }
    if (active.clientId !== clientId) {
      throw new InteropError("unauthorized", `Action request ${requestId} belongs to another caller.`);
    }
    await this.assertAuthorized({
      operation: "cancel_action",
      principal: client.identity,
      contract: active.invocation.contract,
      provider: active.invocation.provider,
      ...(active.invocation.subject === undefined ? {} : { subject: active.invocation.subject })
    });
    if (!this.transport.cancellation) {
      throw new InteropError(
        "unsupported_transport_capability",
        "The active transport cannot deliver cancellation."
      );
    }
    if (active.handler.handlerDeclaration.cancellation !== "cooperative") {
      throw new InteropError(
        "cancellation_unsupported",
        `Provider ${active.invocation.provider.implementation} does not support cancellation.`
      );
    }
    active.controller.abort(new InteropError(
      "cancelled",
      reason?.trim() || `Action request ${requestId} was cancelled.`
    ));
    return structuredClone(await active.promise);
  }

  private resolveActionCandidates(
    requirement: ContractRequirement,
    selector?: ProviderSelector
  ): RegisteredActionHandler[] {
    const all = [...this.actionProviders.values()]
      .flatMap(({ handlers }) => handlers)
      .filter(({ contract, declaration }) =>
        requirementMatches(requirement, contract.reference)
        && providerMatches(selector, declaration.provider)
      );
    const highest = maxSatisfying(
      [...new Set(all.map(({ contract }) => contract.reference.version))],
      requirement.version,
      { includePrerelease: true }
    );
    if (!highest) return [];
    return all
      .filter(({ contract }) => contract.reference.version === highest)
      .sort((left, right) =>
        left.declaration.provider.application.localeCompare(right.declaration.provider.application)
        || left.declaration.provider.implementation.localeCompare(right.declaration.provider.implementation)
        || (left.declaration.provider.instance_id ?? "").localeCompare(
          right.declaration.provider.instance_id ?? ""
        )
        || left.handlerDeclaration.handler_id.localeCompare(right.handlerDeclaration.handler_id)
      );
  }

  private throwResolutionFailure(
    requirement: ContractRequirement,
    selector?: ProviderSelector
  ): never {
    const artifacts = [...this.contracts.values()]
      .filter((contract): contract is StoredActionContract =>
        contract.artifact.contract_type === "action" && contract.reference.id === requirement.id
      );
    if (artifacts.length === 0) {
      throw new InteropError("unknown_contract", `Action contract ${requirement.id} is unknown.`);
    }
    if (!artifacts.some(({ reference }) => requirementMatches(requirement, reference))) {
      throw new InteropError(
        "unsupported_contract_version",
        `No ${requirement.id} artifact satisfies ${requirement.version}.`
      );
    }
    if (selector) {
      throw new InteropError(
        "requested_provider_unavailable",
        `The requested provider is unavailable for ${requirement.id}.`
      );
    }
    throw new InteropError("no_provider", `No provider is registered for ${requirement.id}.`);
  }

  private async prepareEventContract(
    artifact: EventContractArtifact
  ): Promise<StoredEventContract> {
    this.assertContractArtifact(artifact);
    if (artifact.contract_type !== "event") {
      throw new InteropError("unknown_contract", `${artifact.id} is not an event contract.`);
    }
    const reference = {
      id: artifact.id,
      version: artifact.version,
      digest: await contractDigest(artifact)
    };
    this.assertNoContractConflict(reference);
    const validators = compileEventValidators(this.ajv, artifact);
    return {
      artifact: structuredClone(artifact),
      reference,
      dataValidator: validators.data,
      ...(validators.source === undefined ? {} : { sourceValidator: validators.source })
    };
  }

  private async prepareActionContract(
    artifact: ActionContractArtifact
  ): Promise<StoredActionContract> {
    this.assertContractArtifact(artifact);
    if (artifact.contract_type !== "action") {
      throw new InteropError("unknown_contract", `${artifact.id} is not an action contract.`);
    }
    const reference = {
      id: artifact.id,
      version: artifact.version,
      digest: await contractDigest(artifact)
    };
    this.assertNoContractConflict(reference);
    const validators = compileActionValidators(this.ajv, artifact);
    return {
      artifact: structuredClone(artifact),
      reference,
      inputValidator: validators.input,
      ...(validators.output === undefined ? {} : { outputValidator: validators.output }),
      ...(validators.error === undefined ? {} : { errorValidator: validators.error }),
      ...(validators.provider === undefined ? {} : { providerValidator: validators.provider })
    };
  }

  private assertContractArtifact(artifact: ContractArtifact): void {
    assertCanonical(
      this.contractValidator,
      artifact,
      "contract_digest_conflict",
      `Contract ${artifact.id || "<missing-id>"}`
    );
    if (!valid(artifact.version)) {
      throw new InteropError("unsupported_contract_version", `${artifact.id} version must be exact SemVer.`);
    }
  }

  private assertNoContractConflict(reference: ExactContractReference): void {
    const existing = this.contracts.get(contractKey(reference));
    if (existing && existing.reference.digest !== reference.digest) {
      throw new InteropError(
        "contract_digest_conflict",
        `Contract ${reference.id} ${reference.version} conflicts with the registered artifact.`
      );
    }
  }

  private commitContracts(contracts: StoredContract[]): void {
    const staged = new Map<string, StoredContract>();
    for (const contract of contracts) {
      const key = contractKey(contract.reference);
      const other = staged.get(key) ?? this.contracts.get(key);
      if (other && other.reference.digest !== contract.reference.digest) {
        throw new InteropError(
          "contract_digest_conflict",
          `Contract ${contract.reference.id} ${contract.reference.version} conflicts within the registration.`
        );
      }
      staged.set(key, contract);
    }
    for (const [key, contract] of staged) {
      if (!this.contracts.has(key)) this.contracts.set(key, contract);
    }
  }

  private async disposeClient(clientId: string, bridgeDisposing = false): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || client.disposed) return;
    client.disposed = true;
    for (const id of [...client.subscriptions]) this.removeSubscription(id);
    for (const id of [...client.sources]) this.removeEventSource(id);
    for (const id of [...client.providers]) this.removeActionProvider(id);
    for (const active of [...this.activeActions.values()]) {
      if (active.clientId === clientId && active.handler.handlerDeclaration.cancellation === "cooperative") {
        active.controller.abort(new InteropError("cancelled", "The caller unloaded."));
      }
      if (
        active.handler.clientId === clientId
        && active.handler.handlerDeclaration.cancellation === "cooperative"
      ) {
        active.controller.abort(new InteropError("cancelled", "The provider unloaded."));
      }
    }
    this.clients.delete(clientId);
    if (!bridgeDisposing) this.assertActive();
  }

  private removeEventSource(id: string): void {
    const source = this.eventSources.get(id);
    if (!source) return;
    this.eventSources.delete(id);
    this.clients.get(source.clientId)?.sources.delete(id);
  }

  private removeActionProvider(id: string): void {
    const provider = this.actionProviders.get(id);
    if (!provider) return;
    this.actionProviders.delete(id);
    this.clients.get(provider.clientId)?.providers.delete(id);
    for (const active of this.activeActions.values()) {
      if (
        active.handler.registrationId === id
        && active.handler.handlerDeclaration.cancellation === "cooperative"
      ) {
        active.controller.abort(new InteropError("cancelled", "The provider unloaded."));
      }
    }
  }

  private removeSubscription(id: string): void {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return;
    this.subscriptions.delete(id);
    this.clients.get(subscription.clientId)?.subscriptions.delete(id);
  }

  private requireClient(clientId: string): ClientState {
    this.assertActive();
    const client = this.clients.get(clientId);
    if (!client || client.disposed) throw new InteropError("transport_unavailable", "Interop client is disposed.");
    return client;
  }

  private assertActive(): void {
    if (this.disposed) throw new InteropError("transport_unavailable", "Interop bridge is disposed.");
  }

  private async assertAuthorized(request: AuthorizationRequest): Promise<void> {
    if (!await this.isAuthorized(request)) {
      throw new InteropError("unauthorized", `${request.operation} is not authorized.`);
    }
  }

  private async isAuthorized(request: AuthorizationRequest): Promise<boolean> {
    try {
      return await this.authorize(structuredClone(request));
    } catch (cause) {
      this.report({
        severity: "error",
        code: "authorization_failed",
        message: `Authorization failed for ${request.operation}.`,
        principal: request.principal,
        cause
      });
      return false;
    }
  }

  private cleanCompletedActions(): void {
    const now = this.now().getTime();
    for (const [requestId, completed] of this.completedActions) {
      if (completed.expiresAt <= now) this.completedActions.delete(requestId);
    }
  }

  private async acquireAdmission(requestId: string): Promise<() => void> {
    const previous = this.admissionLocks.get(requestId) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const tail = previous.then(() => current);
    this.admissionLocks.set(requestId, tail);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unlock();
      if (this.admissionLocks.get(requestId) === tail) {
        this.admissionLocks.delete(requestId);
      }
    };
  }

  private report(diagnostic: BridgeDiagnostic): void {
    this.options.onDiagnostic?.(structuredClone(diagnostic));
  }
}

function assertCanonical(
  validator: ValidateFunction,
  value: unknown,
  code: "contract_digest_conflict" | "invalid_event_data" | "invalid_action_output" | "request_rejected",
  label: string
): void {
  if (validator(value)) return;
  throw new InteropError(code, `${label} is invalid: ${formatSchemaErrors(validator.errors)}`);
}

function assertIdentity(identity: ImplementationIdentity): void {
  for (const [field, value] of Object.entries(identity)) {
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value)) {
      throw new InteropError("request_rejected", `Implementation identity ${field} is invalid.`);
    }
  }
  if (!valid(identity.version)) {
    throw new InteropError("request_rejected", "Implementation identity version must be exact SemVer.");
  }
}

function assertRequirement(requirement: ContractRequirement): void {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u.test(requirement.id)) {
    throw new InteropError("unknown_contract", `Contract ID ${requirement.id} is invalid.`);
  }
  if (!validRange(requirement.version, { includePrerelease: true })) {
    throw new InteropError(
      "unsupported_contract_version",
      `Contract requirement ${requirement.version} is not a SemVer range.`
    );
  }
  if (requirement.digest && !/^sha256:[0-9a-f]{64}$/u.test(requirement.digest)) {
    throw new InteropError("contract_digest_conflict", "Contract digest is invalid.");
  }
}

function normalizeRequirement(
  requirement: ContractRequirement | undefined,
  reference: ExactContractReference
): ContractRequirement {
  const normalized = requirement ?? {
    id: reference.id,
    version: reference.version,
    digest: reference.digest
  };
  assertRequirement(normalized);
  return structuredClone(normalized);
}

function assertRequirementMatches(
  requirement: ContractRequirement,
  reference: ExactContractReference
): void {
  if (!requirementMatches(requirement, reference)) {
    throw new InteropError(
      "unsupported_contract_version",
      `${reference.id} ${reference.version} does not satisfy its implementation requirement.`
    );
  }
}

function requirementMatches(
  requirement: ContractRequirement,
  reference: ExactContractReference
): boolean {
  return requirement.id === reference.id
    && satisfies(reference.version, requirement.version, { includePrerelease: true })
    && (!requirement.digest || requirement.digest === reference.digest);
}

function contractKey(reference: { id: string; version: string }): string {
  return `${reference.id}@${reference.version}`;
}

function contractUrn(reference: ExactContractReference): string {
  return `urn:mdbase:contract:${reference.id}:${reference.version}:${reference.digest}`;
}

function sourceUri(identity: ImplementationIdentity): string {
  const components = [
    identity.application,
    identity.implementation,
    ...(identity.instance_id ? [identity.instance_id] : [])
  ].map(encodeURIComponent);
  return `urn:mdbase:app:${components.join(":")}`;
}

function assertEventContractEvidence(
  event: CloudEvent,
  reference: ExactContractReference
): void {
  if (
    event.type !== reference.id
    || event.mdbasecontractversion !== reference.version
    || event.mdbasecontractdigest !== reference.digest
    || event.dataschema !== contractUrn(reference)
  ) {
    throw new InteropError("contract_digest_conflict", "Event contract evidence is inconsistent.");
  }
}

function requestFingerprint(
  request: Record<string, unknown>
): Record<string, unknown> {
  const { created_at: _createdAt, ...portableIntent } = request;
  return portableIntent;
}

function assertSameRequest(
  clientId: string,
  requestId: string,
  requestDigest: string,
  existing: { clientId: string; requestDigest: string }
): void {
  if (existing.clientId !== clientId) {
    throw new InteropError("unauthorized", `Action request ${requestId} belongs to another caller.`);
  }
  if (existing.requestDigest !== requestDigest) {
    throw new InteropError(
      "request_rejected",
      `Action request ${requestId} was reused with different content.`
    );
  }
}

function assertPortableJson(
  value: unknown,
  code: "invalid_event_data" | "invalid_action_input" | "invalid_action_output",
  label: string
): void {
  const seen = new Set<object>();
  const visit = (candidate: unknown, path: string): void => {
    if (
      candidate === null
      || typeof candidate === "boolean"
      || typeof candidate === "string"
    ) {
      return;
    }
    if (typeof candidate === "number") {
      if (Number.isFinite(candidate)) return;
      throw new InteropError(code, `${label}${path} must be a finite JSON number.`);
    }
    if (typeof candidate !== "object") {
      throw new InteropError(code, `${label}${path} is not a JSON value.`);
    }
    if (seen.has(candidate)) {
      throw new InteropError(code, `${label}${path} contains a cycle.`);
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((child, index) => visit(child, `${path}/${index}`));
    } else {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new InteropError(code, `${label}${path} must be a plain JSON object.`);
      }
      for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
        visit(child, `${path}/${key}`);
      }
    }
    seen.delete(candidate);
  };
  visit(value, "");
}

function assertPayloadSize(
  transport: TransportCapabilities,
  value: unknown
): void {
  if (transport.max_payload_bytes === undefined) return;
  const serialized = JSON.stringify(value);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > transport.max_payload_bytes) {
    throw new InteropError(
      "unsupported_transport_capability",
      `The portable envelope is ${bytes} bytes; the active transport allows ${transport.max_payload_bytes}.`
    );
  }
}

function providerMatches(
  selector: ProviderSelector | undefined,
  provider: ImplementationIdentity
): boolean {
  if (!selector) return true;
  return (selector.application === undefined || selector.application === provider.application)
    && (selector.implementation === undefined || selector.implementation === provider.implementation)
    && (selector.instance_id === undefined || selector.instance_id === provider.instance_id);
}

function assertTransportRequirements(
  actual: TransportCapabilities,
  required: Partial<TransportCapabilities> | undefined
): void {
  if (!required) return;
  if (required.delivery?.some((capability) => !actual.delivery.includes(capability))) {
    throw new InteropError("unsupported_transport_capability", "The active transport lacks a required delivery capability.");
  }
  if (required.ordering?.some((capability) => !actual.ordering.includes(capability))) {
    throw new InteropError("unsupported_transport_capability", "The active transport lacks a required ordering capability.");
  }
  for (const key of ["cancellation", "deadlines", "provider_discovery", "request_deduplication", "cross_process_identity"] as const) {
    if (required[key] === true && actual[key] !== true) {
      throw new InteropError("unsupported_transport_capability", `The active transport lacks ${key}.`);
    }
  }
  if (
    required.max_payload_bytes !== undefined
    && (actual.max_payload_bytes === undefined || actual.max_payload_bytes < required.max_payload_bytes)
  ) {
    throw new InteropError("unsupported_transport_capability", "The active transport payload limit is too small.");
  }
}

function trimMap<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const first = map.keys().next().value as K | undefined;
    if (first === undefined) return;
    map.delete(first);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

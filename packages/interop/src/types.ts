export const MDBASE_INTEROP_PROFILE_VERSION = "0.1" as const;
export const CLOUDEVENTS_SPEC_VERSION = "1.0" as const;

export type JsonSchema = Record<string, unknown>;

export interface InlineSchema {
  dialect: "json-schema-2020-12";
  value: JsonSchema;
}

export interface ReferencedSchema {
  dialect: "json-schema-2020-12";
  ref: string;
}

export type SchemaWrapper = InlineSchema | ReferencedSchema;

interface ContractArtifactBase {
  kind: "mdbase.contract";
  id: string;
  version: string;
  name?: string;
  description?: string;
  [extension: `x-${string}`]: unknown;
}

export interface RecordContractArtifact extends ContractArtifactBase {
  contract_type: "record";
  record_schema: SchemaWrapper;
  binding_schema?: SchemaWrapper;
}

export interface EventContractArtifact extends ContractArtifactBase {
  contract_type: "event";
  data_schema: SchemaWrapper;
  source_schema?: SchemaWrapper;
}

export interface ActionContractArtifact extends ContractArtifactBase {
  contract_type: "action";
  input_schema: SchemaWrapper;
  output_schema?: SchemaWrapper;
  error_schema?: SchemaWrapper;
  provider_schema?: SchemaWrapper;
  behavior?: {
    idempotency?: "none" | "optional" | "required";
    cancellation?: "none" | "cooperative";
  };
}

export type ContractArtifact =
  | RecordContractArtifact
  | EventContractArtifact
  | ActionContractArtifact;

export interface ContractRequirement {
  id: string;
  version: string;
  digest?: string;
}

export interface ExactContractReference {
  id: string;
  version: string;
  digest: string;
}

export interface ImplementationIdentity {
  application: string;
  implementation: string;
  version: string;
  instance_id?: string;
}

export interface CloudEvent<T = unknown> {
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string;
  datacontenttype: "application/json";
  dataschema: string;
  data: T;
  mdbaseprofile: "0.1";
  mdbasecontractversion: string;
  mdbasecontractdigest: string;
  mdbaseapplication: string;
  mdbaseimplementation: string;
  mdbaseimplementationversion: string;
  mdbaseinstanceid?: string;
  correlationid?: string;
  causationid?: string;
  [extension: string]: unknown;
}

export interface EventSourceContractInput {
  contract: EventContractArtifact;
  requirement?: ContractRequirement;
  binding?: unknown;
  ordering?: Array<"none" | "source" | "subject">;
}

export interface RegisterEventSourceInput {
  declaration_id: string;
  contracts: EventSourceContractInput[];
}

export interface EventSourceContractDeclaration {
  requirement: ContractRequirement;
  resolved: ExactContractReference;
  binding?: unknown;
  ordering?: Array<"none" | "source" | "subject">;
}

export interface EventSourceDeclaration {
  kind: "mdbase.event-source";
  profile_version: "0.1";
  declaration_id: string;
  declaration_digest: string;
  source: ImplementationIdentity;
  contracts: EventSourceContractDeclaration[];
}

export interface PublishEventInput<T = unknown> {
  id?: string;
  contract: {
    id: string;
    version: string;
    digest?: string;
  };
  time?: string;
  subject?: string;
  correlation_id?: string;
  causation_id?: string;
  data: T;
  extensions?: Record<string, null | boolean | number | string>;
}

export interface PublishEventResult<T = unknown> {
  event: CloudEvent<T>;
  deliveries: number;
  duplicate: boolean;
}

export interface EventSubscription {
  contract: ContractRequirement;
  require_transport?: Partial<TransportCapabilities>;
}

export type EventHandler<T = unknown> = (event: CloudEvent<T>) => void | Promise<void>;

export interface ActionRequest<T = unknown> {
  kind: "mdbase.action.request";
  profile_version: "0.1";
  request_id: string;
  contract: ContractRequirement;
  caller: ImplementationIdentity;
  created_at: string;
  correlation_id?: string;
  causation_id?: string;
  subject?: string;
  idempotency_key?: string;
  deadline?: string;
  requested_provider?: ProviderSelector;
  authorization_context?: string;
  input: T;
}

export interface ProviderSelector {
  application?: string;
  implementation?: string;
  instance_id?: string;
}

export interface ActionInvocation<T = unknown> {
  kind: "mdbase.action.invocation";
  profile_version: "0.1";
  invocation_id: string;
  attempt_id: string;
  request_id: string;
  contract: ExactContractReference;
  caller: ImplementationIdentity;
  provider: ImplementationIdentity;
  provider_declaration_digest: string;
  handler_id: string;
  admitted_at: string;
  correlation_id?: string;
  causation_id?: string;
  subject?: string;
  idempotency_key?: string;
  deadline?: string;
  authorization_context?: string;
  input: T;
}

export type PortableErrorCode =
  | "unknown_contract"
  | "unsupported_contract_version"
  | "contract_digest_conflict"
  | "invalid_event_data"
  | "invalid_action_input"
  | "invalid_action_output"
  | "no_provider"
  | "ambiguous_provider"
  | "requested_provider_unavailable"
  | "unauthorized"
  | "capability_denied"
  | "request_rejected"
  | "deadline_exceeded"
  | "cancellation_unsupported"
  | "cancelled"
  | "handler_failure"
  | "outcome_indeterminate"
  | "transport_unavailable"
  | "unsupported_transport_capability";

export interface PortableError {
  code: PortableErrorCode;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

export type ActionOutcomeStatus =
  | "succeeded"
  | "rejected"
  | "failed"
  | "cancelled"
  | "outcome_indeterminate";

interface ActionOutcomeBase {
  kind: "mdbase.action.outcome";
  profile_version: "0.1";
  outcome_id: string;
  request_id: string;
  invocation_id: string;
  attempt_id: string;
  contract: ExactContractReference;
  provider: ImplementationIdentity;
  provider_declaration_digest: string;
  completed_at: string;
}

export interface SuccessfulActionOutcome<T = unknown> extends ActionOutcomeBase {
  status: "succeeded";
  output: T;
}

export interface UnsuccessfulActionOutcome extends ActionOutcomeBase {
  status: Exclude<ActionOutcomeStatus, "succeeded">;
  error: PortableError;
}

export type ActionOutcome<T = unknown> =
  | SuccessfulActionOutcome<T>
  | UnsuccessfulActionOutcome;

export interface InvokeActionInput<T = unknown> {
  request_id?: string;
  contract: ContractRequirement;
  created_at?: string;
  correlation_id?: string;
  causation_id?: string;
  subject?: string;
  idempotency_key?: string;
  deadline?: string;
  requested_provider?: ProviderSelector;
  input: T;
}

export interface ActionHandlerContext {
  invocation: ActionInvocation;
  signal: AbortSignal;
}

export type ActionHandler = (
  input: unknown,
  context: ActionHandlerContext
) => unknown | Promise<unknown>;

export interface ActionProviderHandlerInput {
  handler_id: string;
  contract: ActionContractArtifact;
  requirement?: ContractRequirement;
  binding?: unknown;
  idempotency?: {
    mode: "none" | "request";
    retention_seconds?: number;
  };
  cancellation?: "none" | "cooperative";
  max_concurrency?: number;
  handler: ActionHandler;
}

export interface RegisterActionProviderInput {
  declaration_id: string;
  handlers: ActionProviderHandlerInput[];
}

export interface ActionProviderHandlerDeclaration {
  handler_id: string;
  requirement: ContractRequirement;
  resolved: ExactContractReference;
  binding?: unknown;
  idempotency?: {
    mode: "none" | "request";
    retention_seconds?: number;
  };
  cancellation?: "none" | "cooperative";
  max_concurrency?: number;
}

export interface ActionProviderDeclaration {
  kind: "mdbase.action-provider";
  profile_version: "0.1";
  declaration_id: string;
  declaration_digest: string;
  provider: ImplementationIdentity;
  handlers: ActionProviderHandlerDeclaration[];
}

export interface ActionCancellation {
  kind: "mdbase.action.cancel";
  profile_version: "0.1";
  cancellation_id: string;
  request_id: string;
  caller: ImplementationIdentity;
  requested_at: string;
  reason?: string;
}

export type InteropRole =
  | "event_source"
  | "event_consumer"
  | "action_caller"
  | "action_provider"
  | "bridge";

export interface TransportCapabilities {
  delivery: Array<"ephemeral" | "at_least_once" | "durable_cursor" | "offline_queue">;
  ordering: Array<"none" | "source" | "subject">;
  cancellation: boolean;
  deadlines: boolean;
  provider_discovery?: boolean;
  max_payload_bytes?: number;
  outcome_retention_seconds?: number;
  request_deduplication?: boolean;
  cross_process_identity?: boolean;
}

export type AuthorizationOperation =
  | "register_event_source"
  | "publish_event"
  | "subscribe_event"
  | "register_action_provider"
  | "invoke_action"
  | "cancel_action";

export interface AuthorizationRequest {
  operation: AuthorizationOperation;
  principal: ImplementationIdentity;
  contract?: ContractRequirement | ExactContractReference;
  provider?: ImplementationIdentity;
  subject?: string;
}

export interface BridgeDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  principal?: ImplementationIdentity;
  contract?: ExactContractReference;
  cause?: unknown;
}

export interface BridgeDescription {
  profile_version: "0.1";
  transport: TransportCapabilities;
  contracts: Array<{
    artifact: ContractArtifact;
    reference: ExactContractReference;
  }>;
  event_sources: EventSourceDeclaration[];
  action_providers: ActionProviderDeclaration[];
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface InteropClient extends Disposable {
  readonly identity: ImplementationIdentity;
  registerEventSource(input: RegisterEventSourceInput): Promise<EventSourceRegistration>;
  publishEvent<T = unknown>(input: PublishEventInput<T>): Promise<PublishEventResult<T>>;
  subscribeEvents<T = unknown>(
    subscription: EventSubscription,
    handler: EventHandler<T>
  ): Promise<Disposable>;
  registerActionProvider(input: RegisterActionProviderInput): Promise<ActionProviderRegistration>;
  invokeAction<TInput = unknown, TOutput = unknown>(
    input: InvokeActionInput<TInput>
  ): Promise<ActionOutcome<TOutput>>;
  cancelAction(requestId: string, reason?: string): Promise<ActionOutcome | null>;
}

export interface EventSourceRegistration extends Disposable {
  declaration: EventSourceDeclaration;
}

export interface ActionProviderRegistration extends Disposable {
  declaration: ActionProviderDeclaration;
}

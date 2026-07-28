import type {
  ActionProviderHandlerDeclaration,
  BridgeDescription,
  CloudEvent,
  ContractRequirement,
  EventSourceDeclaration,
  ExactContractReference,
  ImplementationIdentity,
  ProviderSelector
} from "@callumalpass/mdbase-interop";

export const MDBASE_RUNTIME_PROFILE_VERSION = "0.2" as const;

export type RuntimeSeverity = "info" | "warning" | "error";

export interface RuntimeDiagnostic {
  severity: RuntimeSeverity;
  code: string;
  message: string;
  path?: string;
  details?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: RuntimeDiagnostic[];
}

export interface RuntimeRequirements {
  capabilities?: string[];
}

export interface RuntimeWorkflowTrigger {
  id: string;
  event: ContractRequirement;
  if?: ExpressionObject;
  debounce?: string;
  minimum_interval?: string;
}

export interface RuntimeWorkflowStep {
  id: string;
  name?: string;
  action: ContractRequirement;
  provider?: ProviderSelector;
  requires?: RuntimeRequirements;
  if?: ExpressionObject;
  input?: Record<string, ExpressionValue>;
  for_each?: {
    items: ExpressionValue;
    as?: string;
  };
}

export interface RuntimeWorkflow {
  type: "runtime_workflow";
  id: string;
  version: string;
  name: string;
  description?: string;
  enabled: boolean;
  requires?: RuntimeRequirements;
  vars?: Record<string, ExpressionValue>;
  triggers: RuntimeWorkflowTrigger[];
  steps: RuntimeWorkflowStep[];
  run?: RuntimeRunPolicy;
  [extension: `x-${string}`]: unknown;
}

export interface RuntimeRunPolicy {
  idempotency?: { key: ExpressionValue };
  concurrency?: {
    group?: ExpressionValue;
    policy: "skip" | "queue" | "replace" | "allow";
  };
  limits?: {
    timeout?: string;
    max_items?: number;
  };
  on_error?: "stop" | "continue";
}

export interface ExpressionObject {
  $expr: string;
}

export type ExpressionValue =
  | null
  | boolean
  | number
  | string
  | ExpressionObject
  | ExpressionValue[]
  | { [key: string]: ExpressionValue };

export interface RuntimeProviderSelection {
  contract: ContractRequirement;
  selector: ProviderSelector;
}

export interface RuntimeCapabilityGrant {
  capability: string;
  mode: "allow" | "deny";
  actions?: ContractRequirement[];
  providers?: ProviderSelector[];
  max_calls_per_run?: number;
  max_records_per_run?: number;
}

export interface RuntimePolicy {
  type: "runtime_policy";
  id: string;
  version: string;
  name?: string;
  enabled: boolean;
  executors?: {
    default?: string;
    workflows?: Record<string, string>;
  };
  provider_selections?: RuntimeProviderSelection[];
  grants: RuntimeCapabilityGrant[];
  [extension: `x-${string}`]: unknown;
}

export interface AdmittedEventBinding {
  contract: ExactContractReference;
  source: ImplementationIdentity;
  source_declaration_digest: string;
}

export interface AdmittedActionBinding {
  id: string;
  contract: ExactContractReference;
  provider: ImplementationIdentity;
  provider_declaration_digest: string;
  handler_id: string;
}

export interface AdmittedWorkflowPlan {
  profile_version: "0.2";
  workflow_revision: string;
  event: AdmittedEventBinding;
  steps: AdmittedActionBinding[];
}

export interface PreflightEventBinding {
  trigger_id: string;
  contract: ExactContractReference;
  sources: EventSourceDeclaration[];
}

export interface PreflightActionBinding extends AdmittedActionBinding {
  handler: ActionProviderHandlerDeclaration;
}

export interface RuntimePreflightPlan {
  profile_version: "0.2";
  workflow_revision: string;
  triggers: PreflightEventBinding[];
  steps: PreflightActionBinding[];
}

export interface RuntimePreflightResult extends ValidationResult {
  plan?: RuntimePreflightPlan;
}

export interface RuntimeAdmissionInput {
  workflow: RuntimeWorkflow;
  trigger_id: string;
  event: CloudEvent;
  bridge: BridgeDescription;
  policy: RuntimePolicy;
}

export interface RuntimeAdmissionResult extends ValidationResult {
  plan?: AdmittedWorkflowPlan;
}

export interface RuntimeRecordValidationResult extends ValidationResult {
  schema?: string;
}

export type {
  ActionProviderHandlerDeclaration,
  BridgeDescription,
  CloudEvent,
  ContractRequirement,
  EventSourceDeclaration,
  ExactContractReference,
  ImplementationIdentity,
  ProviderSelector
};

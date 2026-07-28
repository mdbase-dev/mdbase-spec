use jsonschema::{Draft, JSONSchema};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub const PROFILE_VERSION: &str = "0.1";
pub const CLOUDEVENTS_SPEC_VERSION: &str = "1.0";

const CONTRACT_SCHEMA: &str = include_str!("../schemas/data-contract.schema.json");
const PROFILE_SCHEMA: &str = include_str!("../schemas/profile.schema.json");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExactContractReference {
    pub id: String,
    pub version: String,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContractRequirement {
    pub id: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImplementationIdentity {
    pub application: String,
    pub implementation: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CloudEvent {
    pub specversion: String,
    pub id: String,
    pub source: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub datacontenttype: String,
    pub dataschema: String,
    pub data: Value,
    pub mdbaseprofile: String,
    pub mdbasecontractversion: String,
    pub mdbasecontractdigest: String,
    pub mdbaseapplication: String,
    pub mdbaseimplementation: String,
    pub mdbaseimplementationversion: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mdbaseinstanceid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlationid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causationid: Option<String>,
    #[serde(flatten)]
    pub extensions: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionRequest {
    pub kind: String,
    pub profile_version: String,
    pub request_id: String,
    pub contract: ContractRequirement,
    pub caller: ImplementationIdentity,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_provider: Option<ProviderSelector>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_context: Option<String>,
    pub input: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderSelector {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionInvocation {
    pub kind: String,
    pub profile_version: String,
    pub invocation_id: String,
    pub attempt_id: String,
    pub request_id: String,
    pub contract: ExactContractReference,
    pub caller: ImplementationIdentity,
    pub provider: ImplementationIdentity,
    pub provider_declaration_digest: String,
    pub handler_id: String,
    pub admitted_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_context: Option<String>,
    pub input: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortableError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionOutcome {
    pub kind: String,
    pub profile_version: String,
    pub outcome_id: String,
    pub request_id: String,
    pub invocation_id: String,
    pub attempt_id: String,
    pub contract: ExactContractReference,
    pub provider: ImplementationIdentity,
    pub provider_declaration_digest: String,
    pub status: String,
    pub completed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<PortableError>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventSourceContractDeclaration {
    pub requirement: ContractRequirement,
    pub resolved: ExactContractReference,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordering: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventSourceDeclaration {
    pub kind: String,
    pub profile_version: String,
    pub declaration_id: String,
    pub declaration_digest: String,
    pub source: ImplementationIdentity,
    pub contracts: Vec<EventSourceContractDeclaration>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderIdempotency {
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionProviderHandlerDeclaration {
    pub handler_id: String,
    pub requirement: ContractRequirement,
    pub resolved: ExactContractReference,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency: Option<ProviderIdempotency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancellation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_concurrency: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionProviderDeclaration {
    pub kind: String,
    pub profile_version: String,
    pub declaration_id: String,
    pub declaration_digest: String,
    pub provider: ImplementationIdentity,
    pub handlers: Vec<ActionProviderHandlerDeclaration>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionCancellation {
    pub kind: String,
    pub profile_version: String,
    pub cancellation_id: String,
    pub request_id: String,
    pub caller: ImplementationIdentity,
    pub requested_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportCapabilities {
    pub delivery: Vec<String>,
    pub ordering: Vec<String>,
    pub cancellation: bool,
    pub deadlines: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_discovery: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_payload_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome_retention_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_deduplication: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cross_process_identity: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConformanceEvidence {
    pub scenario: String,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteropConformanceClaim {
    pub kind: String,
    pub profile_version: String,
    pub implementation: ImplementationIdentity,
    pub roles: Vec<String>,
    pub transport: TransportCapabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Vec<ConformanceEvidence>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationIssue {
    pub instance_path: String,
    pub message: String,
}

pub fn validate_contract_artifact(value: &Value) -> Result<(), Vec<ValidationIssue>> {
    validate_with_schema(contract_schema(), value)
}

pub fn validate_profile_envelope(value: &Value) -> Result<(), Vec<ValidationIssue>> {
    validate_with_schema(profile_schema(), value)
}

pub fn contract_digest(artifact: &Value) -> Result<String, String> {
    validate_contract_artifact(artifact)
        .map_err(|issues| format!("invalid contract artifact: {}", format_issues(&issues)))?;
    let contract_type = required_string(artifact, "contract_type")?;
    let mut portable = Map::new();
    for key in ["kind", "contract_type", "id", "version"] {
        portable.insert(
            key.to_string(),
            artifact
                .get(key)
                .cloned()
                .ok_or_else(|| format!("missing {key}"))?,
        );
    }
    let fields: &[&str] = match contract_type {
        "record" => &["record_schema", "binding_schema"],
        "event" => &["data_schema", "source_schema"],
        "action" => &[
            "input_schema",
            "output_schema",
            "error_schema",
            "provider_schema",
            "behavior",
        ],
        _ => return Err(format!("unsupported contract_type {contract_type}")),
    };
    for field in fields {
        let Some(value) = artifact.get(*field) else {
            continue;
        };
        if *field == "behavior" {
            portable.insert((*field).to_string(), value.clone());
            continue;
        }
        let resolved = value
            .get("value")
            .cloned()
            .ok_or_else(|| format!("{field} must be resolved inline before digest calculation"))?;
        portable.insert((*field).to_string(), resolved);
    }
    let canonical =
        serde_jcs::to_vec(&Value::Object(portable)).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(canonical))))
}

pub fn validate_event(
    contract: &Value,
    event: &Value,
) -> Result<ExactContractReference, Vec<ValidationIssue>> {
    if let Err(issues) = validate_profile_envelope(event) {
        return Err(issues);
    }
    if contract.get("contract_type").and_then(Value::as_str) != Some("event") {
        return Err(vec![issue(
            "/",
            "resolved artifact is not an event contract",
        )]);
    }
    if let Err(issues) = validate_contract_artifact(contract) {
        return Err(issues);
    }
    let digest = contract_digest(contract).map_err(|message| vec![issue("/", &message)])?;
    let reference = ExactContractReference {
        id: required_string(contract, "id")
            .map_err(|message| vec![issue("/id", &message)])?
            .to_string(),
        version: required_string(contract, "version")
            .map_err(|message| vec![issue("/version", &message)])?
            .to_string(),
        digest,
    };
    let evidence_matches = event.get("type").and_then(Value::as_str) == Some(reference.id.as_str())
        && event.get("mdbasecontractversion").and_then(Value::as_str)
            == Some(reference.version.as_str())
        && event.get("mdbasecontractdigest").and_then(Value::as_str)
            == Some(reference.digest.as_str());
    if !evidence_matches {
        return Err(vec![issue("/", "event contract evidence is inconsistent")]);
    }
    let data_schema = contract.pointer("/data_schema/value").ok_or_else(|| {
        vec![issue(
            "/data_schema",
            "event data_schema must be resolved inline",
        )]
    })?;
    let data = event
        .get("data")
        .ok_or_else(|| vec![issue("/data", "event data is required")])?;
    if let Err(mut issues) = validate_with_value_schema(data_schema, data) {
        for issue in &mut issues {
            issue.instance_path = format!("/data{}", issue.instance_path);
        }
        return Err(issues);
    }
    Ok(reference)
}

pub fn validate_action_request(value: &Value) -> Result<ActionRequest, Vec<ValidationIssue>> {
    validate_kind_and_deserialize(value, "mdbase.action.request")
}

pub fn validate_action_invocation(value: &Value) -> Result<ActionInvocation, Vec<ValidationIssue>> {
    validate_kind_and_deserialize(value, "mdbase.action.invocation")
}

pub fn validate_action_outcome(value: &Value) -> Result<ActionOutcome, Vec<ValidationIssue>> {
    validate_kind_and_deserialize(value, "mdbase.action.outcome")
}

pub fn validate_event_source_declaration(
    value: &Value,
) -> Result<EventSourceDeclaration, Vec<ValidationIssue>> {
    validate_kind_and_deserialize(value, "mdbase.event-source")
}

pub fn validate_action_provider_declaration(
    value: &Value,
) -> Result<ActionProviderDeclaration, Vec<ValidationIssue>> {
    validate_kind_and_deserialize(value, "mdbase.action-provider")
}

pub fn validate_action_cancellation(
    value: &Value,
) -> Result<ActionCancellation, Vec<ValidationIssue>> {
    validate_kind_and_deserialize(value, "mdbase.action.cancel")
}

pub fn validate_conformance_claim(
    value: &Value,
) -> Result<InteropConformanceClaim, Vec<ValidationIssue>> {
    validate_kind_and_deserialize(value, "mdbase.interop.conformance")
}

fn validate_kind_and_deserialize<T>(value: &Value, kind: &str) -> Result<T, Vec<ValidationIssue>>
where
    T: for<'de> Deserialize<'de>,
{
    if value.get("kind").and_then(Value::as_str) != Some(kind) {
        return Err(vec![issue("/kind", &format!("expected {kind}"))]);
    }
    validate_profile_envelope(value)?;
    serde_json::from_value(value.clone())
        .map_err(|error| vec![issue("/", &format!("model decoding failed: {error}"))])
}

fn contract_schema() -> &'static JSONSchema {
    static SCHEMA: std::sync::OnceLock<JSONSchema> = std::sync::OnceLock::new();
    SCHEMA.get_or_init(|| compile(CONTRACT_SCHEMA))
}

fn profile_schema() -> &'static JSONSchema {
    static SCHEMA: std::sync::OnceLock<JSONSchema> = std::sync::OnceLock::new();
    SCHEMA.get_or_init(|| compile(PROFILE_SCHEMA))
}

fn compile(source: &str) -> JSONSchema {
    let schema: Value = serde_json::from_str(source).expect("canonical schema JSON");
    JSONSchema::options()
        .with_draft(Draft::Draft202012)
        .compile(&schema)
        .expect("canonical schema compiles")
}

fn validate_with_schema(schema: &JSONSchema, value: &Value) -> Result<(), Vec<ValidationIssue>> {
    match schema.validate(value) {
        Ok(()) => Ok(()),
        Err(errors) => Err(errors
            .map(|error| ValidationIssue {
                instance_path: error.instance_path.to_string(),
                message: error.to_string(),
            })
            .collect()),
    }
}

fn validate_with_value_schema(schema: &Value, value: &Value) -> Result<(), Vec<ValidationIssue>> {
    let compiled = JSONSchema::options()
        .with_draft(Draft::Draft202012)
        .compile(schema)
        .map_err(|error| {
            vec![issue(
                "/",
                &format!("embedded schema does not compile: {error}"),
            )]
        })?;
    validate_with_schema(&compiled, value)
}

fn required_string<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{field} must be a string"))
}

fn issue(path: &str, message: &str) -> ValidationIssue {
    ValidationIssue {
        instance_path: path.to_string(),
        message: message.to_string(),
    }
}

fn format_issues(issues: &[ValidationIssue]) -> String {
    issues
        .iter()
        .map(|issue| format!("{} {}", issue.instance_path, issue.message))
        .collect::<Vec<_>>()
        .join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event_contract() -> Value {
        json!({
            "kind": "mdbase.contract",
            "contract_type": "event",
            "id": "tasknotes.task.completed",
            "version": "1.0.0",
            "data_schema": {
                "dialect": "json-schema-2020-12",
                "value": {
                    "type": "object",
                    "required": ["task_id"],
                    "additionalProperties": false,
                    "properties": { "task_id": { "type": "string" } }
                }
            }
        })
    }

    #[test]
    fn digest_is_deterministic_and_excludes_human_metadata() {
        let contract = event_contract();
        let mut renamed = contract.clone();
        renamed["name"] = json!("A human label");
        assert_eq!(
            contract_digest(&contract).unwrap(),
            contract_digest(&renamed).unwrap()
        );
    }

    #[test]
    fn validates_cloud_event_and_exact_data_contract() {
        let contract = event_contract();
        let digest = contract_digest(&contract).unwrap();
        let event = json!({
            "specversion": "1.0",
            "id": "evt_01",
            "source": "urn:mdbase:app:tasknotes:tasknotes.obsidian",
            "type": "tasknotes.task.completed",
            "time": "2026-07-28T01:30:00Z",
            "datacontenttype": "application/json",
            "dataschema": format!("urn:mdbase:contract:tasknotes.task.completed:1.0.0:{digest}"),
            "data": { "task_id": "task-123" },
            "mdbaseprofile": "0.1",
            "mdbasecontractversion": "1.0.0",
            "mdbasecontractdigest": digest,
            "mdbaseapplication": "tasknotes",
            "mdbaseimplementation": "tasknotes.obsidian",
            "mdbaseimplementationversion": "5.0.0"
        });
        let exact = validate_event(&contract, &event).unwrap();
        assert_eq!(exact.id, "tasknotes.task.completed");

        let mut invalid = event;
        invalid["data"] = json!({});
        assert!(validate_event(&contract, &invalid).is_err());
    }

    #[test]
    fn decodes_action_request() {
        let request = json!({
            "kind": "mdbase.action.request",
            "profile_version": "0.1",
            "request_id": "req_01",
            "contract": { "id": "canvas.card.create", "version": "^1.0.0" },
            "caller": {
                "application": "tasknotes-workflows",
                "implementation": "tasknotes-workflows.obsidian",
                "version": "1.0.0"
            },
            "created_at": "2026-07-28T01:30:00Z",
            "input": { "title": "Card" }
        });
        assert_eq!(
            validate_action_request(&request).unwrap().request_id,
            "req_01"
        );
    }

    #[test]
    fn decodes_exact_provider_declaration_evidence() {
        let declaration = json!({
            "kind": "mdbase.action-provider",
            "profile_version": "0.1",
            "declaration_id": "canvas.actions",
            "declaration_digest": format!("sha256:{}", "0".repeat(64)),
            "provider": {
                "application": "canvas-bases",
                "implementation": "canvas-bases.obsidian",
                "version": "1.0.0"
            },
            "handlers": [{
                "handler_id": "canvas.card.create",
                "requirement": {
                    "id": "canvas.card.create",
                    "version": "^1.0.0"
                },
                "resolved": {
                    "id": "canvas.card.create",
                    "version": "1.0.0",
                    "digest": format!("sha256:{}", "1".repeat(64))
                },
                "idempotency": {
                    "mode": "request",
                    "retention_seconds": 300
                }
            }]
        });
        let decoded = validate_action_provider_declaration(&declaration).unwrap();
        assert_eq!(decoded.handlers[0].resolved.version, "1.0.0");
    }

    #[test]
    fn embedded_release_schemas_match_the_canonical_repository_copies() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let canonical_contract = root.join("schemas/v0.3/data-contract.schema.json");
        let canonical_profile = root.join("schemas/interop/v0.1/profile.schema.json");
        if canonical_contract.exists() {
            assert_eq!(
                std::fs::read_to_string(canonical_contract).unwrap(),
                CONTRACT_SCHEMA
            );
            assert_eq!(
                std::fs::read_to_string(canonical_profile).unwrap(),
                PROFILE_SCHEMA
            );
        }
    }
}

use cfrm::{
    accounting::AccountProofScope,
    accounting_ledger::{AccountLedger, AccountLedgerPolicy},
    accounting_service::{
        AccountService, AccountServiceRequest, ProcessAccountVerifier, ProcessVerifierConfig,
    },
    admission::{AdmissionGrant, AdmissionTrust, DeviceAuthorization},
    board::{BoardLimits, MeetingBoard, PresenceUpdate},
    discovery::{DiscoveryLimits, DiscoveryOperation, DiscoveryRequest, DiscoveryService},
    discovery_control::SqliteDiscoveryControl,
    discovery_valkey::{ValkeyConfig, ValkeyDiscoveryStore},
    key_access::{
        KeyAccessIssuance, KeyAccessIssueRequest, KeyAccessIssuer, KeyAccessPolicy,
        KeyAccessRedeemer, KeyAccessRedemption,
    },
    permits::PermitEpoch,
    storage::RemoteConfig,
    Error as CfrmError,
};
use cmsg::{
    verify_accounting_delegation, AccountingDelegation, AdmissionTrust as CmsgAdmissionTrust,
};
use data_encoding::BASE64URL_NOPAD;
use ed25519_dalek::SigningKey;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{self, BufRead, BufReader, Read, Write},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_KEY_BYTES: usize = 4096;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeConfig {
    max_line_bytes: usize,
    max_response_bytes: usize,
    max_pending: usize,
    deadline_millis: u64,
    max_stderr_bytes: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TrustConfig {
    community_id: String,
    policy_digest: String,
    issuer_public_key: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ValkeyConfigFile {
    url: String,
    namespace: String,
    pool_size: u32,
    connect_timeout_millis: u64,
    io_timeout_millis: u64,
    pool_timeout_millis: u64,
    allow_plaintext_loopback: bool,
    root_certificate_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiscoveryConfig {
    control_database_path: Option<String>,
    control_busy_timeout_millis: Option<u64>,
    limits: DiscoveryLimits,
    valkey: ValkeyConfigFile,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PresenceConfig {
    max_members: usize,
    max_devices_per_member: usize,
    max_lease_seconds: u64,
    max_replay_entries: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyAccessConfig {
    issuer_database_path: Option<String>,
    redeemer_database_path: Option<String>,
    issuer_private_der_path: String,
    redeemer_private_key_path: String,
    epoch: PermitEpoch,
    policy: KeyAccessPolicy,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountVerifierConfig {
    node_path: String,
    script_path: String,
    artifact_config_path: String,
    scope: AccountProofScope,
    timeout_millis: u64,
    maximum_parallel: usize,
    max_proof_bytes: usize,
    node_heap_megabytes: usize,
}

/// Operator-provisioned common roots, independently verified before configuration.
/// This type is deliberately absent from the member RPC request surface.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountCheckpoint {
    slot: u64,
    root: [u8; 32],
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountConfig {
    database_path: Option<String>,
    operator_private_key_path: String,
    policy: AccountLedgerPolicy,
    max_request_bytes: usize,
    verifier: AccountVerifierConfig,
    checkpoints: Vec<AccountCheckpoint>,
}

// Storage credentials are deliberately excluded from Debug and RPC types.
#[derive(Deserialize)]
#[serde(tag = "driver", rename_all = "lowercase", deny_unknown_fields)]
enum StorageConfig {
    Sqlite {},
    Turso {
        url: String,
        #[serde(rename = "authToken")]
        auth_token: Option<String>,
        #[serde(rename = "authTokenPath")]
        auth_token_path: Option<String>,
        #[serde(rename = "networkTimeoutMs")]
        network_timeout_ms: u64,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfigFile {
    storage: Option<StorageConfig>,
    runtime: RuntimeConfig,
    trust: TrustConfig,
    discovery: DiscoveryConfig,
    presence: PresenceConfig,
    key_access: KeyAccessConfig,
    account: AccountConfig,
}

struct Runtime {
    config: RuntimeConfig,
    remote_storage: bool,
    cmsg_trust: CmsgAdmissionTrust,
    discovery: DiscoveryService<ValkeyDiscoveryStore>,
    board: Mutex<MeetingBoard>,
    issuer: Mutex<KeyAccessIssuer>,
    redeemer: Mutex<KeyAccessRedeemer>,
    account: Mutex<AccountService<ProcessAccountVerifier, fn() -> u64>>,
}

#[derive(Debug)]
enum ServiceError {
    InvalidRequest,
    Admission,
    Capacity,
    Expired,
    Replay,
    Storage,
    Timeout,
    Unsupported,
    Internal,
}

impl ServiceError {
    fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::Admission => "admission_rejected",
            Self::Capacity => "capacity",
            Self::Expired => "expired",
            Self::Replay => "replay",
            Self::Storage => "storage",
            Self::Timeout => "deadline_exceeded",
            Self::Unsupported => "unsupported",
            Self::Internal => "backend_unavailable",
        }
    }
}

impl From<CfrmError> for ServiceError {
    fn from(error: CfrmError) -> Self {
        match error {
            CfrmError::InvalidInput => Self::InvalidRequest,
            CfrmError::Admission | CfrmError::Signature | CfrmError::PolicyMismatch => {
                Self::Admission
            }
            CfrmError::Expired | CfrmError::ClockRollback => Self::Expired,
            CfrmError::Replay => Self::Replay,
            CfrmError::Capacity | CfrmError::NoAllowance => Self::Capacity,
            CfrmError::Storage => Self::Storage,
            CfrmError::UnsupportedCapability => Self::Unsupported,
            CfrmError::CryptoProvider => Self::Internal,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Principal {
    Member {
        #[serde(rename = "memberId")]
        member_id: String,
    },
    Anonymous,
    Trusted,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RpcRequest {
    id: String,
    op: String,
    payload: Value,
    principal: Principal,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PresenceInput {
    grant: AdmissionGrant,
    authorization: DeviceAuthorization,
    update: PresenceUpdate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyIssueInput {
    grant: AdmissionGrant,
    authorization: DeviceAuthorization,
    request: KeyAccessIssueRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KeyRedeemInput {
    request: KeyAccessRedemption,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DelegationVerifyInput {
    delegation: AccountingDelegation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnrollmentCheckpointInput {
    slot: u64,
    root: [u8; 32],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcSuccess {
    id: String,
    ok: bool,
    result: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcFailure {
    id: String,
    ok: bool,
    error: RpcError,
}

#[derive(Serialize)]
struct RpcError {
    code: &'static str,
}

fn absolute_path(value: &str) -> Result<PathBuf, ServiceError> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(ServiceError::InvalidRequest);
    }
    Ok(path)
}

fn decode_32(value: &str) -> Result<[u8; 32], ServiceError> {
    let bytes = BASE64URL_NOPAD
        .decode(value.as_bytes())
        .map_err(|_| ServiceError::InvalidRequest)?;
    bytes.try_into().map_err(|_| ServiceError::InvalidRequest)
}

fn read_bounded(path: &Path, maximum: usize) -> Result<Vec<u8>, ServiceError> {
    let metadata = fs::metadata(path).map_err(|_| ServiceError::Storage)?;
    if !metadata.is_file() || metadata.len() > maximum as u64 {
        return Err(ServiceError::InvalidRequest);
    }
    let mut file = File::open(path).map_err(|_| ServiceError::Storage)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((maximum + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ServiceError::Storage)?;
    if bytes.len() > maximum {
        return Err(ServiceError::InvalidRequest);
    }
    Ok(bytes)
}

fn read_private(path: &Path, maximum: usize) -> Result<Vec<u8>, ServiceError> {
    let file = File::open(path).map_err(|_| ServiceError::Storage)?;
    let metadata = file.metadata().map_err(|_| ServiceError::Storage)?;
    if !metadata.is_file()
        || metadata.len() > maximum as u64
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(ServiceError::InvalidRequest);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((maximum + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ServiceError::Storage)?;
    if bytes.len() != metadata.len() as usize {
        bytes.fill(0);
        return Err(ServiceError::InvalidRequest);
    }
    Ok(bytes)
}

fn remote_config(input: Option<StorageConfig>) -> Result<Option<RemoteConfig>, ServiceError> {
    let Some(StorageConfig::Turso {
        url,
        auth_token,
        auth_token_path,
        network_timeout_ms,
    }) = input
    else {
        // The existing CI configuration explicitly names every SQLite file.
        return Ok(None);
    };
    if !(url.starts_with("https://") || url.starts_with("libsql://"))
        || url.len() > 2048
        || network_timeout_ms == 0
        || network_timeout_ms > 60_000
    {
        return Err(ServiceError::InvalidRequest);
    }
    let token = match (auth_token, auth_token_path) {
        (Some(token), None) => token,
        (None, Some(path)) => {
            let mut bytes = read_private(&absolute_path(&path)?, 2050)?;
            let result = std::str::from_utf8(&bytes)
                .map(|value| {
                    value
                        .strip_suffix("\r\n")
                        .or_else(|| value.strip_suffix('\n'))
                        .unwrap_or(value)
                        .to_owned()
                })
                .map_err(|_| ServiceError::InvalidRequest);
            bytes.fill(0);
            result?
        }
        _ => return Err(ServiceError::InvalidRequest),
    };
    if token.is_empty()
        || token.len() > 2048
        || !token.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err(ServiceError::InvalidRequest);
    }
    Ok(Some(RemoteConfig {
        url,
        auth_token: token,
        timeout: Duration::from_millis(network_timeout_ms),
    }))
}

fn copy_remote(config: &RemoteConfig) -> RemoteConfig {
    RemoteConfig {
        url: config.url.clone(),
        auth_token: config.auth_token.clone(),
        timeout: config.timeout,
    }
}

fn sqlite_path(value: &Option<String>) -> Result<PathBuf, ServiceError> {
    absolute_path(value.as_deref().ok_or(ServiceError::InvalidRequest)?)
}

fn parse_payload<T: DeserializeOwned>(payload: Value) -> Result<T, ServiceError> {
    serde_json::from_value(payload).map_err(|_| ServiceError::InvalidRequest)
}

fn now_seconds() -> Result<u64, ServiceError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ServiceError::Internal)
        .map(|duration| duration.as_secs())
}

// The ledger rejects zero and clock rollback. A failed system clock never becomes
// a caller-selected proof time or a successful account operation.
fn account_clock() -> u64 {
    now_seconds().unwrap_or(0)
}

fn require_member(principal: &Principal, member_id: &str) -> Result<(), ServiceError> {
    match principal {
        Principal::Member { member_id: caller } if caller == member_id => Ok(()),
        _ => Err(ServiceError::Admission),
    }
}

fn trust(config: &TrustConfig) -> Result<AdmissionTrust, ServiceError> {
    Ok(AdmissionTrust {
        community_id: config.community_id.clone(),
        policy_digest: config.policy_digest.clone(),
        issuer_public_key: decode_32(&config.issuer_public_key)?,
    })
}

fn load_config(path: &Path) -> Result<Runtime, ServiceError> {
    let mut bytes = read_private(path, MAX_CONFIG_BYTES as usize)?;
    let parsed =
        serde_json::from_slice::<ConfigFile>(&bytes).map_err(|_| ServiceError::InvalidRequest);
    bytes.fill(0);
    let file = parsed?;
    let remote = remote_config(file.storage)?;
    if remote.is_some()
        && (file.account.database_path.is_some()
            || file.discovery.control_database_path.is_some()
            || file.discovery.control_busy_timeout_millis.is_some()
            || file.key_access.issuer_database_path.is_some()
            || file.key_access.redeemer_database_path.is_some())
    {
        return Err(ServiceError::InvalidRequest);
    }
    if file.runtime.max_line_bytes == 0
        || file.runtime.max_response_bytes == 0
        || file.runtime.max_pending == 0
        || file.runtime.max_pending > 64
        || file.runtime.deadline_millis == 0
        || file.runtime.max_stderr_bytes == 0
        || (remote.is_none()
            && !file
                .discovery
                .control_busy_timeout_millis
                .is_some_and(|value| value > 0))
        || file.discovery.valkey.pool_size == 0
        || file.discovery.valkey.connect_timeout_millis == 0
        || file.discovery.valkey.io_timeout_millis == 0
        || file.discovery.valkey.pool_timeout_millis == 0
        || file.account.max_request_bytes > file.runtime.max_line_bytes
        || file.account.policy.max_proof_bytes != file.account.verifier.max_proof_bytes
        || file.account.verifier.timeout_millis >= file.runtime.deadline_millis
    {
        return Err(ServiceError::InvalidRequest);
    }
    let trusted = trust(&file.trust)?;
    let cmsg_trust = CmsgAdmissionTrust {
        community_id: file.trust.community_id.clone(),
        policy_digest: file.trust.policy_digest.clone(),
        issuer_public_key: decode_32(&file.trust.issuer_public_key)?,
    };
    let account_config = file.account;
    let verifier = ProcessAccountVerifier::new(ProcessVerifierConfig {
        node: absolute_path(&account_config.verifier.node_path)?,
        script: absolute_path(&account_config.verifier.script_path)?,
        artifact_config: absolute_path(&account_config.verifier.artifact_config_path)?,
        scope: account_config.verifier.scope,
        timeout: Duration::from_millis(account_config.verifier.timeout_millis),
        maximum_parallel: account_config.verifier.maximum_parallel,
        max_proof_bytes: account_config.verifier.max_proof_bytes,
        node_heap_megabytes: account_config.verifier.node_heap_megabytes,
    })?;
    let operator_key = read_bounded(
        &absolute_path(&account_config.operator_private_key_path)?,
        32,
    )?;
    let operator_key: [u8; 32] = operator_key
        .try_into()
        .map_err(|_| ServiceError::InvalidRequest)?;
    let ledger = match &remote {
        Some(config) => AccountLedger::open_remote(
            copy_remote(config),
            trusted.clone(),
            account_config.policy,
            verifier,
            SigningKey::from_bytes(&operator_key),
        ),
        None => AccountLedger::open(
            sqlite_path(&account_config.database_path)?,
            trusted.clone(),
            account_config.policy,
            verifier,
            SigningKey::from_bytes(&operator_key),
        ),
    }?;
    let mut account = AccountService::new(
        ledger,
        account_clock as fn() -> u64,
        account_config.max_request_bytes,
    )?;
    for checkpoint in account_config.checkpoints {
        account.publish_verified_checkpoint(checkpoint.slot, checkpoint.root)?;
    }
    let control = Arc::new(match &remote {
        Some(config) => SqliteDiscoveryControl::open_remote(copy_remote(config)),
        None => SqliteDiscoveryControl::open(
            sqlite_path(&file.discovery.control_database_path)?,
            Duration::from_millis(
                file.discovery
                    .control_busy_timeout_millis
                    .ok_or(ServiceError::InvalidRequest)?,
            ),
        ),
    }?);
    let root_certificate = file
        .discovery
        .valkey
        .root_certificate_path
        .as_deref()
        .map(|value| absolute_path(value).and_then(|path| read_bounded(&path, 1024 * 1024)))
        .transpose()?;
    let valkey = ValkeyDiscoveryStore::connect(
        ValkeyConfig {
            url: file.discovery.valkey.url,
            namespace: file.discovery.valkey.namespace,
            pool_size: file.discovery.valkey.pool_size,
            connect_timeout: Duration::from_millis(file.discovery.valkey.connect_timeout_millis),
            io_timeout: Duration::from_millis(file.discovery.valkey.io_timeout_millis),
            pool_timeout: Duration::from_millis(file.discovery.valkey.pool_timeout_millis),
            allow_plaintext_loopback: file.discovery.valkey.allow_plaintext_loopback,
            root_certificate_pem: root_certificate,
        },
        control,
    )?;
    let discovery = DiscoveryService::new(trusted.clone(), file.discovery.limits, valkey)?;
    let board = MeetingBoard::new(
        trusted.clone(),
        BoardLimits {
            max_members: file.presence.max_members,
            max_devices_per_member: file.presence.max_devices_per_member,
            max_lease_seconds: file.presence.max_lease_seconds,
            max_replay_entries: file.presence.max_replay_entries,
        },
    )?;
    let issuer_key_path = absolute_path(&file.key_access.issuer_private_der_path)?;
    let redeemer_key_path = absolute_path(&file.key_access.redeemer_private_key_path)?;
    let issuer_key = read_bounded(&issuer_key_path, MAX_KEY_BYTES)?;
    let redeemer_key = read_bounded(&redeemer_key_path, 32)?;
    let redeemer_key: [u8; 32] = redeemer_key
        .try_into()
        .map_err(|_| ServiceError::InvalidRequest)?;
    let issuer = match &remote {
        Some(config) => KeyAccessIssuer::open_remote(
            copy_remote(config),
            trusted,
            file.key_access.epoch.clone(),
            file.key_access.policy,
            &issuer_key,
        ),
        None => KeyAccessIssuer::open(
            sqlite_path(&file.key_access.issuer_database_path)?,
            trusted,
            file.key_access.epoch.clone(),
            file.key_access.policy,
            &issuer_key,
        ),
    }?;
    let redeemer = match &remote {
        Some(config) => KeyAccessRedeemer::open_remote(
            copy_remote(config),
            file.key_access.epoch,
            SigningKey::from_bytes(&redeemer_key),
        ),
        None => KeyAccessRedeemer::open(
            sqlite_path(&file.key_access.redeemer_database_path)?,
            file.key_access.epoch,
            SigningKey::from_bytes(&redeemer_key),
        ),
    }?;
    Ok(Runtime {
        config: file.runtime,
        remote_storage: remote.is_some(),
        cmsg_trust,
        discovery,
        board: Mutex::new(board),
        issuer: Mutex::new(issuer),
        redeemer: Mutex::new(redeemer),
        account: Mutex::new(account),
    })
}

impl Runtime {
    fn dispatch(&self, request: RpcRequest) -> Result<Value, ServiceError> {
        let RpcRequest {
            id,
            op,
            payload,
            principal,
        } = request;
        if id.is_empty() || id.len() > 128 || !id.is_ascii() {
            return Err(ServiceError::InvalidRequest);
        }
        match op.as_str() {
            "health" => {
                if !matches!(principal, Principal::Anonymous) || payload != json!({}) {
                    return Err(ServiceError::InvalidRequest);
                }
                Ok(json!({ "ready": true }))
            }
            "discovery" => {
                let request: DiscoveryRequest = parse_payload(payload)?;
                require_member(&principal, &request.admission.member_id)?;
                Ok(
                    serde_json::to_value(self.discovery.execute(&request, now_seconds()?)?)
                        .map_err(|_| ServiceError::Internal)?,
                )
            }
            "presence_apply" => {
                let input: PresenceInput = parse_payload(payload)?;
                require_member(&principal, &input.grant.member_id)?;
                let now = now_seconds()?;
                self.board
                    .lock()
                    .map_err(|_| ServiceError::Internal)?
                    .apply(&input.grant, &input.authorization, &input.update, now)?;
                Ok(json!({ "applied": true }))
            }
            "presence_lookup" => {
                let request: DiscoveryRequest = parse_payload(payload)?;
                require_member(&principal, &request.admission.member_id)?;
                let target_member_id = match &request.operation {
                    DiscoveryOperation::Fetch { member_id } => member_id.clone(),
                    _ => return Err(ServiceError::InvalidRequest),
                };
                let now = now_seconds()?;
                let discovery = self.discovery.execute(&request, now)?;
                let presence = self
                    .board
                    .lock()
                    .map_err(|_| ServiceError::Internal)?
                    .snapshot(now)?
                    .into_iter()
                    .find(|member| member.member_id == target_member_id);
                Ok(json!({ "discovery": discovery, "presence": presence }))
            }
            "presence_directory" => {
                let request: DiscoveryRequest = parse_payload(payload)?;
                require_member(&principal, &request.admission.member_id)?;
                match &request.operation {
                    DiscoveryOperation::Query {
                        filters,
                        after: None,
                        ..
                    } if filters.is_empty() => {}
                    _ => return Err(ServiceError::InvalidRequest),
                }
                // DiscoveryService performs the existing signed request,
                // admission, deadline, replay, quota, and community checks.
                // Its page is deliberately not returned: this operation is
                // the bounded presence directory, while profile fetching has
                // its separate API operation.
                let now = now_seconds()?;
                self.discovery.execute(&request, now)?;
                let presence = self
                    .board
                    .lock()
                    .map_err(|_| ServiceError::Internal)?
                    .snapshot(now)?;
                let result = json!({ "presence": presence });
                if serde_json::to_vec(&RpcSuccess {
                    id: id.clone(),
                    ok: true,
                    result: result.clone(),
                })
                .map_err(|_| ServiceError::Internal)?
                .len()
                    > self.config.max_response_bytes
                {
                    return Err(ServiceError::Capacity);
                }
                Ok(result)
            }
            "key_issue" => {
                let input: KeyIssueInput = parse_payload(payload)?;
                require_member(&principal, &input.grant.member_id)?;
                let now = now_seconds()?;
                let issuance: KeyAccessIssuance = self
                    .issuer
                    .lock()
                    .map_err(|_| ServiceError::Internal)?
                    .issue(&input.grant, &input.authorization, &input.request, || now)?;
                serde_json::to_value(issuance).map_err(|_| ServiceError::Internal)
            }
            "key_redeem" => {
                if !matches!(principal, Principal::Anonymous) {
                    return Err(ServiceError::Admission);
                }
                let input: KeyRedeemInput = parse_payload(payload)?;
                let now = now_seconds()?;
                let stamp = self
                    .redeemer
                    .lock()
                    .map_err(|_| ServiceError::Internal)?
                    .redeem(&input.request, || now)?;
                serde_json::to_value(stamp).map_err(|_| ServiceError::Internal)
            }
            "verify_accounting_delegation" => {
                let input: DelegationVerifyInput = parse_payload(payload)?;
                require_member(&principal, &input.delegation.admission.member_id)?;
                let now = now_seconds()?;
                verify_accounting_delegation(&input.delegation, &self.cmsg_trust, now)
                    .map_err(|_| ServiceError::Admission)?;
                let digest = input
                    .delegation
                    .digest()
                    .map_err(|_| ServiceError::Admission)?;
                Ok(json!({ "digest": BASE64URL_NOPAD.encode(&digest) }))
            }
            "install_enrollment_checkpoint" => {
                if !matches!(principal, Principal::Trusted) {
                    return Err(ServiceError::Admission);
                }
                let input: EnrollmentCheckpointInput = parse_payload(payload)?;
                self.account
                    .lock()
                    .map_err(|_| ServiceError::Internal)?
                    .publish_verified_checkpoint(input.slot, input.root)?;
                Ok(json!({ "installed": true }))
            }
            "account" => {
                let bytes =
                    serde_json::to_vec(&payload).map_err(|_| ServiceError::InvalidRequest)?;
                let mut account = self.account.lock().map_err(|_| ServiceError::Internal)?;
                if bytes.len() > account.max_request_bytes() {
                    return Err(ServiceError::Capacity);
                }
                let request: AccountServiceRequest = parse_payload(payload)?;
                let grant = match &request {
                    AccountServiceRequest::Apply { grant, .. }
                    | AccountServiceRequest::Status { grant, .. } => grant,
                };
                require_member(&principal, &grant.member_id)?;
                serde_json::to_value(account.handle(request)?).map_err(|_| ServiceError::Internal)
            }
            _ => Err(ServiceError::InvalidRequest),
        }
    }
}

fn write_response<W: Write>(
    writer: &mut W,
    response: &impl Serialize,
    max_bytes: usize,
) -> io::Result<()> {
    let bytes = serde_json::to_vec(response)
        .map_err(|_| io::Error::new(io::ErrorKind::Other, "serialization"))?;
    if bytes.len() > max_bytes {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "response limit"));
    }
    writer.write_all(&bytes)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

enum InputLine {
    Eof,
    TooLarge,
    Data(Vec<u8>),
}

fn read_bounded_line<R: BufRead>(reader: &mut R, maximum: usize) -> io::Result<InputLine> {
    let mut line = Vec::with_capacity(maximum.min(64 * 1024));
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(InputLine::Eof)
            } else {
                Ok(InputLine::Data(line))
            };
        }
        let end = available.iter().position(|byte| *byte == b'\n');
        let take = end.map_or(available.len(), |position| position + 1);
        if line.len().saturating_add(take) > maximum {
            return Ok(InputLine::TooLarge);
        }
        line.extend_from_slice(&available[..take]);
        reader.consume(take);
        if end.is_some() {
            return Ok(InputLine::Data(line));
        }
    }
}

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let config_path = match args.as_slice() {
        [_, flag, path] if flag == "--config" => PathBuf::from(path),
        _ => {
            let _ = writeln!(io::stderr(), "native backend requires --config");
            std::process::exit(64);
        }
    };
    if !config_path.is_absolute() {
        let _ = writeln!(io::stderr(), "native backend config path must be absolute");
        std::process::exit(64);
    }
    let runtime = match load_config(&config_path) {
        Ok(runtime) => runtime,
        Err(_) => {
            let _ = writeln!(io::stderr(), "native backend configuration rejected");
            std::process::exit(78);
        }
    };
    let max_line_bytes = runtime.config.max_line_bytes;
    let max_response_bytes = runtime.config.max_response_bytes;
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    loop {
        let line = match read_bounded_line(&mut reader, max_line_bytes) {
            Ok(InputLine::Eof) => break,
            Ok(InputLine::TooLarge) => {
                let failure = RpcFailure {
                    id: String::new(),
                    ok: false,
                    error: RpcError {
                        code: "request_too_large",
                    },
                };
                if write_response(&mut stdout, &failure, max_response_bytes).is_err() {
                    break;
                }
                break;
            }
            Ok(InputLine::Data(line)) => line,
            Err(_) => break,
        };
        let id = serde_json::from_slice::<Value>(&line)
            .ok()
            .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_default();
        let started = Instant::now();
        let result = serde_json::from_slice::<RpcRequest>(&line)
            .map_err(|_| ServiceError::InvalidRequest)
            .and_then(|request| runtime.dispatch(request));
        let result = if started.elapsed() > Duration::from_millis(runtime.config.deadline_millis) {
            Err(ServiceError::Timeout)
        } else {
            result
        };
        let response = match result {
            Ok(result) => RpcSuccess {
                id,
                ok: true,
                result: result,
            },
            Err(error) => {
                // A remote SQL error or elapsed operation deadline may have
                // committed. Return failure once, then retire all handles.
                // The supervisor must reopen durable state; never retry here.
                let retire = runtime.remote_storage
                    && matches!(&error, ServiceError::Storage | ServiceError::Timeout);
                let failure = RpcFailure {
                    id,
                    ok: false,
                    error: RpcError { code: error.code() },
                };
                if write_response(&mut stdout, &failure, max_response_bytes).is_err() {
                    break;
                }
                if retire {
                    break;
                }
                continue;
            }
        };
        if write_response(&mut stdout, &response, max_response_bytes).is_err() {
            break;
        }
    }
}

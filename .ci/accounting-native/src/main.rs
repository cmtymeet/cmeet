//! CI-only process adapter. The trusted driver selects the clock, operator key,
//! paths and independently verified checkpoints. Browser input selects none of
//! them. Account and delegation verification use the shipped library code.
use cfrm::{
    accounting::AccountProofScope,
    accounting_ledger::{AccountLedger, AccountLedgerPolicy},
    accounting_service::{AccountService, ProcessAccountVerifier, ProcessVerifierConfig},
    admission::AdmissionTrust,
};
use ed25519_dalek::SigningKey;
use serde::Deserialize;
use std::{
    io::{Read, Write},
    path::PathBuf,
    time::Duration,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    community_id: String,
    policy_digest: String,
    issuer_public_key: [u8; 32],
    now: u64,
    database: PathBuf,
    operator_key: PathBuf,
    node: PathBuf,
    verifier_script: PathBuf,
    artifact_config: PathBuf,
    scope: AccountProofScope,
    policy: AccountLedgerPolicy,
    checkpoints: Vec<Checkpoint>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Checkpoint {
    slot: u64,
    root: [u8; 32],
}

fn run() -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    if std::env::var("CI").as_deref() != Ok("true") {
        return Err("remote CI fixture only".into());
    }
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 || !["account", "delegation"].contains(&args[2].as_str()) {
        return Err("trusted configuration and operation required".into());
    }
    let bytes = std::fs::read(&args[1])?;
    if bytes.len() > 1024 * 1024 {
        return Err("configuration bound".into());
    }
    let config: Config = serde_json::from_slice(&bytes)?;
    let mut input = Vec::new();
    std::io::stdin().take(4_194_305).read_to_end(&mut input)?;
    if input.len() > 4_194_304 {
        return Err("request bound".into());
    }
    if args[2] == "delegation" {
        let delegation: cmsg::AccountingDelegation = serde_json::from_slice(&input)?;
        cmsg::verify_accounting_delegation(
            &delegation,
            &cmsg::AdmissionTrust {
                community_id: config.community_id,
                policy_digest: config.policy_digest,
                issuer_public_key: config.issuer_public_key,
            },
            config.now,
        )
        .map_err(|_| "delegation rejected")?;
        return Ok(serde_json::to_vec(
            &delegation
                .digest()
                .map_err(|_| "delegation digest rejected")?,
        )?);
    }
    let verifier = ProcessAccountVerifier::new(ProcessVerifierConfig {
        node: config.node,
        script: config.verifier_script,
        artifact_config: config.artifact_config,
        scope: config.scope,
        timeout: Duration::from_secs(120),
        maximum_parallel: 1,
        max_proof_bytes: config.policy.max_proof_bytes,
        node_heap_megabytes: 1024,
    })?;
    let key: [u8; 32] = std::fs::read(config.operator_key)?
        .try_into()
        .map_err(|_| "operator key width")?;
    let ledger = AccountLedger::open(
        config.database,
        AdmissionTrust {
            community_id: config.community_id,
            policy_digest: config.policy_digest,
            issuer_public_key: config.issuer_public_key,
        },
        config.policy,
        verifier,
        SigningKey::from_bytes(&key),
    )?;
    let at = config.now;
    let mut service = AccountService::new(ledger, move || at, 4_194_304)?;
    for checkpoint in config.checkpoints {
        service.publish_verified_checkpoint(checkpoint.slot, checkpoint.root)?;
    }
    Ok(service.handle_json(&input)?)
}

fn main() {
    match run() {
        Ok(bytes) => {
            if bytes.len() > 4_194_304 || std::io::stdout().write_all(&bytes).is_err() {
                std::process::exit(1);
            }
        }
        Err(_) => {
            eprintln!("accounting contract request rejected");
            std::process::exit(1);
        }
    }
}

//! Bounded process I/O for the cmeet shell.
//!
//! The caller supplies cmsg's generated request/result/event types and limits.
//! This module defines no actions, domain errors, authority or runtime readiness.

use serde::{Serialize, de::DeserializeOwned};
use std::io::{self, Read, Write};

pub mod runtime;

/// Presentation only; both forms preserve the serialized owner value.
#[derive(Clone, Copy)]
pub enum Format {
    /// One JSON value per line, suitable for results and event streams.
    Json,
    /// Indented JSON for interactive inspection.
    Pretty,
}

/// Process I/O failures, separate from cmsg's domain error and exit taxonomy.
/// Deliberately carries no input bytes or serializer diagnostics.
#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Read(io::ErrorKind),
    Write(io::ErrorKind),
    InputTooLarge,
    InvalidJson,
    InvalidOutput,
}

/// Read bytes without reserializing an API document. In particular, nested
/// duplicate fields must reach the owner's decoder unchanged, for rejection.
/// Read at most one byte beyond the limit before refusing the input. There is no
/// dispatch or domain side effect here.
pub fn read_bytes(reader: impl Read, max_bytes: u32) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    reader
        .take(u64::from(max_bytes) + 1)
        .read_to_end(&mut bytes)
        .map_err(input_error)?;
    if bytes.len() as u64 > u64::from(max_bytes) {
        return Err(Error::InputTooLarge);
    }
    Ok(bytes)
}

/// Decode a complete typed document. Use `read_bytes` for forwarding API input
/// to the owning dispatcher; decoding an arbitrary Value would lose duplicate
/// object fields before the owner can reject them.
pub fn read_json<T: DeserializeOwned>(reader: impl Read, max_bytes: u32) -> Result<T, Error> {
    let bytes = read_bytes(reader, max_bytes)?;
    match serde_json::from_slice(&bytes) {
        Ok(value) => Ok(value),
        Err(_) => Err(Error::InvalidJson),
    }
}

/// Serialize completely before writing, so a serialization failure cannot emit
/// a partial result. A write or flush failure must stop the event producer; it
/// must not cause an action to be dispatched again.
pub fn write_json(
    writer: &mut impl Write,
    value: &impl Serialize,
    format: Format,
) -> Result<(), Error> {
    let encoded = match format {
        Format::Json => serde_json::to_vec(value),
        Format::Pretty => serde_json::to_vec_pretty(value),
    };
    let mut encoded = encoded.map_err(serialization_error)?;
    encoded.push(b'\n');
    writer.write_all(&encoded).map_err(output_error)?;
    writer.flush().map_err(output_error)
}

fn input_error(error: io::Error) -> Error {
    Error::Read(error.kind())
}

fn output_error(error: io::Error) -> Error {
    Error::Write(error.kind())
}

fn serialization_error(_: serde_json::Error) -> Error {
    Error::InvalidOutput
}

use cmeet::{Error, Format, read_json, write_json};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{self, Cursor, Read, Write};

// This type exercises generic serialization only; it is not a cmsg schema.
#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Document {
    text: String,
}

#[test]
fn both_formats_preserve_typed_values_and_escape_terminal_controls() {
    let original = Document {
        text: "snow 雪\n\u{1b}[2J".into(),
    };
    for format in [Format::Json, Format::Pretty] {
        let mut output = Vec::new();
        write_json(&mut output, &original, format).unwrap();
        assert!(!output.contains(&0x1b));
        assert_eq!(output.last(), Some(&b'\n'));
        let restored: Document = read_json(&output[..], output.len() as u32).unwrap();
        assert_eq!(restored, original);
    }
}

#[test]
fn compact_events_are_separate_complete_lines() {
    let mut output = Vec::new();
    for value in [json!(null), json!({"text": "a\nb"})] {
        write_json(&mut output, &value, Format::Json).unwrap();
    }
    assert_eq!(output, b"null\n{\"text\":\"a\\nb\"}\n");
}

#[test]
fn bounded_read_accepts_exact_limit_and_stops_after_one_excess_byte() {
    assert_eq!(read_json::<Value>(b"true".as_slice(), 4), Ok(json!(true)));
    assert_eq!(read_json::<Value>(b"0".as_slice(), u32::MAX), Ok(json!(0)));
    let mut input = Cursor::new(b"null followed by much more data".as_slice());
    assert_eq!(read_json::<Value>(&mut input, 3), Err(Error::InputTooLarge));
    assert_eq!(input.position(), 4);
    assert_eq!(read_json::<Value>(b"0".as_slice(), 0), Err(Error::InputTooLarge));
}

#[test]
fn malformed_trailing_duplicate_and_unknown_input_is_refused_by_owner_type() {
    for input in [
        b"".as_slice(),
        b"{",
        b"\xff",
        b"{\"text\":\"a\"} null",
        b"{\"text\":\"a\",\"text\":\"b\"}",
        b"{\"text\":\"a\",\"unknown\":true}",
    ] {
        assert_eq!(read_json::<Document>(input, 100), Err(Error::InvalidJson));
    }
}

#[test]
fn serializer_failure_writes_nothing_in_either_format() {
    // serde_json refuses structured object keys. No custom domain mock needed.
    let invalid = std::collections::BTreeMap::from([(vec![1, 2], "value")]);
    for format in [Format::Json, Format::Pretty] {
        let mut output = Vec::new();
        assert_eq!(write_json(&mut output, &invalid, format), Err(Error::InvalidOutput));
        assert!(output.is_empty());
    }
}

struct BrokenInput;
impl Read for BrokenInput {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::new(io::ErrorKind::PermissionDenied, "private detail"))
    }
}

#[test]
fn input_errors_do_not_include_input_or_dependency_diagnostics() {
    let error = read_json::<Value>(BrokenInput, 10).unwrap_err();
    assert_eq!(error, Error::Read(io::ErrorKind::PermissionDenied));
    assert_eq!(format!("{error:?}"), "Read(PermissionDenied)");
}

struct BrokenOutput {
    fail_write: bool,
}
impl Write for BrokenOutput {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.fail_write {
            Err(io::Error::from(io::ErrorKind::BrokenPipe))
        } else {
            Ok(bytes.len())
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::BrokenPipe))
    }
}

#[test]
fn broken_pipe_and_flush_failure_stop_output() {
    for fail_write in [true, false] {
        let error = write_json(&mut BrokenOutput { fail_write }, &json!(null), Format::Json);
        assert_eq!(error, Err(Error::Write(io::ErrorKind::BrokenPipe)));
    }
}

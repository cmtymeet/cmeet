use cmsg::door::surface;
use serde_json::Value;
use std::process::Command;

fn cmeet() -> Command {
    Command::new(env!("CARGO_BIN_EXE_cmeet"))
}

#[test]
fn exports_the_owner_registry_without_a_second_action_or_schema_list() {
    for (projection, expected) in [
        ("cli", surface::cli_commands()),
        ("mcp", surface::mcp_tools()),
        ("openapi", surface::openapi()),
        ("bundle", surface::bundle()),
    ] {
        for pretty in [false, true] {
            let mut command = cmeet();
            command.args(["api", projection]);
            if pretty {
                command.arg("--pretty");
            }
            let output = command.output().unwrap();
            assert!(output.status.success());
            assert!(output.stderr.is_empty());
            assert_eq!(
                serde_json::from_slice::<Value>(&output.stdout).unwrap(),
                expected
            );
        }
    }
    let default = cmeet().arg("api").output().unwrap();
    assert!(default.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&default.stdout).unwrap(),
        surface::cli_commands()
    );
}

#[test]
fn help_and_version_are_shell_operations_not_runtime_readiness() {
    for args in [vec!["--help"], vec!["--version"], vec!["api", "--help"]] {
        let output = cmeet().args(args).output().unwrap();
        assert!(output.status.success());
        assert!(!output.stdout.is_empty());
        assert!(output.stderr.is_empty());
    }
    let output = cmeet().arg("--help").output().unwrap();
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("already paired cmsg runtime")
    );
}

#[test]
fn unavailable_projections_and_software_authenticator_flags_are_not_accepted() {
    for args in [
        vec![],
        vec!["tui"],
        vec!["mcp"],
        vec!["join"],
        vec!["--software-authenticator"],
        vec!["api", "unknown"],
    ] {
        let output = cmeet().args(args).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
    }
}

#[cfg(target_os = "linux")]
#[test]
fn output_failure_does_not_report_success() {
    let full = std::fs::OpenOptions::new()
        .write(true)
        .open("/dev/full")
        .unwrap();
    let output = cmeet()
        .arg("api")
        .stdout(std::process::Stdio::from(full))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(output.stderr, b"cmeet: output unavailable\n");
}

#[test]
fn connected_modes_refuse_invalid_capability_channels_before_protocol_output() {
    for mode in ["invoke", "mcp", "tui"] {
        let output = cmeet().args([mode, "--endpoint", "http://127.0.0.1:1", "--origin", "https://client.example", "--capability-fd", "0"]).output().unwrap();
        assert_eq!(output.status.code(), Some(i32::from(cmsg::door::ErrorCode::Unauthorized.exit_code())));
        if mode == "invoke" {
            assert_eq!(serde_json::from_slice::<Value>(&output.stdout).unwrap()["error"], "unauthorized");
        } else {
            assert!(output.stdout.is_empty());
            assert!(!output.stderr.is_empty());
        }
    }
}

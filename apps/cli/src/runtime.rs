//! Process adapters for the owner's native client. No pairing or domain logic.
use cmsg::door::{ClientToken, ErrorCode, Output, native::Client};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use zeroize::Zeroizing;

pub const IO_DEADLINE: Duration = Duration::from_secs(10);

/// Read the original bytes, including duplicate fields, with a hard byte/time cap.
pub async fn input(reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>, ErrorCode> {
    let mut bytes = Vec::new();
    tokio::time::timeout(
        IO_DEADLINE,
        reader.take(limit as u64 + 1).read_to_end(&mut bytes),
    )
    .await
    .map_err(|_| ErrorCode::Unavailable)?
    .map_err(|_| ErrorCode::Unavailable)?;
    if bytes.len() > limit {
        return Err(ErrorCode::Capacity);
    }
    Ok(bytes)
}

/// Forward once. A transport failure never triggers a retry of an unknown effect.
pub async fn invoke(client: &Client, bytes: &[u8]) -> Output {
    match client.invoke_bytes(bytes).await {
        Ok(output) => output,
        Err(error) => Output::Error { error },
    }
}

pub fn exit_code(output: &Output) -> u8 {
    match output {
        Output::Ok { .. } => 0,
        Output::Error { error } => error.exit_code(),
    }
}

/// Flush the complete owner envelope, including events. Stop on output failure.
pub async fn output(writer: &mut (impl AsyncWrite + Unpin), value: &Output) -> std::io::Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    tokio::time::timeout(IO_DEADLINE, async {
        writer.write_all(&bytes).await?;
        writer.flush().await
    })
    .await
    .map_err(|_| std::io::Error::from(std::io::ErrorKind::TimedOut))?
}

/// Import an existing capability from an inherited private pipe. The descriptor
/// number is public; its contents are never accepted in argv, environment or files.
/// Opening /dev/fd duplicates the pipe without taking ownership of an arbitrary
/// runtime descriptor. Nonblocking mode prevents waiting inside open/read.
#[cfg(unix)]
pub async fn capability(fd: u32) -> Result<ClientToken, ErrorCode> {
    use std::{
        fs::OpenOptions,
        io::Read,
        os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt},
    };
    if fd < 3 {
        return Err(ErrorCode::Unauthorized);
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(rustix::fs::OFlags::NONBLOCK.bits() as i32)
        .open(format!("/dev/fd/{fd}"))
        .map_err(|_| ErrorCode::Unauthorized)?;
    let metadata = file.metadata().map_err(|_| ErrorCode::Unauthorized)?;
    if !metadata.file_type().is_fifo()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o077 != 0
    {
        return Err(ErrorCode::Unauthorized);
    }
    let pipe = tokio::io::unix::AsyncFd::new(file).map_err(|_| ErrorCode::Unavailable)?;
    let read = async {
        let mut bytes = Zeroizing::new(Vec::new());
        loop {
            let mut buffer = [0; 44];
            let mut guard = pipe.readable().await.map_err(|_| ErrorCode::Unavailable)?;
            match guard.try_io(|inner| inner.get_ref().read(&mut buffer)) {
                Ok(Ok(0)) => return ClientToken::from_protected_transport(bytes),
                Ok(Ok(count)) => {
                    bytes.extend_from_slice(&buffer[..count]);
                    zeroize::Zeroize::zeroize(&mut buffer);
                    if bytes.len() > 43 {
                        return Err(ErrorCode::Unauthorized);
                    }
                }
                Ok(Err(_)) => return Err(ErrorCode::Unavailable),
                Err(_) => continue,
            }
        }
    };
    tokio::time::timeout(IO_DEADLINE, read)
        .await
        .map_err(|_| ErrorCode::Unavailable)?
}

#[cfg(not(unix))]
pub async fn capability(_: u32) -> Result<ClientToken, ErrorCode> {
    Err(ErrorCode::Unavailable)
}

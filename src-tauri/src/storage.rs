use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub fn profile() -> PathBuf {
    if let Some(path) = std::env::var_os("PIXPRITE_USER_DATA") {
        return path.into();
    }
    let base = if cfg!(target_os = "linux") {
        dirs::config_dir()
    } else {
        dirs::data_dir()
    };
    base.unwrap_or_else(std::env::temp_dir).join("Pixprite")
}
/// User-owned library data stays outside the WebView cache/configuration directory.
pub fn data_directory() -> Result<PathBuf, String> {
    if let Some(profile) = std::env::var_os("PIXPRITE_USER_DATA") {
        return Ok(PathBuf::from(profile).join("data"));
    }
    dirs::data_local_dir()
        .map(|base| base.join("Pixprite"))
        .ok_or_else(|| "The operating system did not provide an application data directory".into())
}
pub fn private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
pub fn atomic_bytes(path: &Path, data: &[u8]) -> io::Result<()> {
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| io::Error::other("Missing parent"))?,
    )?;
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();
    let _ = fs::remove_file(temp);
    result
}
pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    atomic_bytes(path, &serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
pub fn json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}
pub fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "pixprite"
            | "aseprite"
            | "ase"
            | "png"
            | "gif"
            | "webp"
            | "jpg"
            | "jpeg"
            | "gpl"
            | "pal"
            | "hex"
            | "act"
    )
}
pub fn read_document(path: &Path) -> Result<serde_json::Value, String> {
    use base64::Engine;
    if !path.is_absolute() || !supported(path) {
        return Err("Expected an absolute path to a supported document or palette".into());
    }
    let info = fs::metadata(path).map_err(|e| e.to_string())?;
    if !info.is_file() || info.len() > 64 * 1024 * 1024 {
        return Err("File is not a regular file or exceeds 64 MiB".into());
    }
    Ok(
        serde_json::json!({"name":path.file_name().unwrap().to_string_lossy(),"data":base64::engine::general_purpose::STANDARD.encode(fs::read(path).map_err(|e|e.to_string())?)}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn documents_are_bounded_and_atomic_writes_preserve_parent_permissions() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("sprite.pixprite");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root.path(), fs::Permissions::from_mode(0o755)).unwrap();
        }
        atomic_bytes(&path, b"first").unwrap();
        atomic_bytes(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert!(read_document(&path).is_ok());
        assert!(read_document(root.path()).is_err());
        assert!(read_document(Path::new("relative.pixprite")).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.path()).unwrap().permissions().mode() & 0o777,
                0o755
            );
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}

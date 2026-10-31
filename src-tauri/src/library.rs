//! The native library stores self-contained, portable .pixprite documents.
use crate::{storage, updates};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};

type CachedMetadata = (Option<SystemTime>, u64, Value);
pub struct Library {
    pub root: PathBuf,
    metadata: Mutex<HashMap<PathBuf, CachedMetadata>>,
}
const TAG: &str = "_pixpriteLibrary";
impl Library {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        storage::private_dir(&root).map_err(|e| e.to_string())?;
        Ok(Self {
            root,
            metadata: Mutex::new(HashMap::new()),
        })
    }
    fn directory(&self, group: &str) -> Result<PathBuf, String> {
        let name = match group {
            "projects" => "Projects",
            "sessions" => "Recovery",
            "snapshots" => "Snapshots",
            "goodProjects" => "Previous/Projects",
            "goodSessions" => "Previous/Recovery",
            "states" => "Settings/Editors",
            "sessionState" => "Settings/WorkingState",
            "folders" => "Settings/Folders",
            _ => return Err("Unknown library group".into()),
        };
        let dir = self.root.join(name);
        // Never follow a user-created symlink out of the library during writes or deletion.
        let mut checked = self.root.clone();
        for part in Path::new(name).components() {
            checked.push(part);
            if fs::symlink_metadata(&checked).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err("Library directories cannot be symbolic links".into());
            }
        }
        storage::private_dir(&dir).map_err(|e| e.to_string())?;
        Ok(dir)
    }
    fn hash(id: &str) -> Result<String, String> {
        if id.is_empty() || id.len() > 1024 {
            return Err("Invalid library id".into());
        }
        Ok(updates::hash(id.as_bytes()))
    }
    fn deleted(&self, group: &str, id: &str) -> Result<bool, String> {
        let owner = match group {
            "goodProjects" => "projects",
            "goodSessions" => "sessions",
            value => value,
        };
        Ok(self
            .root
            .join("Deleted")
            .join(owner)
            .join(Self::hash(id)?)
            .exists())
    }
    fn document(group: &str) -> bool {
        !matches!(group, "states" | "folders" | "sessionState")
    }
    fn suffix(group: &str, id: &str) -> Result<String, String> {
        Ok(format!(
            "--{}.{}",
            Self::hash(id)?,
            if Self::document(group) {
                "pixprite"
            } else {
                "json"
            }
        ))
    }
    fn find(&self, group: &str, id: &str) -> Result<Option<PathBuf>, String> {
        let suffix = Self::suffix(group, id)?;
        let mut found = None;
        for entry in fs::read_dir(self.directory(group)?).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_name().to_string_lossy().ends_with(&suffix) {
                if !entry.file_type().map_err(|e| e.to_string())?.is_file() || found.is_some() {
                    return Err("Ambiguous or unsafe library file".into());
                }
                found = Some(entry.path());
            }
        }
        Ok(found)
    }
    fn read(path: &Path, document: bool) -> Result<Value, String> {
        let mut value: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        if !document {
            return Ok(value);
        }
        let mut record = value
            .as_object_mut()
            .and_then(|o| o.remove(TAG))
            .ok_or("Missing library metadata")?;
        if !record.is_object() {
            return Err("Invalid library metadata".into());
        }
        let checksum = updates::hash(&serde_json::to_vec(&value).map_err(|e| e.to_string())?);
        if record["checksum"] != checksum {
            record["validated"] = json!(false);
        }
        record
            .as_object_mut()
            .ok_or("Invalid library metadata")?
            .insert("data".into(), value);
        Ok(record)
    }
    fn metadata(&self, path: &Path, document: bool) -> Result<Value, String> {
        let stat = fs::metadata(path).map_err(|e| e.to_string())?;
        let signature = (stat.modified().ok(), stat.len());
        if let Some((time, size, value)) = self.metadata.lock().unwrap().get(path) {
            if (*time, *size) == signature {
                return Ok(value.clone());
            }
        }
        let mut value = Self::read(path, document)?;
        value
            .as_object_mut()
            .ok_or("Invalid library record")?
            .remove("data");
        if !value["id"].is_string() {
            return Err("Missing library id".into());
        }
        self.metadata
            .lock()
            .unwrap()
            .insert(path.into(), (signature.0, signature.1, value.clone()));
        Ok(value)
    }
    fn get(&self, group: &str, id: &str) -> Result<Value, String> {
        let Some(path) = self.find(group, id)? else {
            return Ok(Value::Null);
        };
        let mut value = Self::read(&path, Self::document(group))?;
        if group == "sessions" {
            let patch = self.get("sessionState", id)?;
            if !patch.is_null() && patch["revision"] == value["revision"] {
                for key in ["head", "editor"] {
                    if let Some(v) = patch.get(key) {
                        value[key] = v.clone();
                    }
                }
            }
        }
        Ok(value)
    }
    fn list(&self, group: &str) -> Result<Vec<Value>, String> {
        let mut records = Vec::new();
        for entry in fs::read_dir(self.directory(group)?).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                continue;
            }
            let path = entry.path();
            let ext = if Self::document(group) {
                "pixprite"
            } else {
                "json"
            };
            if path.extension().and_then(|s| s.to_str()) != Some(ext) {
                continue;
            }
            // Leave damaged or foreign files in place; they cannot hide the rest of the library.
            match self.metadata(&path, Self::document(group)) {
                Ok(mut record) => {
                    if let Some(o) = record.as_object_mut() {
                        o.remove("data");
                    }
                    records.push(record);
                }
                Err(error) => {
                    eprintln!("Library scan: {error}");
                    // Keep recovery reachable on Home even if the current JSON is unreadable.
                    // A physically deleted file has no directory entry and is never resurrected.
                    if group == "projects" {
                        let filename = entry.file_name().to_string_lossy().into_owned();
                        if let Some((_, suffix)) = filename.rsplit_once("--") {
                            if let Some(record) = self.list("goodProjects")?.into_iter().find(|r| {
                                r["id"]
                                    .as_str()
                                    .and_then(|id| Self::suffix(group, id).ok())
                                    .is_some_and(|s| s == format!("--{suffix}"))
                            }) {
                                records.push(record);
                            }
                        }
                    }
                }
            }
        }
        Ok(records)
    }
    fn put(&self, group: &str, id: &str, mut record: Value) -> Result<(), String> {
        if self.deleted(group, id)? {
            return Err("Document was deleted while saving".into());
        }
        if group == "snapshots" {
            if let Some(owner) = record["meta"]["owner"].as_str() {
                if self.deleted("projects", owner)? || self.deleted("sessions", owner)? {
                    return Err("Snapshot owner was deleted".into());
                }
            }
        }
        if !record.is_object() {
            return Err("Invalid library record".into());
        }
        record["id"] = json!(id);
        if Self::document(group) {
            record["revision"] = json!(uuid::Uuid::new_v4().to_string());
        }
        let name = record["meta"]["name"]
            .as_str()
            .or(record["head"]["name"].as_str())
            .unwrap_or("document");
        let mut safe: String = name
            .chars()
            .take(32)
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        if safe.is_empty() {
            safe.push_str("document");
        }
        let path = self.find(group, id)?.unwrap_or(
            self.directory(group)?
                .join(format!("{safe}{}", Self::suffix(group, id)?)),
        );
        let value = if Self::document(group) {
            let mut data = record
                .as_object_mut()
                .and_then(|o| o.remove("data"))
                .ok_or("Missing document")?;
            record["checksum"] = json!(updates::hash(
                &serde_json::to_vec(&data).map_err(|e| e.to_string())?
            ));
            data.as_object_mut()
                .ok_or("Document must be an object")?
                .insert(TAG.into(), record);
            data
        } else {
            record
        };
        storage::atomic_json(&path, &value)?;
        self.metadata.lock().unwrap().remove(&path);
        Ok(())
    }
    fn remove(&self, group: &str, id: &str, tombstone: bool) -> Result<(), String> {
        if tombstone {
            storage::atomic_bytes(
                &self.root.join("Deleted").join(group).join(Self::hash(id)?),
                b"",
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(path) = self.find(group, id)? {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            self.metadata.lock().unwrap().remove(&path);
        }
        Ok(())
    }
    pub fn execute(&self, request: Value) -> Result<Value, String> {
        let action = request["action"].as_str().ok_or("Missing action")?;
        if action == "info" {
            return Ok(
                json!({"path":self.root, "migrated":self.root.join("migration-v1.json").is_file()}),
            );
        }
        if action == "open" {
            open::that(&self.root).map_err(|e| e.to_string())?;
            return Ok(Value::Null);
        }
        if action == "migrated" {
            storage::atomic_json(&self.root.join("migration-v1.json"), &json!({"version":1}))?;
            return Ok(Value::Null);
        }
        let group = request["group"].as_str().ok_or("Missing group")?;
        self.directory(group)?;
        if action == "list" {
            return Ok(json!(self.list(group)?));
        }
        let id = request["id"].as_str().ok_or("Missing id")?;
        match action {
            "get" => self.get(group, id),
            "delete" => {
                self.remove(group, id, request["tombstone"] == true)?;
                if group == "sessions" {
                    self.remove("sessionState", id, false)?;
                }
                Ok(Value::Null)
            }
            "put" | "import" => {
                if action == "import" && self.find(group, id)?.is_some() {
                    let record = self.get(group, id)?;
                    if record["id"] != id {
                        return Err("Existing library file has a different id".into());
                    }
                    return Ok(Value::Null);
                }
                let mut record = request["record"].clone();
                if !record.is_object() {
                    return Err("Invalid library record".into());
                }
                if request["patch"] == true && group == "sessions" {
                    if self.deleted(group, id)? {
                        return Err("Document was deleted while saving".into());
                    }
                    let path = self.find(group, id)?.ok_or("Missing working copy")?;
                    let meta = self.metadata(&path, true)?;
                    record["revision"] = meta["revision"].clone();
                    self.put("sessionState", id, record)?;
                    return Ok(Value::Null);
                }
                if request["patch"] == true {
                    let mut old = self.get(group, id)?;
                    if old.is_null() {
                        return Err("Missing working copy".into());
                    }
                    for (k, v) in record.as_object().ok_or("Invalid patch")? {
                        old[k] = v.clone();
                    }
                    record = old;
                }
                if request["backup"] == true {
                    let previous_group = match group {
                        "projects" => "goodProjects",
                        "sessions" => "goodSessions",
                        _ => return Err("Invalid backup group".into()),
                    };
                    match self.get(group, id) {
                        Ok(old) if old["validated"] == true => self.put(previous_group, id, old)?,
                        Ok(old) if old.is_null() => self.put(previous_group, id, record.clone())?,
                        Ok(_) => {}
                        Err(_) => {} // A damaged current file never replaces the recovery copy.
                    }
                }
                self.put(group, id, record)?;
                Ok(Value::Null)
            }
            _ => Err("Unknown library action".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_files_atomic_recovery_deletion_and_retry() {
        let temp = tempfile::tempdir().unwrap();
        let lib = Library::new(temp.path().into()).unwrap();
        let put = |version| json!({"action":"put","group":"projects","id":"../escape", "backup":true,"record":{"validated":true,"meta":{"name":"My sprite"},"data":{"version":version,"name":"My sprite"}}});
        lib.execute(put(1)).unwrap();
        lib.execute(put(2)).unwrap();
        let path = lib.find("projects", "../escape").unwrap().unwrap();
        let portable: Value = storage::json(&path).unwrap();
        assert_eq!(portable["version"], 2);
        assert!(portable.get("data").is_none());
        assert_eq!(
            lib.get("goodProjects", "../escape").unwrap()["data"]["version"],
            1
        );
        fs::write(&path, b"broken").unwrap();
        assert_eq!(
            lib.list("projects").unwrap()[0]["meta"]["name"],
            "My sprite"
        );
        lib.execute(put(3)).unwrap();
        assert_eq!(
            lib.get("goodProjects", "../escape").unwrap()["data"]["version"],
            1
        );
        let mut corrupted: Value = storage::json(&path).unwrap();
        corrupted["version"] = json!("damaged");
        storage::atomic_json(&path, &corrupted).unwrap();
        lib.execute(put(3)).unwrap();
        assert_eq!(
            lib.get("goodProjects", "../escape").unwrap()["data"]["version"],
            1
        );
        lib.execute(json!({"action":"import","group":"projects","id":"../escape","record":{"data":{"version":9}}})).unwrap();
        assert_eq!(
            lib.get("projects", "../escape").unwrap()["data"]["version"],
            3
        );
        lib.execute(
            json!({"action":"delete","group":"projects","id":"../escape","tombstone":true}),
        )
        .unwrap();
        assert!(lib.execute(put(4)).is_err());
        assert!(lib
            .execute(json!({"action":"list","group":"../escape"}))
            .is_err());
    }
    #[test]
    fn editor_updates_do_not_rewrite_pixels_and_are_bound_to_the_document_revision() {
        let root = tempfile::tempdir().unwrap();
        let lib = Library::new(root.path().into()).unwrap();
        let put = |version| json!({"action":"put","group":"sessions","id":"same-id", "backup":true,"record":{"validated":true,"head":{"name":"Working"},"editor":{"zoom":1},"data":{"version":version}}});
        lib.execute(put(1)).unwrap();
        let path = lib.find("sessions", "same-id").unwrap().unwrap();
        let before = fs::read(&path).unwrap();
        lib.execute(json!({"action":"put","group":"sessions","id":"same-id","patch":true,"record":{"editor":{"zoom":7}}})).unwrap();
        assert_eq!(fs::read(&path).unwrap(), before);
        // Reopening the repository retains the small editor-state update.
        let reopened = Library::new(root.path().into()).unwrap();
        assert_eq!(
            reopened.get("sessions", "same-id").unwrap()["editor"]["zoom"],
            7
        );
        reopened.execute(put(2)).unwrap();
        assert_eq!(
            reopened.get("sessions", "same-id").unwrap()["editor"]["zoom"],
            1
        );
        assert_eq!(
            reopened.get("goodSessions", "same-id").unwrap()["editor"]["zoom"],
            7
        );
        reopened
            .execute(json!({"action":"delete","group":"sessions","id":"same-id","tombstone":true}))
            .unwrap();
        assert!(reopened.execute(put(3)).is_err());
        // Session tombstones must not prohibit a project with the same legacy id.
        reopened.execute(json!({"action":"put","group":"projects","id":"same-id","record":{"meta":{"name":"Saved"},"data":{"version":1}}})).unwrap();
        assert!(reopened.execute(json!({"action":"put","group":"snapshots","id":"snapshot","record":{"meta":{"owner":"same-id"},"data":{"version":1}}})).is_err());
    }
    #[test]
    fn metadata_cache_notices_external_changes_and_a_damaged_file_is_isolated() {
        let root = tempfile::tempdir().unwrap();
        let lib = Library::new(root.path().into()).unwrap();
        lib.execute(json!({"action":"put","group":"projects","id":"one","record":{"meta":{"name":"First"},"data":{"version":1}}})).unwrap();
        assert_eq!(lib.list("projects").unwrap()[0]["meta"]["name"], "First");
        let path = lib.find("projects", "one").unwrap().unwrap();
        let mut raw: Value = storage::json(&path).unwrap();
        raw[TAG]["meta"]["name"] = json!("Externally changed");
        storage::atomic_json(&path, &raw).unwrap();
        assert_eq!(
            lib.list("projects").unwrap()[0]["meta"]["name"],
            "Externally changed"
        );
        fs::write(
            lib.directory("projects").unwrap().join("broken.pixprite"),
            b"broken",
        )
        .unwrap();
        assert_eq!(lib.list("projects").unwrap().len(), 1);
        assert!(lib
            .execute(json!({"action":"put","group":"projects","id":"broken","record":"invalid"}))
            .is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_directories() {
        let root = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let lib = Library::new(root.path().into()).unwrap();
        std::os::unix::fs::symlink(target.path(), root.path().join("Projects")).unwrap();
        assert!(lib
            .execute(json!({"action":"list","group":"projects"}))
            .is_err());
    }
}

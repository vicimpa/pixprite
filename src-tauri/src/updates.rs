//! Background release discovery. No downloads, content replacement or automatic restarts.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use url::Url;

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES: &str = "https://github.com/vicimpa/pixprite/releases/tag/";
const LATEST: &str = "https://api.github.com/repos/vicimpa/pixprite/releases/latest";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}
impl Default for UpdateState {
    fn default() -> Self {
        Self {
            current_version: CURRENT_VERSION.into(),
            version: None,
            url: None,
        }
    }
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}
fn version(value: &str) -> Option<[u64; 3]> {
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.len() != 3 {
        return None;
    }
    let mut numbers = [0; 3];
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty()
            || part.len() > 1 && part.starts_with('0')
            || !part.bytes().all(|c| c.is_ascii_digit())
        {
            return None;
        }
        numbers[i] = part
            .parse::<u64>()
            .ok()
            .filter(|v| *v <= 9_007_199_254_740_991)?;
    }
    Some(numbers)
}
pub fn parse(bytes: &[u8]) -> Result<UpdateState, String> {
    let release: Release = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let mut state = UpdateState::default();
    if release.draft || release.prerelease {
        return Ok(state);
    }
    let latest = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    let value = version(latest).ok_or("Invalid release version")?;
    if value > version(CURRENT_VERSION).expect("Stable application version") {
        state.version = Some(latest.into());
        // Derive the trusted destination ourselves; never open arbitrary URLs from a response.
        state.url = Some(format!("{RELEASES}{}", release.tag_name));
    }
    Ok(state)
}
fn allowed(url: &Url) -> bool {
    (url.scheme() == "https" || url.scheme() == "http" && url.host_str() == Some("127.0.0.1"))
        && url.username().is_empty()
        && url.password().is_none()
}
pub async fn check() -> Result<UpdateState, String> {
    let url = Url::parse(&std::env::var("PIXPRITE_UPDATE_URL").unwrap_or_else(|_| LATEST.into()))
        .map_err(|e| e.to_string())?;
    if !allowed(&url) {
        return Err("Release checks require HTTPS or loopback HTTP".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(format!("Pixprite/{CURRENT_VERSION}"))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !allowed(attempt.url()) {
                attempt.error("Unsafe release redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    // A repository without published releases simply has nothing to announce yet.
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateState::default());
    }
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size > 256 * 1024)
    {
        return Err("Release response exceeds limit".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > 256 * 1024 {
            return Err("Release response exceeds limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse(&bytes)
}
pub fn hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(bytes))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions_are_stable_and_ordered() {
        for invalid in [
            "1.2",
            "01.2.3",
            "1.0.0-beta",
            "1.2.3/escape",
            "1.2.9007199254740992",
        ] {
            assert!(version(invalid).is_none());
        }
        assert!(version("1.10.0") > version("1.9.9"));
    }
    #[test]
    fn new_releases_have_only_a_trusted_link() {
        let state =
            parse(br#"{"tag_name":"v999.0.0","html_url":"https://evil.example/installer"}"#)
                .unwrap();
        assert_eq!(state.version.as_deref(), Some("999.0.0"));
        assert_eq!(
            state.url.as_deref(),
            Some("https://github.com/vicimpa/pixprite/releases/tag/v999.0.0")
        );
        let unprefixed = parse(br#"{"tag_name":"999.0.0"}"#).unwrap();
        assert_eq!(
            unprefixed.url.as_deref(),
            Some("https://github.com/vicimpa/pixprite/releases/tag/999.0.0")
        );
    }
    #[test]
    fn no_notification_for_old_draft_or_preview_releases() {
        for release in [
            r#"{"tag_name":"v0.0.1"}"#,
            r#"{"tag_name":"v999.0.0","draft":true}"#,
            r#"{"tag_name":"v999.0.0-beta","prerelease":true}"#,
        ] {
            assert_eq!(parse(release.as_bytes()).unwrap(), UpdateState::default());
        }
        assert_eq!(
            parse(format!(r#"{{"tag_name":"v{CURRENT_VERSION}"}}"#).as_bytes()).unwrap(),
            UpdateState::default()
        );
    }
    #[test]
    fn invalid_release_data_and_insecure_urls_are_rejected() {
        assert!(parse(br#"{"tag_name":"../../escape"}"#).is_err());
        assert!(parse(b"{}").is_err());
        for uri in [
            "http://example.com/latest",
            "file:///tmp/release",
            "https://user:password@example.com/latest",
        ] {
            assert!(!allowed(&Url::parse(uri).unwrap()));
        }
        assert!(allowed(
            &Url::parse("http://127.0.0.1:1234/latest").unwrap()
        ));
    }
}

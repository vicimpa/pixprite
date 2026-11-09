use super::rgb_hex;
use futures_util::StreamExt;
use std::collections::HashMap;
use tokio_util::sync::CancellationToken;
use zbus::{
    zvariant::{OwnedObjectPath, OwnedValue, Value},
    Connection, Proxy,
};

pub async fn pick(cancel: CancellationToken) -> Result<Option<String>, String> {
    // The desktop portal owns the interactive picker on both Wayland and X11.
    let connection = Connection::session().await.map_err(|e| e.to_string())?;
    if cancel.is_cancelled() {
        return Ok(None);
    }
    let token = format!("pixprite{}", uuid::Uuid::new_v4().simple());
    let sender = connection
        .unique_name()
        .ok_or("Missing desktop bus name")?
        .as_str()
        .trim_start_matches(':')
        .replace('.', "_");
    let path = format!("/org/freedesktop/portal/desktop/request/{sender}/{token}");
    let request = Proxy::new(
        &connection,
        "org.freedesktop.portal.Desktop",
        path.as_str(),
        "org.freedesktop.portal.Request",
    )
    .await
    .map_err(|e| e.to_string())?;
    // Subscribe before starting: a quick selection/cancel must not be lost.
    let mut responses = request
        .receive_signal("Response")
        .await
        .map_err(|e| e.to_string())?;
    let portal = Proxy::new(
        &connection,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Screenshot",
    )
    .await
    .map_err(|e| e.to_string())?;
    let options = HashMap::from([("handle_token", Value::from(token.as_str()))]);
    let handle: OwnedObjectPath = portal
        .call("PickColor", &("", options))
        .await
        .map_err(|e| e.to_string())?;
    if handle.as_str() != path {
        let actual = Proxy::new(
            &connection,
            "org.freedesktop.portal.Desktop",
            handle,
            "org.freedesktop.portal.Request",
        )
        .await
        .map_err(|e| e.to_string())?;
        let _ = actual.call::<_, _, ()>("Close", &()).await;
        return Err("The screen color portal returned an unexpected request handle".into());
    }
    tokio::select! {
        _ = cancel.cancelled() => {
            let _ = request.call::<_, _, ()>("Close", &()).await;
            Ok(None)
        }
        response = responses.next() => {
            let response = response.ok_or("The screen color portal closed without a response")?;
            let (code, mut values): (u32, HashMap<String, OwnedValue>) = response.body().deserialize().map_err(|e| e.to_string())?;
            match code {
                0 => {
                    let color: (f64, f64, f64) = values.remove("color").ok_or("Missing screen color")?
                        .try_into().map_err(|e: zbus::zvariant::Error| e.to_string())?;
                    rgb_hex([color.0, color.1, color.2]).map(Some)
                }
                1 => Ok(None),
                _ => Err("The desktop portal could not pick a screen color".into()),
            }
        }
    }
}

# Discord presence

Shows the editor's current activity in Discord as Rich Presence: the file, canvas size,
tool, frame/tag, selection, unsaved changes, idle time and a "Open Pixprite" button.
Settings live in the panel (`Extensions → Discord presence settings`) with a live preview
of the card Discord will render.

Discord Rich Presence has no HTTP API: it is only reachable over a local IPC socket
(`\\.\pipe\discord-ipc-0` on Windows). An extension worker runs in a sandbox and cannot open
that socket, so the extension talks to a small local bridge over loopback HTTP:

```
extension worker ──HTTP──▶ bridge/bridge.ts ──IPC──▶ Discord desktop client
                         127.0.0.1:52700
```

## Setup

1. Create a Discord application at <https://discord.com/developers/applications>.
   Its name and icon are what Discord shows on the card; the extension cannot set them.
2. Copy the **Application ID** from *General Information* into the panel.
3. Start the bridge and keep it running while you draw:

   ```sh
   bun extensions/discord-presence/bridge/bridge.ts
   ```

4. Optionally upload images under *Rich Presence → Art Assets*, then enter their keys in
   the panel's advanced section (`pixprite` is used by default if uploaded). The 512×512
   `assets/icon.png` works as the application icon.

The Discord **desktop** app must be running. Discord in a browser has no IPC socket.

## Endpoints

The bridge binds `127.0.0.1:52700` only; the manifest allows exactly that host and port.

| Route | Purpose |
|---|---|
| `POST /presence` | `{ appId, activity }`: sanitizes and forwards `SET_ACTIVITY` |
| `POST /heartbeat` | keeps the presence alive; `{ active }` says whether Discord still has it |
| `POST /clear` | clears the activity |
| `GET /status` | `{ bridge, discord, appId, active, lastSeen, error }` |

The activity is coalesced to one update per 15 s and refreshed every 30 s, inside Discord's
rate limits. A bridge watchdog clears a presence that has not been refreshed for 90 s, so
closing the tab, disabling the extension or quitting the editor does not leave a stale card.
`SIGINT`/`SIGTERM` clear it as well.

## Settings

- **Application ID**: required; Discord rejects the handshake with code 4000 otherwise.
- **Display**: file name (off = "A pixel-art project"), canvas size, tool, frame and tag,
  selection size, unsaved changes, elapsed timer, link button.
- **Idle after**: minutes without edits before the state says "Idle" (0 = never).
- **Activity type**: playing, listening, watching, competing.
- **Images**: large/small asset keys and their tooltips.

The extension id/value store keeps the settings and the last status, so the panel can explain
why nothing is shown: bridge offline, Discord closed, missing or rejected application id.

## Troubleshooting

| Panel says | Fix |
|---|---|
| Bridge is not running | Start `bridge/bridge.ts`; the port must be free (`EADDRINUSE` is reported) |
| Discord is not running | Open the Discord desktop app; the next update reconnects |
| Discord rejected the application | Check the Application ID (15–21 digits) |
| Images are missing | Upload them as Rich Presence assets in the Developer Portal first |

The bridge has no dependencies beyond Bun. To require a token from other local callers, set
`PIXPRITE_DISCORD_TOKEN` and send `X-Pixprite-Token`; the extension itself does not send it.

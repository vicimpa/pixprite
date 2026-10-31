# Duotone icon pack

A data-only extension example with 16 original two-color icons. Accent-filled shapes follow the active color theme. Other editor icons inherit the built-in Outline artwork.

Outline and Pixel are already part of Pixprite; installing this example adds a third choice under **Window → Icon pack** and in Preferences.

- `manifest.json` contributes `duotone` through `contributes.iconPacks`.
- `icons.json` maps semantic names to bounded vector paths with theme-aware colors.
- `locales/` contains the English and Russian name, description and selection label.
- No JavaScript entry point, worker or permissions are needed.

Run `bun run ext:check` to validate the package. For local installation, run `bun run ext:dev` and open Extensions in the development editor. See the [extension guide](../../docs/extensions/README.md) for the catalog and artwork format.

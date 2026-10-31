# Contributing to Pixprite

Bug reports, focused fixes, documentation and original artwork are welcome. For setup and the directory map, see the [development guide](docs/development.md). The [roadmap](docs/roadmap.md) records planned work; discuss larger changes in an issue before investing in them.

## Working on a change

1. Install dependencies with `bun install --frozen-lockfile` and start `bun run dev`.
2. Keep related changes together. Follow the surrounding code style and the shared `.editorconfig`; avoid reformatting unrelated files.
3. Keep interface text in `src/locales/`, update both English and Russian, and use the extension's own locales for extension text.
4. Add regression coverage when behavior or data handling changes. For UI-only changes, verify the relevant viewport, language and font sizes.
5. Update the relevant guide when commands, formats, public APIs or user-visible behavior change.

Source and documentation belong in the tracked directories; generated builds, screenshots used for diagnostics and reports belong in `dist/`. Images intentionally used in documentation belong in `docs/assets/`.

## Validation

For code changes, start with:

```sh
bun run typecheck
bun test
bun run i18n:check
bun run ext:check
bun run build
bun run bundle:check
```

Run the relevant Playwright scenarios when changing UI, browser integration or native behavior. `bun run test:e2e:smoke` covers the short browser flows; native cases are in `e2e/desktop*.e2e.ts`. See [testing](docs/testing.md) for setup and diagnostic artifacts. Documentation-only changes need a link/path review, not a full application test run.

In a pull request, explain the resulting behavior and list the checks actually run. Include before/after screenshots for visible changes and note any checks that could not run locally.

## Original work

Pixprite is independent. Contribute original code, icons, artwork and text, and use public specifications for file-format implementations. Do not copy implementation or assets from other editors. Contributions are distributed under the repository's [MIT license](LICENSE).

# dirtycode

dirtycode is my fork of [T3 Code](https://github.com/pingdotgg/t3code).

dirtycode is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## Installation

> [!WARNING]
> dirtycode currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run from source

```bash
bun install
bun run dev
```

### Desktop app

Install the latest desktop build from [dirtycode releases](https://github.com/dirtydishes/dirtycode/releases).

## Changes From Upstream

This fork tracks upstream `pingdotgg/t3code` and currently carries these dirtycode-specific changes:

- `78e1c2c9`: added appearance settings support for theme presets and code font size.
- `7fcd23d3`: added desktop Electron runtime repair and theme preset validation hardening.
- Rebranded the app presentation in the UI toward `dirtycode` (including sidebar wordmark usage).
- Updated Catppuccin preset mapping so `Latte` is available under light mode and `Frappe` under dark mode.

## Notes

This project is still early. Expect bugs.

Observability guide: [docs/observability.md](./docs/observability.md)

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

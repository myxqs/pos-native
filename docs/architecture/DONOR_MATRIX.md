# NativePOS Donor Matrix

## Boundary

This register records bounded public-source investigation requested for
NativePOS. It does not make a donor a dependency, a second canonical store, or
an authority over the existing TypeScript/PostgreSQL product. No donor source
has been copied into this repository.

Before a future adaptation or port, the implementer must record the exact
commit SHA, re-check the licence at that commit, retain any required notices,
and add focused NativePOS tests. A public metadata page without an exact SHA is
reference evidence only.

## Public-source review — 2026-09-23

| Donor                                                                     | Public metadata inspected                    | Capability considered                         | Decision       | NativePOS boundary                                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| [Open-Self/Open-Self](https://github.com/Open-Self/Open-Self)             | `main`; MIT; exact SHA not verified          | Context policy, provenance, bounded receipts  | PORT candidate | Adapt only a focused contract/algorithm during context-bundle work; do not add its SQLite vault. |
| [olivier-motium/seld](https://github.com/olivier-motium/seld)             | `main`; Apache-2.0; exact SHA not verified   | Source freshness, approvals, operating review | Reference      | Use workflow ideas only; retain NativePOS data model and runtime.                                |
| [IBM/mcp-context-forge](https://github.com/IBM/mcp-context-forge)         | `main`; Apache-2.0; exact SHA not verified   | Typed MCP boundaries and governance           | Reference      | Do not embed a gateway; NativePOS exposes its own scoped API/MCP adapter.                        |
| [PersonalClaw/PersonalClaw](https://github.com/PersonalClaw/PersonalClaw) | `main`; MIT; exact SHA not verified          | Local approval, recovery, health surfaces     | Reference      | Exclude autonomous loops, chat runtime, and its store.                                           |
| [pioneerdotai/pioneer](https://github.com/pioneerdotai/pioneer)           | `main`; MIT; exact SHA not verified          | Protocol/service separation                   | Reference      | Do not adopt the Rust runtime or unsandboxed tool execution.                                     |
| [letta-ai/letta-code](https://github.com/letta-ai/letta-code)             | `main`; Apache-2.0; exact SHA not verified   | Hot/cold context and bounded continuity       | Reference      | Exclude the harness, cloud coupling, and self-modifying memory.                                  |
| [jugol/codex-agent](https://github.com/jugol/codex-agent)                 | `main`; MIT; exact SHA not verified          | Compact handoff/context patterns              | Reference      | NativePOS remains the canonical structured source, not a vault consumer.                         |
| [NemoFree/codex-hud](https://github.com/NemoFree/codex-hud)               | `main`; MIT; exact SHA not verified          | Read-only operational visibility              | Reference      | Consider status-surface ideas only; do not import unrelated telemetry.                           |
| [slopwareinc/codexcore](https://github.com/slopwareinc/codexcore)         | `main`; MIT; exact SHA not verified          | Typed state/protocol ideas                    | Exclude code   | Swift/macOS runtime is not a compatible product dependency.                                      |
| ContextBank                                                               | Owner/repository/commit not verified         | Source/import/review concepts                 | Defer          | No reuse or dependency until an exact repository and compatible licence are verified.            |
| repofinder.io                                                             | Owner/repository/commit/licence not verified | Bounded source discovery                      | Defer          | Do not connect a remote MCP service or submit NativePOS data.                                    |

## Integration rule

“Amalgamation” means selectively adapting proven capability behind one
NativePOS domain/API/audit boundary. It never means combining donor vaults,
databases, runtimes, autonomous agents, or model-provider dependencies. The
next applicable candidate is Open-Self's context-receipt/policy design when
NativePOS reaches bounded context bundles; it is not part of the current page
hierarchy or data-source slice.

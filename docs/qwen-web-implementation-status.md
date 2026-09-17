# Qwen Web browser provider — implementation checkpoint

Last updated: 2026-09-17

## Recovery pointer

This file is the authoritative restart point for `feat/qwen-web-browser-provider`.
After any interruption:

1. Read this file.
2. Fetch the feature branch HEAD.
3. Confirm the last product SHA below is in history.
4. Continue from **NEXT ACTION**. Do not redo completed stages unless a newer test disproves them.

**Feature branch:** `feat/qwen-web-browser-provider`

**Pre-hardening backup:** `backup/qwen-web-before-hardening-2026-09-17`

**Backup SHA:** `2abfdc15bc1403e5987428f96f920df3b8bb0ddb`

**Merged upstream baseline:** `QwenLM/qwen-code@293a5b81127e5c5afef1d4e904dcc081c5b14765`

**Upstream merge commit:** `852c160368d9bd1f1351f851058d049ba83c2888`

## Non-negotiable requirements

- Qwen Code is the only agent core and owns tools, permissions, shell, files, Git, MCP, skills, canonical history, compaction and subagents.
- Qwen Web is only the text LLM transport. No second agent loop and no Qwen Web native tools.
- No hidden Qwen APIs, browser extension, token/cookie/storage extraction or credential interception.
- Authentication remains only in the persistent browser profile under Qwen home.
- V1 is text-only. Embeddings/media fail explicitly.
- One process-wide browser; isolated pages/channels for main and subagents.
- Qwen Code history is canonical. Browser chat is a transport cache and must replay after mismatch/reset/page loss/restart/compaction/session/model/system/tool-manifest changes.
- Visible browser is only for login/re-authentication; normal inference is headless.
- Cancellation is driven by Qwen Code AbortSignal. Queued cancellation never stops another active request; active cancellation stops generation and rejects partial output.
- `<invoke>...</invoke>` is the only host-tool call transport. Browser code never executes tools.
- Browser startup remains lazy: help/configuration/auth selection must not launch Chromium.

## Completed stages

### Stage 0 — upstream sync and clean baseline — COMPLETE

- Upstream merge: `852c160368d9bd1f1351f851058d049ba83c2888`.
- Baseline run `35188200694`: `npm ci`, build and typecheck PASS.

### Stage 1 — credentialless text-only model contract — COMPLETE

Product commit: `4c7159492c2ffb7c5c885ed1ce6a0414dea081e2`.

Implemented built-in `qwen3.8-max`, Qwen Web registry/resolver contract, no API key/base URL, provider-specific `modalities: {}`, and focused model tests. Focused tests, build and typecheck passed twice.

### Stage 2 — hardened browser transport semantics — COMPLETE

Primary product commit: `6edbeb673e2055bda7a8872ca68a9765ad03c093`.
Follow-up regression/test fixes include `23cf49bb...` and `ee3a05bf...`.

Implemented:

- 30-minute Puppeteer protocol timeout and anti-throttling flags.
- Puppeteer signal handlers disabled so Qwen Code owns cancellation/process signals.
- conservative/stabilized login detection;
- multiline response preservation and first-working-selector extraction;
- model-label tolerance, comparison/retry/provider-error handling;
- scoped native-tool detection and Stop-button completion gating;
- browser-backed DOM/controller regression tests.

### Stage 3 — ownership-safe cancellation — COMPLETE

Product commit: `d36cbc3c...`.

Queued abort cannot stop an active request; active send owns Stop; same-channel serialization and cross-channel concurrency are covered by tests.

### Stage 4 — transactional page/browser reset — COMPLETE

Product commit: `888cbc0e...`.

`send()` validates expected browser/page epochs. Page loss/restart raises transport reset; generator retries once using a new web chat plus full canonical replay rather than sending delta into an empty page.

### Stage 5 — canonical conversation synchronization — COMPLETE

Product commit: `b58fa5d2...`.

Abort/provider failure invalidates browser cache. Synchronizer tests cover FunctionResponse/sequential tools, model/system/transport changes, compaction/history rewrite and channel isolation.

### Stage 6 — shared authentication cancellation isolation — COMPLETE

Product commit: `64a76a5e...`.

Shared login uses an internal cancellation task: one waiter may cancel independently; the last cancelled waiter aborts and cleans the shared auth flow; a later auth waits for cleanup before starting.

Verification for Stages 2–6:

- Run `35242758301`: Stages 2–5 focused tests + build + typecheck PASS.
- Run `35243388297`: Stages 2–6 focused tests + build + typecheck PASS.

### Stage 7 — process/browser/channel lifecycle — COMPLETE

Verified feature state SHA: `f348aa867457285d40a82d151c550f10c5fcbd36`.

Implemented process-level lazy cleanup through Qwen Code's existing exit cleanup path, per-channel disposal, stale/idle page pruning and session-transition (`/clear`) channel disposal without killing the process-wide browser.

Verification: run `35245733730` — clean install, core lifecycle tests, CLI cleanup test, full build and typecheck PASS.

### Stage 8 — credentialless `/auth` UI — COMPLETE

Product commit: `d13f7ad18615bd34cd9f270f67ee5a416a72fb60` — `feat(qwen-web): add credentialless auth UI`.

Implemented:

- shared credentialless `Qwen Web` install helper using the existing transactional provider install path;
- install plan writes `authType=qwen-web` and model `qwen3.8-max` only — no env/API key/base URL/fake credentials;
- Ink and OpenTUI `/auth` expose `Qwen Web — Use browser session, no API key` directly, bypassing API-key wizard;
- `QWEN_DEFAULT_AUTH_TYPE=qwen-web` accepted;
- Ink header reports `Qwen Web`, not `API Key`;
- browser remains lazy because auth selection only refreshes the lazy content generator;
- credentialless install-plan test added.

Verification: run `35249361589` on verifier commit `288416f4af0ace11485575999bef01618b932c8f` — clean install, all Qwen Web focused core tests, CLI auth/lifecycle tests (including Ink/OpenTUI suites), full build and typecheck PASS.

## Current stage

### Stage 9 — mocked end-to-end host-tool integration — IN PROGRESS

Required scenarios:

1. Qwen Code request -> fake browser -> XML `<invoke>` -> existing XML recovery -> FunctionCall -> fake host tool -> FunctionResponse -> browser serialization -> final answer.
2. Multiple sequential host tools before final answer.
3. Permission-gated edit path where feasible without duplicating Qwen Code scheduler logic.
4. Abort then canonical replay.
5. Main/subagent channel isolation while sharing one browser service.

**NEXT ACTION:** inspect existing `LlmChat`/XML-recovery/tool-scheduler tests, add the smallest fake browser/content-generator seam that exercises the real Qwen Code XML recovery and host-tool round trip, then add the Stage 9 test file to the existing verifier. Do not create a second agent loop or a test-only tool protocol.

## Remaining stages

### Stage 10 — negative/security invariants

- No cookie/storage/token extraction/logging.
- No hidden Qwen APIs or native Qwen Web tools.
- Embeddings/media unsupported explicitly.
- Browser/model mismatch errors explicit.
- Tool-result XML escaping/injection regression tests.

### Stage 11 — full automated gate

Required clean run:

```bash
npm ci
npm run check:lockfile
npm run lint:ci
npm run build
npm run typecheck
npm run test
npm run test:ci
npm run check:serve-fast-path-bundle
```

### Stage 12 — real Qwen Web manual acceptance

Fresh visible login; subsequent headless reuse; plain prompt; host `read_file`; sequential tools; permission-gated edit; shell through Qwen Code; Ctrl+C recovery; `/clear`; compaction; page loss; browser restart; main/subagent isolation; no page leak; no zombie browser after exit.

## Definition of Done

Complete only when automated gates and real browser acceptance prove that Qwen Code remains the sole agent/tool executor, the browser transport is credentialless/text-only/lazy, canonical history survives resets/cancellation/compaction, visible browser appears only for auth, and no authentication data is extracted or logged.

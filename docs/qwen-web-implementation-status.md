# Qwen Web browser provider — implementation checkpoint

Last updated: 2026-09-17

## Recovery pointer

This file is the authoritative restart point for the `qwen-web` integration. After any interruption:

1. Read this file.
2. Fetch `feat/qwen-web-browser-provider` HEAD.
3. Verify the last recorded product SHA still exists in that history.
4. Continue from **NEXT ACTION**. Do not restart earlier stages unless their recorded verification is disproved.

**Feature branch:** `feat/qwen-web-browser-provider`

**Pre-hardening backup:** `backup/qwen-web-before-hardening-2026-09-17`

**Backup SHA:** `2abfdc15bc1403e5987428f96f920df3b8bb0ddb`

**Merged upstream baseline:** `QwenLM/qwen-code@293a5b81127e5c5afef1d4e904dcc081c5b14765`

**Upstream merge commit:** `852c160368d9bd1f1351f851058d049ba83c2888`

## Non-negotiable requirements

- Qwen Code remains the only agent core and owns tools, permissions, shell, files, Git, MCP, skills, history, compaction and subagents.
- Qwen Web is only the LLM transport. No second agent loop.
- No hidden Qwen APIs, browser extension, token/cookie/storage extraction, or credential interception.
- Browser authentication remains only in the persistent browser profile under Qwen home.
- V1 is text-only; embeddings/media fail explicitly.
- One process-wide browser; isolated pages/channels for main and subagents.
- Qwen Code history is canonical. Browser chat is a transport cache and must replay after mismatch/reset/page loss/restart/compaction/session/model/system/tool-manifest changes.
- Visible browser is only for login/re-authentication; normal inference is headless.
- Cancellation is driven by Qwen Code AbortSignal. Queued cancellation must never stop another active request; active cancellation must stop generation and reject partial output.
- `<invoke>...</invoke>` is the only host-tool call transport. Browser code never executes tools.
- Qwen Web native tools are forbidden and must fail the turn if actually used.
- Browser startup remains lazy: `qwen --help` and configuration must not launch Chromium.

## Completed stages

### Stage 0 — upstream sync and clean baseline — COMPLETE

Evidence:

- Backup branch created from `2abfdc15bc1403e5987428f96f920df3b8bb0ddb`.
- Upstream merged in `852c160368d9bd1f1351f851058d049ba83c2888`.
- Baseline workflow run `35188200694`, job `105094733313`: `npm ci` PASS, `npm run build` PASS, `npm run typecheck` PASS.
- Temporary baseline workflow removed in `d1d992e49638ad8a0815c77dc96f093423f16739`.

### Stage 1 — credentialless text-only model contract — COMPLETE

Product commit:

`4c7159492c2ffb7c5c885ed1ce6a0414dea081e2` — `fix(qwen-web): define credentialless text-only model contract`

Implemented:

- Built-in `QWEN_WEB_MODELS` with official v1 model `qwen3.8-max`.
- Qwen Web model registered in `ModelRegistry` and protected from user-provider override.
- Resolver ignores API key/API-key env key/base URL for qwen-web.
- qwen-web forces `modalities: {}` even though generic `qwen3.8-max` capability detection may advertise vision.
- Explicit model requests remain explicit; no silent fallback.
- Focused registry/resolver validation tests added.

Verification:

- Focused Stage 1 tests PASS.
- Full build PASS.
- Full typecheck PASS.
- These gates were run twice successfully; earlier failures were only CI `git push` races after the gates had passed.

## Current stage

### Stage 2 — hardened browser transport semantics — VERIFYING

Product commit:

`6edbeb673e2055bda7a8872ca68a9765ad03c093` — `fix(qwen-web): restore hardened browser transport semantics`

Implemented in that product commit:

- 30-minute Puppeteer `protocolTimeout`.
- Puppeteer `handleSIGINT`, `handleSIGTERM`, `handleSIGHUP` disabled so Qwen Code owns signals.
- Chromium background-timer/background-window/renderer throttling disabled.
- Added macOS Yandex Browser executable candidate.
- Model label matching accepts decorated UI labels such as `Qwen3.8-Max (Recommended)` while rejecting a different model.
- Page runtime preserves multiline text and indentation instead of collapsing all whitespace.
- Response extraction uses the first working selector instead of combining nested fallback selectors.
- Login detection is conservative/stabilized instead of immediately treating `input && !login-button` as authenticated.
- Comparison-screen detection/selection widened for English/Russian/Chinese UI text.
- Retry/regenerate/provider-error detection widened.
- Native-tool detection is scoped to the latest model response instead of treating a permanent Web Search UI control as tool execution.
- Closed `<invoke>` still cannot finish while a visible Stop control indicates active generation.
- Added controller launch/model-label regression tests.
- Added browser-backed DOM regression tests for multiline response preservation, selector priority, login detection, native-tool scoping and Stop gating.

Verifier workflow commit:

`fb2bb2ed8044923d443696d9cb7a4a0af0d67b8f` — temporary verifier only; it is not part of Stage 2 product semantics.

Current verifier:

- Run: `35231816891`
- Job: `105237577840`
- Gate: `npm ci` -> focused Stage 2 tests -> full build -> full typecheck.
- Status at this checkpoint: **IN PROGRESS**, currently in `npm ci`.

**NEXT ACTION:** inspect run `35231816891`. If a product/test gate fails, fix only that concrete failure in a small commit on `feat/qwen-web-browser-provider` and rerun. If all gates pass, delete `.github/workflows/qwen-web-stage2-verify.yml`, mark Stage 2 COMPLETE here, then implement Stage 3 directly on the feature branch.

## Remaining stages

### Stage 3 — ownership-safe cancellation

- Remove the queued-abort race where a queued request can stop the active request.
- Give each channel an active request identity/ownership.
- Only an active send may press Stop.
- Active cancellation presses Stop once, rejects partial output and returns AbortError.
- Same channel serialized; different channels concurrent.
- Add focused concurrency/cancellation tests.
- Planned product commit: `fix(qwen-web): make channel cancellation ownership-safe`.

### Stage 4 — transactional page/browser reset

- Send against expected browser/page epoch.
- Page loss/browser restart must raise transport-reset instead of silently creating a page and sending only delta.
- Retry once using new browser chat + full canonical replay.
- Add page-loss/browser-restart tests.

### Stage 5 — canonical conversation synchronization

- Track model/signature/browser epoch/page epoch/delivered history/dirty state.
- Replay on session/model/system/tool-manifest/compaction/branch/resume/history mismatch/reset/dirty channel.
- Correct sequential tool-result deltas.
- Add synchronizer matrix tests.

### Stage 6 — shared authentication cancellation isolation

- Shared login task must not belong to the first caller's AbortSignal.
- One cancelled waiter must not cancel another waiter.
- Last cancelled waiter closes visible login browser.
- Successful login restarts headless mode.

### Stage 7 — process/browser/channel lifecycle

- Integrate lazy process-level browser cleanup with Qwen Code shared exit cleanup.
- One ACP/daemon Config ending must not kill a browser used by another session.
- Dispose/prune stale session/subagent pages.
- No zombie browser processes.

### Stage 8 — credentialless `/auth` UI

- Add Qwen Web option in Ink and OpenTUI.
- No API-key/env/base-URL prompt or fake credentials.
- Accept `QWEN_DEFAULT_AUTH_TYPE=qwen-web`.
- Header/footer/status identify `Qwen Web`, not `API Key`.

### Stage 9 — mocked end-to-end host-tool integration

- Qwen Code request -> fake browser -> XML invoke -> existing XML recovery -> FunctionCall -> host tool -> FunctionResponse -> browser -> final response.
- Multiple sequential tools.
- Permission-gated edit.
- Abort then canonical replay.
- Main/subagent isolation with one browser service.

### Stage 10 — negative/security invariants

- No cookie/storage/token extraction/logging.
- No hidden Qwen APIs/native tools.
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

Required acceptance includes: fresh visible login, subsequent headless reuse, plain prompt, host `read_file`, sequential tools, permission-gated edit, shell through Qwen Code, Ctrl+C recovery, `/clear`, compaction, page loss, browser restart, main/subagent isolation, no page leak and no zombie browser after exit.

## Definition of Done

The provider is complete only when automated gates and real browser acceptance prove that Qwen Code remains the sole agent/tool executor, the browser transport is credentialless/text-only/lazy, canonical history survives resets/cancellation/compaction, visible browser appears only for auth, and no authentication data is extracted or logged.

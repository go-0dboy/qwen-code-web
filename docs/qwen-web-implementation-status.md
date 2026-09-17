# Qwen Web browser provider — implementation status

Last updated: 2026-09-17

## Recovery pointer

This file is the authoritative recovery journal for the `qwen-web` implementation. After any interruption, read this file first, fetch the current HEAD of `feat/qwen-web-browser-provider`, and continue from **NEXT ACTION** below. Do not restart the integration from scratch unless this journal explicitly says the branch is unrecoverable.

**Active branch:** `feat/qwen-web-browser-provider`

**Pre-hardening backup:** `backup/qwen-web-before-hardening-2026-09-17`

**Backup SHA:** `2abfdc15bc1403e5987428f96f920df3b8bb0ddb`

**Current upstream baseline merged:** `QwenLM/qwen-code@293a5b81127e5c5afef1d4e904dcc081c5b14765`

**Upstream merge commit in feature branch:** `852c160368d9bd1f1351f851058d049ba83c2888`

**Stage 0 cleanup commit:** `d1d992e49638ad8a0815c77dc96f093423f16739`

**NEXT ACTION:** Stage 1 — implement the built-in credentialless, text-only Qwen Web model contract on a dedicated work branch, add focused model registry/resolver tests, then run focused tests + build + typecheck before merging it into the feature branch.

## Non-negotiable architecture

1. Qwen Code remains the only agent core. It owns the agent loop, tool registry, shell, file operations, Git, MCP, skills, permissions, session history, context compaction, subagents, and tool execution.
2. Qwen Web is only an LLM transport. It must not execute native Qwen Web tools.
3. Do not copy the old second agent loop from the browser project.
4. Do not use hidden Qwen Web APIs, browser extensions, token interception, cookie extraction, access-token extraction, or internal credential extraction.
5. Authentication/session state stays inside the persistent browser profile.
6. V1 is text-only. Embeddings and media are unsupported and must fail explicitly rather than being silently dropped.
7. One process-wide Chromium/Yandex/Chrome instance is shared. Main/subagent conversations use separate pages/channels.
8. Qwen Code history is canonical. Qwen Web chat is only a transport cache and must be rebuilt from canonical history after mismatch, compaction, branch/resume, session/model/system/tool-manifest change, browser restart, or page loss.
9. Visible browser is allowed only for login/re-authentication. Normal inference runs headless.
10. Cancellation is owned by Qwen Code AbortSignal. An active cancelled request presses Stop, rejects partial output, and returns AbortError. A queued cancellation must never stop another active request.
11. Qwen Code XML `<invoke>` is the only tool-call transport dialect. The browser provider never executes tools itself.
12. `qwen --help` and auth/model configuration must not start Chromium. Browser initialization remains lazy until the first real Qwen Web model request.

## Already implemented before the staged hardening

- `AuthType.QWEN_WEB = "qwen-web"`.
- CLI/SDK auth-type parity and no-API-key core validation.
- `QWEN_WEB_DEFAULT_MODEL = "qwen3.8-max"` default mapping.
- `puppeteer-core` runtime dependency in core and corresponding lockfile changes.
- Lazy `QwenWebContentGenerator` loading; qwen-web bypasses the generic network-runtime preload.
- `packages/core/src/core/qwenWebContentGenerator/` module with browser config/controller/page runtime, browser service, synchronizer, prompt serializer, tool protocol, response factory and generator.
- Process-wide browser service singleton and separate channel pages.
- Persistent profile under Qwen home with restrictive filesystem permissions.
- Text serializer rejects unsupported media explicitly.
- XML `<invoke>` host-tool protocol; Qwen Code remains the tool executor.
- Native Qwen Web tool usage is treated as an error.
- First re-authentication hardening and focused tests are in `f2904f4c40bfeefafc0bd8b6c2d1ab340babecd3`.
- Previous temporary hardening workflow was removed in `2abfdc15bc1403e5987428f96f920df3b8bb0ddb`.

## Audit findings that still require work

### Provider/model contract

- Register a hard-coded `QWEN_WEB_MODELS` entry in `ModelRegistry`.
- `qwen3.8-max` must be text-only for qwen-web (`modalities: {}`), regardless of generic API-model capability detection.
- Qwen Web must ignore API-key/base-URL sources and must not expose controllable capabilities the browser transport cannot actually set.

### Browser transport parity with the working `src.zip`

- Preserve newlines/indentation; never collapse model response whitespace.
- Use the first response selector that actually matches instead of concatenating all fallback-selector matches.
- Restore the working 30-minute Puppeteer `protocolTimeout`.
- Restore background-throttling-disabling Chromium flags.
- Disable Puppeteer-owned SIGINT/SIGTERM/SIGHUP handling so Qwen Code owns process signals.
- Restore conservative/stabilized login detection.
- Restore comparison/retry/regenerate/provider-error/model-selection robustness from the working implementation.
- Detect actual native-tool execution, not the permanent presence of a Web Search control.

### Cancellation/concurrency

- A queued request must not stop an unrelated active request when its AbortSignal fires.
- Add per-channel active-request ownership.
- Active cancellation must dirty/invalidate the Qwen Web conversation because it may contain an aborted user turn or partial assistant response.
- Shared authentication must not be owned by the first caller's AbortSignal.

### History/transport reset

- Detect page loss between prepare/delta computation and send.
- Never silently create a fresh page and send only a delta after page loss.
- Transport reset must trigger a new web chat plus replay of canonical Qwen Code history.
- Failed/aborted prompts that may have reached Qwen Web must dirty the channel.
- `/clear` and completed subagents must not leak browser tabs indefinitely.

### Lifecycle

- Do not rely only on `process.beforeExit`.
- Do not close the process-wide browser from each individual `Config.shutdown()` in daemon/ACP mode.
- Register process-level browser cleanup once in Qwen Code's shared exit-cleanup chain; keep channel/session disposal separate.
- Cleanup must remain lazy.

### CLI/UI

- Add a credentialless Qwen Web `/auth` path rather than routing it through the generic API-key provider wizard.
- Support both Ink and OpenTUI.
- Accept `QWEN_DEFAULT_AUTH_TYPE=qwen-web`.
- Header/footer/status must identify Qwen Web rather than API Key.

## Execution plan and status

### Stage 0 — Preserve state, sync upstream, establish green baseline

Status: **COMPLETE**

Completed:

- [x] Backup branch `backup/qwen-web-before-hardening-2026-09-17` created from `2abfdc15bc1403e5987428f96f920df3b8bb0ddb`.
- [x] Recovery journal added in `24b8d1069cd8b552d60f0c80d4a3fa4321874108`.
- [x] Fork `main` synchronized to upstream `293a5b81127e5c5afef1d4e904dcc081c5b14765`.
- [x] Upstream merged into feature branch through PR #1; merge commit `852c160368d9bd1f1351f851058d049ba83c2888`.
- [x] No qwen-web changes were discarded by the merge.
- [x] Temporary Stage 0 workflow commit: `7648949572c261e380412e9fe5a2768c46ceeee6`.
- [x] GitHub Actions run `35188200694`, job `105094733313` completed successfully.
- [x] `npm ci` — PASS.
- [x] `npm run build` — PASS.
- [x] `npm run typecheck` — PASS, including workspace and integration typechecks.
- [x] Temporary Stage 0 workflow removed in `d1d992e49638ad8a0815c77dc96f093423f16739`.

Notes: build/npm emitted ordinary repository warnings (bundle size/browser mapping/audit output), but none failed the Stage 0 gate. They are not being mixed into qwen-web hardening without separate evidence that they are caused by this feature.

### Stage 1 — Credentialless text-only model contract

Status: **IN PROGRESS**

Required changes:

- [ ] Add hard-coded `QWEN_WEB_MODELS` containing `qwen3.8-max`.
- [ ] Register it in `ModelRegistry` and prevent user `modelProviders` entries from overriding the built-in qwen-web contract.
- [ ] Default qwen-web registry model must be `qwen3.8-max`.
- [ ] Force qwen-web `modalities: {}` even if generic model detection/settings/provider config consider `qwen3.8-max` image-capable.
- [ ] Resolver must ignore API key, API-key env key and base URL sources for qwen-web.
- [ ] Explicit model selection must remain explicit; no silent fallback to a different model.
- [ ] Add focused tests for registry, resolver, no-key/no-base-url behavior, text-only behavior, explicit-model preservation and validation.
- [ ] Run focused core tests.
- [ ] Run build and typecheck.
- Planned product commit: `fix(qwen-web): define credentialless text-only model contract`.

### Stage 2 — Restore hardened browser transport semantics

Status: NOT STARTED

- [ ] Preserve multiline model response text.
- [ ] First-working-selector response extraction.
- [ ] 30-minute Puppeteer protocol timeout.
- [ ] Disable background throttling.
- [ ] Disable Puppeteer-owned SIGINT/SIGTERM/SIGHUP handling.
- [ ] Stabilized login detection.
- [ ] Harden completion/native-tool/comparison/retry/model-selection behavior using `src.zip` as the working reference.
- [ ] Add page-runtime/controller unit tests.
- Planned commit: `fix(qwen-web): restore hardened browser transport semantics`.

### Stage 3 — Ownership-safe cancellation

Status: NOT STARTED

- [ ] Add active request identity to each channel.
- [ ] Queued abort must not press Stop.
- [ ] Active abort presses Stop once, rejects partial output and returns AbortError.
- [ ] Different channels remain concurrent; same channel remains serialized.
- [ ] Add concurrency/cancellation tests.
- Planned commit: `fix(qwen-web): make channel cancellation ownership-safe`.

### Stage 4 — Transactional transport epoch/page reset

Status: NOT STARTED

- [ ] Send against expected browser/page transport state.
- [ ] Page/browser epoch mismatch raises a transport-reset error instead of silently creating a page.
- [ ] Generator retries with full canonical replay once.
- [ ] Add page-loss/browser-restart tests.
- Planned commit: `fix(qwen-web): make transport reset replay canonical history`.

### Stage 5 — Canonical conversation synchronization

Status: NOT STARTED

- [ ] Track model/signature/browser epoch/page epoch/delivered canonical history/dirty state.
- [ ] Replay on session, model, system/tool manifest, compaction, branch/resume, history mismatch, transport reset or dirty channel.
- [ ] Correct tool-result and multiple-tool deltas.
- [ ] Add synchronizer matrix tests.
- Planned commit: `fix(qwen-web): harden canonical conversation synchronization`.

### Stage 6 — Shared authentication cancellation isolation

Status: NOT STARTED

- [ ] Shared auth task independent from one caller AbortSignal.
- [ ] Individual waiters can cancel without cancelling other waiters.
- [ ] Last waiter cancellation closes the visible login browser.
- [ ] Successful login restarts headless mode.
- [ ] Add concurrent auth tests.
- Planned commit: `fix(qwen-web): isolate shared authentication from caller cancellation`.

### Stage 7 — Browser/process/channel lifecycle

Status: NOT STARTED

- [ ] Process-level lazy browser cleanup registered once in shared Qwen Code exit cleanup.
- [ ] One daemon/ACP Config ending must not kill Chromium used by other sessions.
- [ ] Add `disposeChannel`/idle pruning for stale session/subagent pages.
- [ ] Browser close is idempotent.
- [ ] Tests for process cleanup, no-start cleanup and channel isolation.
- Planned commit: `fix(qwen-web): align browser lifecycle with Qwen Code shutdown`.

### Stage 8 — Credentialless `/auth` UI

Status: NOT STARTED

- [ ] Ink `/auth` Qwen Web option.
- [ ] OpenTUI `/auth` Qwen Web option.
- [ ] Selection writes auth type/model only; no fake API key/env/base URL.
- [ ] Accept `QWEN_DEFAULT_AUTH_TYPE=qwen-web`.
- [ ] Correct header/footer/status labels.
- [ ] Add UI tests for both renderers.
- Planned commit: `feat(qwen-web): add credentialless auth UI`.

### Stage 9 — Mocked end-to-end host-tool round trips

Status: NOT STARTED

- [ ] Qwen Code request -> fake browser -> XML invoke -> existing XML recovery -> FunctionCall -> host tool -> FunctionResponse -> browser -> final response.
- [ ] Multiple sequential host tools.
- [ ] Permission-gated edit path.
- [ ] Abort -> partial discarded -> next request canonical replay.
- [ ] Main/subagent share one browser service while keeping isolated pages/history.
- Planned commit: `test(qwen-web): cover browser provider tool round trips`.

### Stage 10 — Negative/security invariants

Status: NOT STARTED

- [ ] No cookie/storage/token extraction or logging.
- [ ] No hidden Qwen APIs.
- [ ] Native Qwen tools rejected.
- [ ] Embeddings/media rejected explicitly.
- [ ] Browser-path/model mismatch errors explicit.
- [ ] Tool-result XML escaping/injection regression tests.
- Planned commit: `test(qwen-web): pin transport security invariants`.

### Stage 11 — Full automated quality gate

Status: NOT STARTED

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

Any failing upstream test must be investigated and evidence recorded here before deciding whether it is unrelated.

### Stage 12 — Real browser manual acceptance

Status: NOT STARTED

Required scenarios:

1. Fresh profile -> visible login browser.
2. Login completes -> visible browser closes -> headless continues.
3. Restart -> no visible login when session is valid.
4. Plain text question.
5. `read_file` via Qwen Code host tool.
6. Multiple sequential host tools.
7. Permission-gated file edit.
8. Shell command via Qwen Code only.
9. Ctrl+C cancels active generation; partial response is rejected; next turn uses clean history.
10. `/clear` starts a separate web conversation.
11. Context compaction replays canonical context.
12. Page loss recovers with replay.
13. Chromium restart recovers with replay.
14. Main and subagent use separate chats/pages.
15. Repeated `/clear`/subagent runs do not leak unbounded pages.
16. Qwen Code exit leaves no Chromium/Yandex zombie process.

Planned closeout commit: `chore(qwen-web): complete release and acceptance hardening`.

## Definition of Done

The provider is complete only when all of the following are true:

- Clean checkout installs and builds.
- Typecheck, lint, full unit/CI tests and qwen-web focused tests are green.
- Qwen Code remains the sole agent/tool executor.
- Browser transport is credentialless and text-only in v1.
- One process-wide browser with isolated pages/channels.
- Canonical Qwen Code history survives cancellation, compaction, page loss, browser restart, `/clear`, resume and subagents.
- Visible browser appears only when login/re-auth is required.
- No cookies/tokens/storage data are extracted or logged.
- All 16 manual acceptance scenarios pass.

## Recovery procedure after interruption

1. Read this file from `feat/qwen-web-browser-provider`.
2. Fetch the branch HEAD and note the latest commit message.
3. Verify the last COMPLETE stage against GitHub; never assume an interrupted tool call committed successfully.
4. Compare with `backup/qwen-web-before-hardening-2026-09-17` only if state is unclear.
5. Continue from **NEXT ACTION** and the first unchecked item in the current stage.
6. Every completed stage must have: product/test commits, tests actually run with their outcomes recorded here, and a journal update before the next stage starts.

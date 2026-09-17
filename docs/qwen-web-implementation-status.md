# Qwen Web browser provider — implementation status

Last updated: 2026-09-17

## Purpose

This document is the recovery journal for the `qwen-web` browser provider implementation. It records the required architecture, completed changes, outstanding work, validation gates, and the exact branch/commit from which work should continue after an interruption.

## Repository state

- Repository: `go-0dboy/qwen-code-web`
- Active implementation branch: `feat/qwen-web-browser-provider`
- Pre-hardening backup branch: `backup/qwen-web-before-hardening-2026-09-17`
- Backup commit: `2abfdc15bc1403e5987428f96f920df3b8bb0ddb`
- Original integration base: upstream commit `b8def02aadfc384ecb860909155d196267c4fa0c`
- Latest upstream observed during audit: `QwenLM/qwen-code@9dd689f048f0dba5a3b8a73e78c40f6628001c8d`

If work is interrupted, first read this document, inspect the current HEAD of `feat/qwen-web-browser-provider`, compare it with the last completed stage below, and continue from the first incomplete stage. Never restart the integration from scratch unless this journal explicitly says the branch is unrecoverable.

## Non-negotiable architecture

1. Qwen Code remains the only agent core and owns the agent loop, tool registry, shell, file operations, Git, MCP, skills, permissions, session history, context compaction, subagents, and tool execution.
2. Qwen Web is only an LLM transport. It must not execute native Qwen Web tools.
3. Do not copy the old second agent loop from the original browser project.
4. Do not use hidden Qwen Web APIs, token interception, cookie extraction, access-token extraction, or browser extensions.
5. Browser credentials/session data remain only inside the persistent browser profile.
6. V1 is text-only. Embeddings and media are unsupported and must fail explicitly rather than being silently dropped.
7. One process-wide Chromium/Yandex/Chrome instance is shared. Main/subagent conversations use separate pages/channels.
8. Qwen Code conversation history is canonical. Qwen Web chat is a transport cache and must be rebuilt from canonical history after mismatch, compaction, branch/resume, session change, model/system/tool-manifest change, browser restart, or page loss.
9. Visible browser is allowed only for login/re-authentication. Normal inference runs headless.
10. Cancellation is owned by Qwen Code AbortSignal. An active cancelled request must press Stop, reject partial output, and return AbortError. A queued cancellation must never stop another active request.

## Already implemented before this journal

The feature branch already contains the initial provider wiring and first hardening pass:

- `AuthType.QWEN_WEB = "qwen-web"`.
- CLI/SDK auth-type parity and no-API-key core validation.
- `QWEN_WEB_DEFAULT_MODEL = "qwen3.8-max"` default mapping.
- `puppeteer-core` runtime dependency in core.
- Lazy `QwenWebContentGenerator` loading and no generic network-runtime preload for qwen-web.
- `qwenWebContentGenerator/` module with browser config/controller/page runtime, browser service, synchronizer, prompt serializer, tool protocol, response factory.
- Process-wide browser service singleton and separate channel pages.
- Persistent profile under Qwen home with restrictive filesystem permissions.
- Text-only serializer with explicit errors for unsupported content parts.
- XML `<invoke>` host-tool protocol; browser provider does not execute tools itself.
- Strict error if a native Qwen Web tool is detected during a response.
- First re-authentication hardening and focused tests added in commit `f2904f4c40bfeefafc0bd8b6c2d1ab340babecd3`.
- The temporary hardening workflow was removed in `2abfdc15bc1403e5987428f96f920df3b8bb0ddb`.
- Prior CI evidence: clean install, focused tests, full build, and typecheck passed for that hardening state; the workflow's final self-delete step failed because GitHub Actions could not delete its own workflow file, not because the product code failed.

## Audit findings that must still be fixed

### Provider/model contract

- Register a built-in `QWEN_WEB_MODELS` entry in `ModelRegistry`.
- Ensure `qwen3.8-max` is text-only for qwen-web (`modalities: {}`) even though generic model detection may consider the normal API model vision-capable.
- Ensure qwen-web has no API key/base URL contract and no controllable reasoning capability that the browser transport cannot actually set.

### Browser transport regressions versus the working `src.zip`

- Preserve newlines/indentation; do not collapse response whitespace with `replace(/\s+/g, " ")`.
- Use the first response selector that actually matches, rather than concatenating all fallback selector results.
- Restore long Puppeteer `protocolTimeout` (working implementation used 30 minutes).
- Restore background-throttling-disabling browser flags.
- Set Puppeteer signal handlers off so Qwen Code owns Ctrl+C/process shutdown.
- Restore conservative/stabilized login detection so a hydrating page is not mistaken for an authenticated session.
- Harden comparison/retry/regenerate/provider-error/model-selection behavior using the known working implementation as the reference.
- Detect actual native-tool execution, not merely the permanent presence of a Web Search button.

### Cancellation/concurrency

- A queued request currently can stop an unrelated active request when its AbortSignal fires. Add per-channel active request ownership.
- Active cancellation must invalidate/dirty the web conversation because the browser may contain an aborted user turn/partial assistant response.
- Shared authentication must not be owned by the first caller's AbortSignal; one caller cancelling must not cancel login for other waiters.

### History/transport reset

- Detect a page disappearing between prepare/synchronizer-delta computation and send.
- Never silently create a fresh page and send only delta after page loss; throw a transport-reset signal and replay canonical history.
- Invalidate and replay after a failed/aborted prompt that may have reached Qwen Web.
- Add channel/page retirement so `/clear` and completed subagents do not leak tabs indefinitely.

### Lifecycle

- Do not rely only on `process.beforeExit`; Node does not run it for all `process.exit()` paths.
- Do not close the process-wide browser from every `Config.shutdown()` in daemon/ACP because multiple sessions may share it.
- Register process-level browser cleanup once in Qwen Code's shared exit-cleanup chain, while keeping per-session/per-channel disposal separate.
- Cleanup must remain lazy: `qwen --help` must never instantiate Puppeteer/browser state.

### CLI/UI

- Add a true credentialless Qwen Web `/auth` path; do not route it through the generic provider wizard that always writes env/API-key credentials.
- Support both Ink and OpenTUI.
- `QWEN_DEFAULT_AUTH_TYPE=qwen-web` must validate.
- Header/footer/status must display Qwen Web rather than API Key.

## Execution plan and status

### Stage 0 — Preserve state and sync upstream

Status: IN PROGRESS

- [x] Create backup branch `backup/qwen-web-before-hardening-2026-09-17` from `2abfdc15...`.
- [x] Add this recovery journal.
- [ ] Synchronize feature branch with current upstream `QwenLM/qwen-code/main`.
- [ ] Resolve conflicts without dropping qwen-web changes.
- [ ] Run baseline gates: `npm ci`, `npm run build`, `npm run typecheck`.
- Planned commit: `chore: sync qwen-web branch with upstream main`.

### Stage 1 — Credentialless text-only model contract

Status: NOT STARTED

- [ ] Add `QWEN_WEB_MODELS` containing `qwen3.8-max`.
- [ ] Register hard-coded qwen-web model in `ModelRegistry`.
- [ ] Make qwen-web resolver text-only (`modalities: {}`).
- [ ] Preserve no-API-key/no-base-url behavior.
- [ ] Add model-registry/resolver/no-key/text-only tests.
- Planned commit: `fix(qwen-web): define credentialless text-only model contract`.

### Stage 2 — Restore hardened browser transport semantics

Status: NOT STARTED

- [ ] Preserve multiline response text.
- [ ] First-working-selector response extraction.
- [ ] 30-minute protocol timeout.
- [ ] Disable background throttling.
- [ ] Disable Puppeteer-owned SIGINT/SIGTERM/SIGHUP handling.
- [ ] Stabilized login detection.
- [ ] Harden completion/native-tool/comparison/retry/model-selection logic.
- [ ] Add page-runtime/controller unit tests.
- Planned commit: `fix(qwen-web): restore hardened browser transport semantics`.

### Stage 3 — Ownership-safe cancellation

Status: NOT STARTED

- [ ] Add active request identity to each channel.
- [ ] Queued abort must not press Stop.
- [ ] Active abort presses Stop once, rejects partial output, returns AbortError.
- [ ] Different channels remain concurrent; same channel remains serialized.
- [ ] Add concurrency/cancellation tests.
- Planned commit: `fix(qwen-web): make channel cancellation ownership-safe`.

### Stage 4 — Transactional transport epoch/page reset

Status: NOT STARTED

- [ ] Introduce expected browser/page transport state on send.
- [ ] Page/browser epoch mismatch raises transport-reset error instead of silently creating a page.
- [ ] Generator retries with full canonical replay once.
- [ ] Add page-loss/browser-restart tests.
- Planned commit: `fix(qwen-web): make transport reset replay canonical history`.

### Stage 5 — Canonical conversation synchronizer hardening

Status: NOT STARTED

- [ ] Track model/signature/browser epoch/page epoch/delivered canonical history/dirty state.
- [ ] Replay on session, model, system/tool manifest, compaction, branch/resume, history mismatch, transport reset, or dirty channel.
- [ ] Correct tool-result and multiple-tool deltas.
- [ ] Add synchronizer matrix tests.
- Planned commit: `fix(qwen-web): harden canonical conversation synchronization`.

### Stage 6 — Shared authentication cancellation isolation

Status: NOT STARTED

- [ ] Shared auth task independent from a single caller AbortSignal.
- [ ] Individual waiters can cancel without cancelling other waiters.
- [ ] Last waiter cancellation closes visible login browser.
- [ ] Successful login restarts headless mode.
- [ ] Add concurrent auth tests.
- Planned commit: `fix(qwen-web): isolate shared authentication from caller cancellation`.

### Stage 7 — Browser/process/channel lifecycle

Status: NOT STARTED

- [ ] Process-level lazy browser cleanup registered once in shared Qwen Code exit cleanup.
- [ ] Do not kill shared Chromium when one daemon/ACP Config ends.
- [ ] Add `disposeChannel`/idle pruning for stale session/subagent pages.
- [ ] Idempotent browser close.
- [ ] Tests for process cleanup, no-start cleanup, and channel isolation.
- Planned commit: `fix(qwen-web): align browser lifecycle with Qwen Code shutdown`.

### Stage 8 — Credentialless `/auth` UI

Status: NOT STARTED

- [ ] Add Qwen Web option to Ink `/auth`.
- [ ] Add Qwen Web option to OpenTUI `/auth`.
- [ ] Selecting it writes auth type/model only; no fake API key/env/base URL.
- [ ] Accept `QWEN_DEFAULT_AUTH_TYPE=qwen-web`.
- [ ] Correct header/footer/status labels.
- [ ] UI tests for both renderers.
- Planned commit: `feat(qwen-web): add credentialless auth UI`.

### Stage 9 — Mocked end-to-end Qwen Code tool round trips

Status: NOT STARTED

- [ ] Qwen Code request -> fake browser -> XML invoke -> existing XML recovery -> FunctionCall -> fake host tool result -> browser -> final answer.
- [ ] Multiple sequential tools.
- [ ] Permission-gated edit path.
- [ ] Abort -> partial discarded -> next request canonical replay.
- [ ] Main/subagent use one browser service but isolated channels/pages.
- Planned commit: `test(qwen-web): cover browser provider tool round trips`.

### Stage 10 — Negative/security invariants

Status: NOT STARTED

- [ ] No cookie/storage/token extraction/logging.
- [ ] No hidden Qwen APIs.
- [ ] Native Qwen tools rejected.
- [ ] Embeddings/media rejected explicitly.
- [ ] Browser path/model mismatch errors are explicit.
- [ ] Tool-result XML container escaping/injection regression tests.
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

Any failing existing upstream test must be investigated; do not mark it ignored merely because it is unrelated without recording evidence here.

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
9. Ctrl+C cancels active generation and next turn works from clean history.
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
- Typecheck, lint, full unit/CI tests, and qwen-web focused tests are green.
- Qwen Code remains the sole agent/tool executor.
- Browser transport is text-only and credentialless.
- One process-wide browser, isolated pages/channels.
- Canonical Qwen Code history survives cancellation, compaction, page loss, browser restart, `/clear`, resume, and subagents.
- Visible browser appears only when login/re-auth is required.
- No cookies/tokens/storage data are extracted or logged.
- All 16 manual acceptance scenarios pass.

## Recovery procedure after interruption

1. Read this file from the active branch.
2. Fetch HEAD of `feat/qwen-web-browser-provider` and note the latest commit message.
3. Do not assume an earlier tool call completed; verify each checkbox against GitHub.
4. Compare the current feature branch with `backup/qwen-web-before-hardening-2026-09-17` if the state is unclear.
5. Continue from the first unchecked item in the current stage.
6. After every completed stage: update this journal in the same stage commit or a following documentation commit, record tests actually run and their result, and only then start the next stage.

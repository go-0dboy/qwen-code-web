# Qwen Web DoD Status

This file is the durable continuation point for the `qwen-code-web` work. Read it before re-auditing the project or starting a new implementation pass.

## Repository state

- Repository: `go-0dboy/qwen-code-web`
- Working branch: `work/qwen-web-dod`
- Draft PR: `#2` — `Qwen Web browser provider: DoD hardening`
- Last verified branch head before this status commit: `b344254c10556ae3165b7c31497f851cd5558ec0`
- Base branch: `main`
- Do not merge the draft PR until the CI/build/typecheck/test gates and the real-browser acceptance pass.

## Product goal

Run the normal Qwen Code agent without an LLM API by using an authenticated `chat.qwen.ai` browser session as the model transport.

Qwen Code must remain the only agent core. The browser layer is transport only.

## Non-negotiable architecture

- Qwen Code owns the agent loop, files, shell, Git, MCP, skills, permissions, history, compaction and subagents.
- The browser provider must never execute Qwen Code tools itself.
- No hidden/private Qwen APIs.
- No extraction or logging of cookies, tokens or auth secrets.
- No browser extensions.
- No Qwen Web native tools for host actions.
- Browser page runtime must be a self-contained serializable function.
- One process-wide Chromium/browser service; separate pages/conversations per Qwen Code channel.
- Channels are `<sessionId>:main` or `<sessionId>:<subagentInvocationId>`.
- Browser is initialized lazily. `qwen --help` and auth selection must not launch Chromium.
- Persistent browser profile lives below `QWEN_HOME/qwen-web/` with restricted permissions.
- Default Qwen Web model: `qwen3.8-max`.
- v1 is text-only. Media and embeddings must fail explicitly.
- Streaming may yield one final response in v1.
- AbortSignal cancellation must be out-of-band and return `AbortError`; partial model output is ignored.
- Qwen Code history is authoritative; browser history is only a cache.
- Browser/page epoch changes force reset + canonical replay.

## Implemented

### Auth/model integration

- Added `AuthType.QWEN_WEB = "qwen-web"` in core and SDK types.
- Added `qwen-web` to CLI auth type choices and parity checks.
- Added default model `qwen3.8-max`.
- Qwen Web auth does not require an API key.
- `/auth` now includes `Qwen Web — Use browser session, no API key`.
- The Qwen Web auth path persists auth type + model without creating API credentials or API provider state.
- `QWEN_DEFAULT_AUTH_TYPE=qwen-web` is accepted.

### Browser transport

- `puppeteer-core` is a runtime dependency of core.
- Uses installed Yandex Browser / Chrome / Chromium.
- Supports `QWEN_WEB_BROWSER_PATH` override.
- Browser metadata stores only executable path.
- Profile/config directories are created under `QWEN_HOME/qwen-web/` with restricted permissions.
- Process-wide browser service singleton.
- Per-channel serialization with different channels able to progress independently.
- Browser epochs and page epochs tracked.
- Login flow: headless probe -> temporary visible browser when login is required -> close -> return to headless.
- Login UX messages added:
  - `Qwen Web login is required.`
  - `A browser window has been opened temporarily.`
  - `Login successful.`
  - `Browser returned to background mode.`
- Auth/navigation failure closes the temporary browser.
- No custom SIGINT/SIGTERM handlers; natural shutdown uses beforeExit/exit fallback.

### Conversation synchronization

- Canonical Qwen Code history is fingerprinted per browser channel.
- Delta is sent for a normal continuation.
- Reset/replay occurs on first request, session/model/system/transport changes and history mismatch.
- Browser-produced assistant echo is not sent back as a duplicate delta.

### Host tool protocol

- Request tool manifest is derived from `request.config.tools`.
- Browser prompt tells the model it is inside Qwen Code and must not use native Qwen Web tools.
- Host tool requests use Qwen XML:
  `<invoke name="..."><parameter name="...">...</parameter></invoke>`.
- Qwen Web provider returns model text; existing Qwen Code XML fallback converts it to real `FunctionCall` parts.
- Host tool results are serialized back deterministically as `QWEN CODE HOST TOOL RESULT`.
- Tool result payload is XML-escaped so literal `</result>` cannot break out of the result container.
- Sequential mocked host-tool integration is covered by test: tool call -> FunctionResponse -> second tool call -> FunctionResponse -> final model text.

### Error/cancellation behavior

- Unsupported inline/file media fails explicitly as text-only transport.
- Embeddings fail with the documented unsupported error.
- Browser model selection is verified and mismatch is a diagnostic error.
- Native Qwen Web tool UI causes a diagnostic error.
- AbortSignal is passed to browser transport and cancellation invokes Stop out-of-band.

## Tests already added

Core Qwen Web tests currently cover:

- browser config/profile path + permissions + executable override
- browser service singleton
- AbortSignal cancellation
- independent channel queues
- main-agent channel
- subagent invocation channel
- media rejection
- embeddings rejection
- conversation delta/replay behavior
- prompt serializer
- tool manifest/protocol escaping
- Qwen XML tool recovery integration
- multiple sequential mocked tool calls
- page-runtime XML completion only after Stop disappears
- model selection normalization and mismatch

CLI tests cover:

- credentialless Qwen Web auth persistence
- `QWEN_DEFAULT_AUTH_TYPE=qwen-web`
- `/auth` Qwen Web option and active selection

## Current CI state

Draft PR #2 was created specifically to obtain GitHub Actions CI feedback. Do not merge it yet.

First confirmed CI failure:

- Workflow: `pnpm Lock Freshness`
- Job: `Lockfile freshness`
- Failure step: `Compare with the committed lockfile`
- Cause: `package-lock.json` contains the new `puppeteer-core` dependency tree, but committed `pnpm-lock.yaml` is stale.
- Workflow regeneration command is exactly:
  `corepack pnpm import`

This is the current blocker before trusting clean-checkout build/test results.

## CURRENT TASK — start here

Do **not** perform another full architecture audit.

1. Regenerate `pnpm-lock.yaml` exactly as `corepack pnpm import` would generate it from the committed `package-lock.json`.
2. Commit the lockfile change to `work/qwen-web-dod`.
3. Let PR #2 CI rerun on the new head.
4. Read the next concrete failing job, if any.
5. Fix one failure at a time and update this file after each completed stage.

Because the chat environment may not be able to clone/run the repository locally, prefer an exact CI-derived/generated lockfile over hand-written dependency entries.

## Definition of Done remaining

The branch is not finished until all of the following are true:

- clean checkout dependency install succeeds
- lockfile freshness succeeds
- project build succeeds
- project typecheck succeeds
- relevant unit/integration tests succeed
- full CI has no Qwen Web regressions
- `qwen --help` does not start a browser
- `/auth` can select Qwen Web without API key
- first real request opens visible browser only when login is needed
- after login browser returns to background/headless mode
- subsequent launches reuse persistent login when still valid
- requested model is selected/verified before conversation traffic
- normal text request works
- real host tool request is recovered by Qwen Code and executed by Qwen Code, not browser provider
- tool result is returned to Qwen Web and the model continues
- multiple sequential tool calls work
- subagents use separate web conversations/pages
- Ctrl+C/Abort stops generation promptly and produces `AbortError`
- browser crash/page loss causes canonical replay rather than stale continuation
- normal process shutdown leaves no orphan Chromium process
- unsupported media and embeddings show explicit diagnostics
- no auth secrets appear in logs/config metadata

## Working protocol for future chats

When continuing in a new ChatGPT project chat, say:

> Continue `go-0dboy/qwen-code-web`. Use branch `work/qwen-web-dod` and draft PR #2. Read `QWEN_WEB_DOD_STATUS.md` first and continue from `CURRENT TASK`. Do not repeat the full audit of completed items.

After every completed stage:

1. commit the code/test/fix;
2. update this status file with the new head/result/current task;
3. provide the user a short continuation handoff containing:
   - completed stage;
   - commit SHA;
   - CI/test result;
   - current blocker;
   - exact next step.

This status file is authoritative for project continuation. If it disagrees with an older chat message, verify the branch/PR and update this file.
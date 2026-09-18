# Qwen Web DoD Status

This file is the durable continuation point for the `qwen-code-web` work. Read it before re-auditing the project or starting a new implementation pass.

## Repository state

- Repository: `go-0dboy/qwen-code-web`
- Working branch: `work/qwen-web-dod`
- Draft PR: `#2` — `Qwen Web browser provider: DoD hardening`
- Base branch: `main`
- Last completed product/lockfile head: `45ed5b07d14b11c0f664237a1dca9e366900fa94`
- Lockfile repair commit message: `chore: refresh pnpm lockfile`
- Do not merge PR #2 until normal CI/build/typecheck/tests and the real-browser acceptance pass are complete.

## Product goal

Run the normal Qwen Code agent without an LLM API by using an authenticated `chat.qwen.ai` browser session as the model transport. Qwen Code remains the only agent core; the browser layer is transport only.

## Non-negotiable architecture

- Qwen Code owns the agent loop, files, shell, Git, MCP, skills, permissions, history, compaction and subagents.
- Browser provider never executes host tools itself.
- No hidden/private Qwen APIs, auth-token extraction, cookie extraction, browser extensions, or native Qwen Web tools for host actions.
- Browser page runtime is a self-contained serializable function.
- One process-wide Chromium/browser service; separate pages/conversations per Qwen Code channel.
- Channels: `<sessionId>:main` or `<sessionId>:<subagentInvocationId>`.
- Browser starts lazily; `qwen --help` and selecting auth must not start Chromium.
- Persistent profile is below `QWEN_HOME/qwen-web/` with restricted permissions.
- Default model: `qwen3.8-max`.
- v1 is text-only. Unsupported media and embeddings fail explicitly.
- AbortSignal cancellation is out-of-band, ignores partial response, and returns `AbortError`.
- Qwen Code history is authoritative; browser history is only a cache.
- Browser/page epoch changes cause reset + canonical replay.

## Implemented

### Auth/model

- `AuthType.QWEN_WEB = "qwen-web"` in core and SDK types.
- CLI auth type parity includes Qwen Web.
- Default model `qwen3.8-max`.
- `/auth` includes `Qwen Web — Use browser session, no API key`.
- Credentialless auth stores auth type + model without API key/base URL/provider credentials.
- `QWEN_DEFAULT_AUTH_TYPE=qwen-web` is accepted.

### Browser transport

- `puppeteer-core` runtime dependency.
- Installed Yandex Browser / Chrome / Chromium detection plus `QWEN_WEB_BROWSER_PATH` override.
- Browser metadata stores executable path only.
- Restricted profile/config permissions under `QWEN_HOME/qwen-web/`.
- Process-wide browser singleton and independent per-channel queues.
- Browser/page epochs tracked.
- Login flow: headless probe -> temporary visible browser if login is required -> close -> headless relaunch.
- Login UX messages explain temporary visible browser and successful return to background mode.
- Auth/navigation failures close temporary browser.
- No custom SIGINT/SIGTERM handlers; shutdown has normal lifecycle fallback.

### Conversation/tool protocol

- Canonical history fingerprint per browser channel.
- Delta on normal continuation; reset/replay on first request, session/model/system/transport/history mismatch.
- Browser assistant echo is not duplicated into delta.
- Tool manifest comes from `request.config.tools`.
- Prompt tells Qwen Web it is inside Qwen Code and must not use native web tools.
- Host tool request format uses Qwen XML `<invoke ...><parameter ...>...</parameter></invoke>`.
- Existing Qwen Code XML fallback converts browser text to real `FunctionCall` parts.
- Host tool result is serialized back as deterministic escaped `QWEN CODE HOST TOOL RESULT` text.
- Sequential mocked integration covers tool call -> FunctionResponse -> second tool call -> FunctionResponse -> final model text.

### Errors/cancellation

- Unsupported media fails explicitly.
- Embeddings fail explicitly.
- Requested model is normalized/verified; real mismatch is diagnostic.
- Native Qwen Web tool UI causes diagnostic error.
- AbortSignal reaches browser transport and Stop is invoked out-of-band.

## Tests already added

Core tests cover browser config/profile permissions, executable override, browser singleton, AbortSignal cancellation, independent channel queues, main/subagent channels, media/embedding rejection, history delta/replay, prompt serialization, tool protocol escaping, Qwen XML recovery, multiple sequential tool calls, page-runtime XML completion after Stop disappears, and model selection normalization/mismatch.

CLI tests cover credentialless Qwen Web auth persistence, `QWEN_DEFAULT_AUTH_TYPE=qwen-web`, and the `/auth` Qwen Web option/active selection.

## Completed stage: lockfile repair

The first PR CI failure was `pnpm Lock Freshness`: committed `pnpm-lock.yaml` lacked the new `puppeteer-core` tree.

Resolution completed:

1. GitHub Actions regenerated the lockfile with the repository's exact command: `corepack pnpm import`.
2. The generated lockfile was exported and verified to include `puppeteer-core` version `25.11.0`.
3. GitHub Actions committed the exact generated lockfile as `45ed5b07d14b11c0f664237a1dca9e366900fa94`.
4. In that repair run, the `Compare with the committed lockfile` step succeeded.
5. The temporary repair/upload/push logic was removed; `.github/workflows/pnpm-lock-freshness.yml` is back to its normal `contents: read` form.

Therefore the old lockfile failure is CLOSED and must not be re-investigated unless a later clean CI proves otherwise.

## CURRENT TASK — start here

Do **not** repeat the architecture audit and do **not** redo the lockfile repair.

1. Treat the status-file commit following `45ed5b07...` as the trigger for normal PR CI.
2. Inspect normal PR #2 workflows on that new head.
3. Confirm `pnpm Lock Freshness` still passes with no temporary workflow modifications.
4. Read the first concrete failing build/typecheck/test job, if any.
5. Fix exactly one failure class at a time.
6. After each completed stage, update this file before moving to the next stage.

## Definition of Done remaining

- clean checkout dependency install succeeds
- normal lockfile freshness succeeds
- project build succeeds
- project typecheck succeeds
- relevant unit/integration tests succeed
- full CI has no Qwen Web regressions
- `qwen --help` does not start a browser
- `/auth` selects Qwen Web without API key
- first real request opens visible browser only when login is needed
- login returns browser to background/headless mode
- subsequent launches reuse persistent login while valid
- requested model is selected/verified before conversation traffic
- normal text request works
- real host tool request is recovered/executed by Qwen Code, not browser provider
- tool result returns to Qwen Web and model continues
- multiple sequential tool calls work
- subagents use separate web conversations/pages
- Ctrl+C/Abort stops promptly with `AbortError`
- browser crash/page loss causes canonical replay
- normal process shutdown leaves no orphan Chromium process
- unsupported media/embeddings show explicit diagnostics
- no auth secrets appear in logs/config metadata

## Continuation protocol

In a new ChatGPT project chat, say:

> Continue `go-0dboy/qwen-code-web`. Use branch `work/qwen-web-dod` and draft PR #2. Read `QWEN_WEB_DOD_STATUS.md` first and continue from `CURRENT TASK`. Do not repeat completed audit or lockfile work.

After every completed stage:

1. commit the fix/test;
2. update this status file;
3. tell the user: completed stage, commit SHA, CI/test result, current blocker, exact next step.

This file is authoritative for continuation. If an older chat disagrees, verify branch/PR and update this file rather than restarting the whole audit.
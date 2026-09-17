/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  QwenWebPageBridge,
  QwenWebPreparedPrompt,
  QwenWebRuntimeStatus,
} from './types.js';

export interface QwenWebPageRuntimeOptions {
  loginStabilityMs?: number;
  loginDetectionTimeoutMs?: number;
}

/**
 * Installs the complete Qwen Web DOM adapter in the page. The function is
 * deliberately self-contained: Puppeteer serializes it with Function#toString
 * for evaluateOnNewDocument/evaluate, so it must not close over Node values.
 */
export function installQwenWebPageRuntime(
  options: QwenWebPageRuntimeOptions = {},
): void {
  type BridgeWindow = Window & { __qwenCodeWebBridge?: QwenWebPageBridge };
  const bridgeWindow = window as BridgeWindow;
  if (bridgeWindow.__qwenCodeWebBridge) return;

  const loginStabilityMs = Math.max(0, options.loginStabilityMs ?? 3_000);
  const loginDetectionTimeoutMs = Math.max(
    loginStabilityMs,
    options.loginDetectionTimeoutMs ?? 8_000,
  );
  let inferredAuthenticated = false;

  const inputSelectors = [
    'textarea.message-input-textarea',
    'textarea[placeholder="How can I help you today?"]',
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ];
  const sendSelectors = [
    'button.send-button',
    '.chat-prompt-send-button button',
    'div.message-input-right-button-send button',
    'button[aria-label*="Send" i]',
    'button[title*="Send" i]',
  ];
  const stopSelectors = [
    'button.stop-button',
    'button[aria-label*="Stop" i]',
    'button[title*="Stop" i]',
  ];
  const responseSelectors = [
    'div.response-message-content.phase-answer',
    'div.response-message-content',
    'div.chat-response-message',
    'div[id^="chat-response-message-"]',
  ];

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const isVisible = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  const findVisible = (selectors: readonly string[]): HTMLElement | undefined => {
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        if (isVisible(match)) return match;
      }
    }
    return undefined;
  };

  const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
  const normalizeModel = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const modelMatches = (candidate: string | undefined, requested: string) => {
    if (!candidate) return false;
    const candidateNormalized = normalizeModel(candidate);
    const requestedNormalized = normalizeModel(requested);
    return (
      candidateNormalized === requestedNormalized ||
      candidateNormalized.startsWith(requestedNormalized)
    );
  };

  const inputElement = (): HTMLElement | undefined => findVisible(inputSelectors);

  const activeStopButton = (): HTMLButtonElement | undefined => {
    const candidate = findVisible(stopSelectors);
    if (!(candidate instanceof HTMLButtonElement)) return undefined;
    return candidate.disabled ? undefined : candidate;
  };

  const responseElements = (): HTMLElement[] => {
    for (const selector of responseSelectors) {
      const values = Array.from(document.querySelectorAll(selector)).filter(
        isVisible,
      ) as HTMLElement[];
      if (values.length > 0) return values;
    }
    return [];
  };

  const cleanResponseText = (element: HTMLElement): string => {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const removable of Array.from(
      clone.querySelectorAll(
        'button,svg,[aria-hidden="true"],[data-line-number],[aria-label*="copy" i],[class*="copy" i],[class*="line-number" i],[class*="lineNumber" i]',
      ),
    )) {
      removable.remove();
    }
    return (clone.innerText || clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .trim();
  };

  const currentResponse = (): { count: number; text: string } => {
    const elements = responseElements();
    const latest = elements.at(-1);
    return {
      count: elements.length,
      text: latest ? cleanResponseText(latest) : '',
    };
  };

  const visibleLoginControl = (): boolean => {
    const direct = findVisible([
      'a[href*="login" i]',
      'a[href*="signin" i]',
      'button[data-testid*="login" i]',
      'button[data-testid*="signin" i]',
    ]);
    if (direct) return true;
    const exact = /^(log in|sign in|sign up|войти|регистрация|登录|注册)$/i;
    return Array.from(document.querySelectorAll('button,a')).some((element) => {
      if (!isVisible(element)) return false;
      return exact.test(normalizeText(element.textContent ?? ''));
    });
  };

  const detectLoggedIn = (): boolean | undefined => {
    if (/\/(?:login|signin|auth)(?:\/|$)/i.test(window.location.pathname)) {
      return false;
    }
    if (visibleLoginControl()) return false;
    const account = findVisible([
      '[class*="avatar" i]',
      'img[alt*="avatar" i]',
      '[aria-label*="profile" i]',
      '[aria-label*="account" i]',
      '[data-testid*="profile" i]',
    ]);
    if (account) return true;
    if (inferredAuthenticated && inputElement()) return true;
    return undefined;
  };

  const waitForLoginState = async (): Promise<boolean> => {
    const startedAt = Date.now();
    const deadline = startedAt + loginDetectionTimeoutMs;
    let state = detectLoggedIn();
    while (state === undefined && Date.now() < deadline) {
      if (
        inputElement() &&
        !visibleLoginControl() &&
        Date.now() - startedAt >= loginStabilityMs
      ) {
        inferredAuthenticated = true;
        return true;
      }
      await sleep(250);
      state = detectLoggedIn();
    }
    return state ?? false;
  };

  const comparisonVisible = (): boolean => {
    if (
      findVisible([
        '[class*="comparison" i]',
        '[data-testid*="comparison" i]',
        '[class*="compare" i][class*="response" i]',
      ])
    ) {
      return true;
    }
    const text = normalizeText(document.body?.innerText ?? '').slice(-12_000);
    return (
      /Which response do you prefer\?.*Choose one.*continue/i.test(text) ||
      /Какой ответ вы предпочитаете\?.*Выберите один.*продолж/i.test(text) ||
      /请选择.*(?:回答|回复).*(?:继续|提交)/i.test(text)
    );
  };

  const resolveComparison = (): boolean => {
    if (!comparisonVisible()) return false;
    const controls = Array.from(
      document.querySelectorAll('button,[role="button"],label'),
    ).filter(isVisible) as HTMLElement[];
    const skipPattern =
      /^(skip|пропустить|не могу выбрать|оба одинаковы|none|не выбирать)$/i;
    const choicePattern =
      /^(?:Response|Answer|Option|Ответ|Вариант)\s*[12]$/i;
    const candidates = controls.filter((element) =>
      choicePattern.test(normalizeText(element.textContent ?? '')),
    );
    const choice =
      controls.find((element) =>
        skipPattern.test(normalizeText(element.textContent ?? '')),
      ) ??
      candidates[1] ??
      candidates[0];
    if (!(choice instanceof HTMLElement)) return false;
    choice.focus();
    choice.click();
    return true;
  };

  const nativeToolVisible = (): boolean => {
    const latest = responseElements().at(-1);
    if (!latest) return false;
    return Array.from(
      latest.querySelectorAll(
        '[data-testid*="web-search" i],[data-testid*="tool-call" i],[class*="web-search" i],[class*="tool-call" i],[class*="toolCall"]',
      ),
    ).some(isVisible);
  };

  const providerError = (): string | undefined => {
    const bodyText = normalizeText(document.body?.innerText ?? '').slice(-9_000);
    const nativeTool = bodyText.match(
      /Tool\s+([A-Za-z0-9_.-]+)\s+does not exists?\./i,
    );
    if (nativeTool) return `Qwen native-tool collision: ${nativeTool[1]}`;
    if (/Oops! There was an issue connecting to Qwen3[.\s-]*8-Max/i.test(bodyText)) {
      return 'Qwen3.8-Max connection error';
    }
    if (/An unexpected error occurred\. Please try again later/i.test(bodyText)) {
      return 'Qwen unexpected connection error';
    }
    if (/The request is ended!?/i.test(bodyText) && /The chat is in progress!?/i.test(bodyText)) {
      return 'Qwen request/chat state conflict';
    }
    if (/The request is ended!?/i.test(bodyText)) {
      return 'Qwen request ended unexpectedly';
    }
    if (/The chat is in progress!?/i.test(bodyText)) {
      return 'Qwen chat is stuck in progress';
    }

    const alert = findVisible([
      '[role="alert"]',
      '[class*="error-message" i]',
      '[class*="request-error" i]',
    ]);
    const alertText = normalizeText(alert?.textContent ?? '');
    return alertText || undefined;
  };

  const retryControl = (): HTMLButtonElement | undefined => {
    const pattern =
      /(retry|regenerate|generate again|try again|refresh|redo|重新生成|重试|повтор(?:ить)?|сгенерировать заново)/i;
    return Array.from(
      document.querySelectorAll('button,[role="button"]'),
    ).find(
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement &&
        !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true' &&
        isVisible(element) &&
        pattern.test(normalizeText(element.textContent ?? '')),
    );
  };

  const readCurrentModel = (): string | undefined => {
    const candidates = Array.from(
      document.querySelectorAll('button,[role="button"]'),
    );
    const current = candidates.find((element) => {
      if (!isVisible(element)) return false;
      const text = normalizeText(element.textContent ?? '');
      return /qwen\s*3[.\s-]*8/i.test(text) && /max/i.test(text);
    });
    return current ? normalizeText(current.textContent ?? '') : undefined;
  };

  const setInputText = (element: HTMLElement, text: string): void => {
    if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.focus();
      return;
    }

    element.focus();
    element.textContent = text;
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text,
      }),
    );
  };

  const inputText = (element: HTMLElement): string => {
    if (element instanceof HTMLTextAreaElement) return element.value;
    return element.textContent ?? '';
  };

  const waitUntilIdle = async (timeoutMs = 30_000): Promise<void> => {
    const started = Date.now();
    while (activeStopButton()) {
      if (Date.now() - started > timeoutMs) {
        throw new Error('Qwen Web is still generating a previous response.');
      }
      await sleep(250);
    }
  };

  const promptAccepted = (
    input: HTMLElement,
    baseline: { count: number; text: string },
  ): boolean => {
    const response = currentResponse();
    return (
      inputText(input).trim().length === 0 ||
      Boolean(activeStopButton()) ||
      response.count > baseline.count ||
      response.text !== baseline.text
    );
  };

  const getStatus = async (): Promise<QwenWebRuntimeStatus> => {
    const response = currentResponse();
    return {
      loggedIn: await waitForLoginState(),
      generating: Boolean(activeStopButton()),
      model: readCurrentModel(),
      responseCount: response.count,
      responseText: response.text,
      comparisonVisible: comparisonVisible(),
      providerError: providerError(),
      nativeToolVisible: nativeToolVisible(),
    };
  };

  const selectModel = async (requestedModel: string): Promise<string> => {
    const existing = readCurrentModel();
    if (modelMatches(existing, requestedModel)) return existing!;

    const trigger = Array.from(
      document.querySelectorAll('button,[role="button"]'),
    )
      .filter(isVisible)
      .filter((element) =>
        /qwen|model/i.test(normalizeText(element.textContent ?? '')),
      )
      .sort(
        (a, b) =>
          normalizeText(a.textContent ?? '').length -
          normalizeText(b.textContent ?? '').length,
      )[0];
    if (trigger instanceof HTMLElement) trigger.click();
    await sleep(500);

    const choices = Array.from(
      document.querySelectorAll(
        'button,[role="option"],[role="menuitem"],[role="button"]',
      ),
    )
      .filter(isVisible)
      .filter((element) =>
        modelMatches(normalizeText(element.textContent ?? ''), requestedModel),
      )
      .sort(
        (a, b) =>
          normalizeText(a.textContent ?? '').length -
          normalizeText(b.textContent ?? '').length,
      );
    const choice = choices[0];
    if (!(choice instanceof HTMLElement)) {
      throw new Error(
        `Requested Qwen Web model '${requestedModel}' is not available in the model selector.`,
      );
    }
    choice.click();
    await sleep(500);

    const selected = readCurrentModel();
    if (!modelMatches(selected, requestedModel)) {
      throw new Error(
        `Qwen Web did not confirm model '${requestedModel}' after selection. Current model: '${selected ?? 'unknown'}'.`,
      );
    }
    return selected!;
  };

  const preparePrompt = async (
    prompt: string,
  ): Promise<QwenWebPreparedPrompt> => {
    await waitUntilIdle();
    if (resolveComparison()) await sleep(250);

    const input = inputElement();
    if (!input) {
      throw new Error(
        'Qwen Web prompt input was not found. The page may require login or its DOM changed.',
      );
    }
    const existing = inputText(input).trim();
    if (existing && existing !== prompt.trim()) {
      throw new Error(
        'Qwen Web prompt input already contains different text; refusing to overwrite possible user input.',
      );
    }

    const baseline = currentResponse();
    setInputText(input, prompt);
    await sleep(50);

    const send = findVisible(sendSelectors);
    if (send instanceof HTMLButtonElement && !send.disabled) send.click();
    else if (send instanceof HTMLElement) send.click();

    const acceptedDeadline = Date.now() + 3_000;
    while (Date.now() < acceptedDeadline) {
      if (promptAccepted(input, baseline)) {
        return {
          baselineCount: baseline.count,
          baselineText: baseline.text,
          accepted: true,
        };
      }
      await sleep(100);
    }

    return {
      baselineCount: baseline.count,
      baselineText: baseline.text,
      accepted: false,
    };
  };

  const waitForResponse = async (
    prepared: QwenWebPreparedPrompt,
  ): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const started = Date.now();
      let latestText = '';
      let stableSince = Date.now();
      let retryCount = 0;
      let settled = false;

      const cleanup = () => {
        observer.disconnect();
        window.clearInterval(timer);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const inspect = () => {
        if (settled) return;
        if (Date.now() - started > 10 * 60_000) {
          finish(() =>
            reject(new Error('Timed out waiting for Qwen Web response.')),
          );
          return;
        }

        if (resolveComparison()) return;

        const error = providerError();
        if (error) {
          const retry = retryCount < 2 ? retryControl() : undefined;
          if (retry) {
            retryCount += 1;
            retry.click();
            stableSince = Date.now();
            return;
          }
          finish(() => reject(new Error(`Qwen Web provider error: ${error}`)));
          return;
        }

        const response = currentResponse();
        const advanced =
          response.count > prepared.baselineCount ||
          Boolean(response.text && response.text !== prepared.baselineText);
        if (!advanced) return;

        if (nativeToolVisible()) {
          finish(() =>
            reject(
              new Error(
                'Qwen Web attempted to use a native web tool. Native Qwen Web tools are disabled for the Qwen Code browser provider; host tools must be requested with <invoke>.',
              ),
            ),
          );
          return;
        }

        if (response.text !== latestText) {
          latestText = response.text;
          stableSince = Date.now();
        }

        if (activeStopButton()) return;
        if (!latestText) return;

        const stableFor = Date.now() - stableSince;
        const hasClosedInvoke = /<invoke\b[^>]*>[\s\S]*?<\/invoke>/i.test(
          latestText,
        );
        const requiredStableMs = hasClosedInvoke ? 500 : 1_500;
        if (stableFor >= requiredStableMs) {
          finish(() => resolve(latestText));
        }
      };

      const observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
      const timer = window.setInterval(inspect, 200);
      inspect();
    });

  const stopGeneration = async (): Promise<void> => {
    const stop = activeStopButton();
    if (stop) stop.click();
    const deadline = Date.now() + 10_000;
    while (activeStopButton()) {
      if (Date.now() > deadline) {
        throw new Error('Qwen Web did not stop generation after cancellation.');
      }
      await sleep(100);
    }
  };

  bridgeWindow.__qwenCodeWebBridge = {
    getStatus,
    selectModel,
    preparePrompt,
    waitForResponse,
    stopGeneration,
  };
}

import { describe, expect, it } from 'vitest';
import { ConversationSynchronizer } from './conversationSynchronizer.js';

const user = (text: string) => ({ role: 'user', parts: [{ text }] });
const model = (text: string) => ({ role: 'model', parts: [{ text }] });

function input(
  contents: readonly unknown[],
  overrides: Record<string, string> = {},
) {
  return {
    channel: overrides['channel'] ?? 'session:main',
    sessionId: overrides['sessionId'] ?? 'session',
    model: overrides['model'] ?? 'qwen3.8-max',
    systemSignature: overrides['systemSignature'] ?? 'system-a',
    transportEpoch: overrides['transportEpoch'] ?? '1:1',
    contents,
  };
}

describe('ConversationSynchronizer', () => {
  it('sends only the new user delta after the browser-produced model echo', () => {
    const synchronizer = new ConversationSynchronizer();
    const first = input([user('one')]);

    expect(synchronizer.plan(first)).toMatchObject({
      reset: true,
      reason: 'first-request',
    });
    synchronizer.commit(first);

    expect(
      synchronizer.plan(input([user('one'), model('answer'), user('two')])),
    ).toEqual({
      reset: false,
      replay: [],
      delta: [user('two')],
    });
  });

  it('replays canonical history after transport epoch changes or history mismatch', () => {
    const synchronizer = new ConversationSynchronizer();
    const first = input([user('one')]);
    synchronizer.commit(first);

    expect(
      synchronizer.plan(input([user('one')], { transportEpoch: '2:1' })),
    ).toMatchObject({ reset: true, reason: 'transport-changed' });

    expect(synchronizer.plan(input([user('edited')]))).toMatchObject({
      reset: true,
      reason: 'history-mismatch',
    });
  });
});

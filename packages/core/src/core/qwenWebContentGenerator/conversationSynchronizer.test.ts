import { describe, expect, it } from 'vitest';
import { ConversationSynchronizer } from './conversationSynchronizer.js';

const user = (text: string) => ({ role: 'user', parts: [{ text }] });
const model = (text: string) => ({ role: 'model', parts: [{ text }] });
const toolResult = (name: string, output: string) => ({
  role: 'user',
  parts: [{ functionResponse: { name, response: { output } } }],
});

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

  it('sends FunctionResponse content without echoing the browser tool-call text', () => {
    const synchronizer = new ConversationSynchronizer();
    const first = input([user('inspect file')]);
    synchronizer.commit(first);

    const firstResult = toolResult('read_file', 'file contents');
    const afterFirstTool = input([
      user('inspect file'),
      model('<invoke name="read_file">...</invoke>'),
      firstResult,
    ]);
    expect(synchronizer.plan(afterFirstTool)).toEqual({
      reset: false,
      replay: [],
      delta: [firstResult],
    });
    synchronizer.commit(afterFirstTool);

    const secondResult = toolResult('grep', 'match');
    expect(
      synchronizer.plan(
        input([
          user('inspect file'),
          model('<invoke name="read_file">...</invoke>'),
          firstResult,
          model('<invoke name="grep">...</invoke>'),
          secondResult,
        ]),
      ),
    ).toEqual({
      reset: false,
      replay: [],
      delta: [secondResult],
    });
  });

  it.each([
    ['session-changed', { sessionId: 'other-session' }],
    ['model-changed', { model: 'other-model' }],
    ['system-changed', { systemSignature: 'system-b' }],
    ['transport-changed', { transportEpoch: '2:1' }],
  ] as const)('replays after %s', (reason, overrides) => {
    const synchronizer = new ConversationSynchronizer();
    const first = input([user('one')]);
    synchronizer.commit(first);

    expect(synchronizer.plan(input([user('one')], overrides))).toMatchObject({
      reset: true,
      reason,
    });
  });

  it('replays after compaction/truncation or any canonical prefix rewrite', () => {
    const synchronizer = new ConversationSynchronizer();
    synchronizer.commit(
      input([user('one'), model('answer'), user('two')]),
    );

    expect(synchronizer.plan(input([user('summary')]))).toMatchObject({
      reset: true,
      reason: 'history-mismatch',
    });
    expect(
      synchronizer.plan(
        input([user('one'), model('edited answer'), user('two')]),
      ),
    ).toMatchObject({ reset: true, reason: 'history-mismatch' });
  });

  it('treats an explicitly invalidated channel as a fresh transport cache', () => {
    const synchronizer = new ConversationSynchronizer();
    const first = input([user('one')]);
    synchronizer.commit(first);
    synchronizer.reset('session:main');

    expect(synchronizer.plan(first)).toMatchObject({
      reset: true,
      reason: 'first-request',
    });
  });

  it('keeps channel histories isolated', () => {
    const synchronizer = new ConversationSynchronizer();
    synchronizer.commit(input([user('main')], { channel: 'session:main' }));

    expect(
      synchronizer.plan(
        input([user('subagent')], { channel: 'session:subagent-1' }),
      ),
    ).toMatchObject({ reset: true, reason: 'first-request' });
  });
});

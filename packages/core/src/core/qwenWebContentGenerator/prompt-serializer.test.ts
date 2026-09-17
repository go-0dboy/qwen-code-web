import { describe, expect, it } from 'vitest';
import {
  buildQwenWebReplayPrompt,
  serializeQwenWebContent,
} from './prompt-serializer.js';

describe('Qwen Web prompt serializer', () => {
  it('includes the host protocol, system instruction, and canonical user turn', () => {
    const prompt = buildQwenWebReplayPrompt(
      [{ role: 'user', parts: [{ text: 'inspect' }] }],
      { systemInstruction: 'Be precise', tools: [] },
    );

    expect(prompt).toContain('QWEN CODE HOST PROTOCOL');
    expect(prompt).toContain('Be precise');
    expect(prompt).toContain('USER\ninspect');
  });

  it('rejects unsupported media instead of silently dropping it', () => {
    expect(() =>
      serializeQwenWebContent({
        role: 'user',
        parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }],
      }),
    ).toThrow(/text-only transport/);
  });
});

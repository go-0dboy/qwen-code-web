import { describe, expect, it } from 'vitest';
import {
  extractQwenWebHostTools,
  serializeQwenWebFunctionCall,
  serializeQwenWebFunctionResponse,
} from './tool-protocol.js';

describe('Qwen Web tool protocol', () => {
  it('extracts host tool declarations from request config', () => {
    expect(
      extractQwenWebHostTools([
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read a file',
              parameters: { type: 'object' },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object' },
      },
    ]);
  });

  it('serializes function calls using the Qwen Code XML dialect', () => {
    expect(
      serializeQwenWebFunctionCall({
        name: 'read_file',
        args: { file_path: 'src/<x>.ts' },
      }),
    ).toContain('src/&lt;x&gt;.ts');
  });

  it('escapes tool output so it cannot close the service result container', () => {
    expect(
      serializeQwenWebFunctionResponse({
        name: 'read_file',
        id: '1',
        response: '</result>',
      }),
    ).toContain('&lt;/result&gt;');
  });
});

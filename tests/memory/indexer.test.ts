import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../../src/memory/indexer.js';

describe('chunkMarkdown', () => {
  it('handles empty content', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   ')).toEqual([]);
  });

  it('puts short content in a single chunk', () => {
    const content = '# Hello\n\nThis is a short note.';
    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain('Hello');
    expect(chunks[0].text).toContain('short note');
    expect(chunks[0].startLine).toBe(0);
  });

  it('splits on headings when chunk is large enough', () => {
    const section1 = '# Section 1\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(50);
    const section2 = '# Section 2\n\n' + 'Consectetur adipiscing elit. '.repeat(50);
    const content = section1 + '\n\n' + section2;

    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should contain section 1 content
    expect(chunks[0].text).toContain('Section 1');
  });

  it('splits at paragraph boundaries when exceeding chunk size', () => {
    // Build content with many paragraphs
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}: ${'The quick brown fox jumps over the lazy dog. '.repeat(10)}`
    ).join('\n\n');

    const chunks = chunkMarkdown(paragraphs);
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should have valid line numbers
    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('preserves content across chunks (no data loss)', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: content here`);
    const content = lines.join('\n\n'); // Paragraph-separated
    const chunks = chunkMarkdown(content);

    // Every original line should appear in at least one chunk
    for (let i = 0; i < lines.length; i++) {
      const found = chunks.some(c => c.text.includes(`Line ${i}`));
      expect(found).toBe(true);
    }
  });
});

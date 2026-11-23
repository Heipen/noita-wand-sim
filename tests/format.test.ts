import { describe, expect, it } from 'vitest';
import { formatLifetime } from '../src/lib/format';

describe('lifetime formatting', () => {
  it('shows seconds and exact frames', () => {
    expect(formatLifetime(-61)).toBe('-1.02s(-61f)');
    expect(formatLifetime(280, { signed: true })).toBe('+4.67s(+280f)');
    expect(formatLifetime(0)).toBe('0s(0f)');
  });
});

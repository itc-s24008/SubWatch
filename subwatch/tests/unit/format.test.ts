import { describe, expect, it } from 'vitest';
import { formatMonthDay, formatTimeJST, formatUnreadBadge, formatYen } from '@/lib/format';

describe('lib/format', () => {
  it('formatYen', () => {
    expect(formatYen(1590)).toBe('¥1,590');
    expect(formatYen(0)).toBe('¥0');
    expect(formatYen('1590')).toBe('―');
  });
  it('formatMonthDay', () => {
    expect(formatMonthDay('2026-11-05')).toBe('11/05');
    expect(formatMonthDay('2026/11/05')).toBe('―');
  });
  it('formatTimeJST', () => {
    expect(formatTimeJST('2026-11-04T00:05:00.000Z')).toBe('09:05');
    expect(formatTimeJST('2026-11-04T15:00:00.000Z')).toBe('00:00');
    expect(formatTimeJST('x')).toBe('―');
  });
  it('formatUnreadBadge', () => {
    expect(formatUnreadBadge(1)).toBe('1');
    expect(formatUnreadBadge(99)).toBe('99');
    expect(formatUnreadBadge(100)).toBe('99+');
    expect(formatUnreadBadge(-1)).toBe('―');
  });
});

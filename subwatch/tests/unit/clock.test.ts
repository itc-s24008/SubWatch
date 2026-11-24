import { describe, expect, it } from 'vitest';
import { todayJST } from '@/lib/clock';

describe('todayJST（日本時間の今日）', () => {
  it('UTC 15:00 は日本時間の次の日の 0:00', () => {
    expect(todayJST(new Date('2026-11-03T15:00:00.000Z'))).toBe('2026-11-04');
  });
  it('UTC 14:59:59 は日本時間の同じ日の 23:59:59', () => {
    expect(todayJST(new Date('2026-11-03T14:59:59.999Z'))).toBe('2026-11-03');
  });
  it('年をまたぐ', () => {
    expect(todayJST(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01');
  });
  it('YYYY-MM-DD の形', () => {
    expect(todayJST()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

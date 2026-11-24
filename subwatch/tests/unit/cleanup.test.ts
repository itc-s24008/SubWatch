// cleanup の繰り返しの判定（04-14。lib/cron.ts の runCleanupLoop）。削除そのものは tests/emulator/cron.test.ts（No.56）で確かめる
// 期待値は機能設計書 詳細_F-06 の手順10（500件ずつ、500件に達したら続ける、1回の実行で最大10回、各回の前に締切を確かめる）
import { describe, expect, it } from 'vitest';
import { CRON_LIMITS, runCleanupLoop } from '@/lib/cron';

// counts を順に返す偽の削除（呼ばれた回数と、渡された上限を記録する）
function fakeDelete(counts: number[]) {
  const limits: number[] = [];
  const fn = async (limit: number) => {
    limits.push(limit);
    return counts[limits.length - 1] ?? 0;
  };
  return { fn, limits };
}

describe('runCleanupLoop（No.56 の繰り返しの判定）', () => {
  it('既定は1回500件・最大10回', () => {
    expect(CRON_LIMITS.cleanupBatchSize).toBe(500);
    expect(CRON_LIMITS.cleanupMaxRounds).toBe(10);
  });

  it('500件に届かなければ1回で終わる', async () => {
    const del = fakeDelete([120]);
    const result = await runCleanupLoop(del.fn, () => false);
    expect(result).toEqual({ deleted: 120, rounds: 1, stoppedByDeadline: false, error: null });
    expect(del.limits).toEqual([500]);
  });

  it('500件に達したら続きがあるとみなして繰り返し、500件より少ない回で終わる', async () => {
    const del = fakeDelete([500, 500, 3]);
    const result = await runCleanupLoop(del.fn, () => false);
    expect(result).toMatchObject({ deleted: 1003, rounds: 3, stoppedByDeadline: false });
  });

  it('ちょうど500件の次の回が0件なら、そこで終わる', async () => {
    const del = fakeDelete([500, 0]);
    expect(await runCleanupLoop(del.fn, () => false)).toMatchObject({ deleted: 500, rounds: 2 });
  });

  it('1回の実行で最大10回（5,000件）まで。11回目は行わない', async () => {
    const del = fakeDelete(Array(20).fill(500));
    const result = await runCleanupLoop(del.fn, () => false);
    expect(result).toMatchObject({ deleted: 5000, rounds: 10, stoppedByDeadline: false });
    expect(del.limits).toHaveLength(10);
  });

  it('始める時点で締切を過ぎていたら、1回も削除しない', async () => {
    const del = fakeDelete([500]);
    const result = await runCleanupLoop(del.fn, () => true);
    expect(result).toEqual({ deleted: 0, rounds: 0, stoppedByDeadline: true, error: null });
    expect(del.limits).toEqual([]);
  });

  it('各回の前に締切を確かめ、途中で過ぎたらそこで止める', async () => {
    const del = fakeDelete(Array(10).fill(500));
    let checks = 0;
    const result = await runCleanupLoop(del.fn, () => {
      checks += 1;
      return checks > 3; // 4回目の前に締切
    });
    expect(result).toMatchObject({ deleted: 1500, rounds: 3, stoppedByDeadline: true });
  });

  it('削除に失敗したら、例外にせず、それまでの件数とエラーを返して止める', async () => {
    const error = new Error('boom');
    let calls = 0;
    const result = await runCleanupLoop(async () => {
      calls += 1;
      if (calls === 2) throw error;
      return 500;
    }, () => false);
    expect(result).toEqual({ deleted: 500, rounds: 1, stoppedByDeadline: false, error });
  });

  it('上限と回数は引数で変えられる（Emulator のテスト用）', async () => {
    const del = fakeDelete([2, 2, 2, 1]);
    const result = await runCleanupLoop(del.fn, () => false, { batchSize: 2, maxRounds: 3 });
    expect(result).toMatchObject({ deleted: 6, rounds: 3 });
    expect(del.limits).toEqual([2, 2, 2]);
  });
});

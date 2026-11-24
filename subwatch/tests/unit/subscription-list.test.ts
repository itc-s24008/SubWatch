// S-04 の検索・カテゴリーの絞り込み・並べ替え（lib/subscription-list.ts）の単体テスト（04-20）
// テスト一覧 No.58（Want。成功基準①の判定から除く）。期待値は機能設計書 詳細_F-10・テスト一覧 No.58、画面設計書 S-04 とサンプルデータ
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_FILTERS,
  SORT_OPTIONS,
  filterSubscriptions,
  matchesSearch,
  sortSubscriptions,
  viewSubscriptions,
} from '@/lib/subscription-list';

// テストデータ5件（機能設計書「テストデータ」。基準日 2026-11-04。API の並び＝作成日時の昇順＝表の行の順）
// カテゴリーは画面設計書「サンプルデータ」の表示名から
const TEST_DATA = [
  { serviceName: 'Netflix', price: 1590, category: 'video', nextBillingDate: '2026-11-08', createdAt: '2026-11-04T00:00:00.000Z' },
  { serviceName: 'Spotify', price: 980, category: 'music', nextBillingDate: '2026-11-05', createdAt: '2026-11-04T00:00:00.001Z' },
  { serviceName: 'Adobe Creative Cloud', price: 6480, category: 'cloud', nextBillingDate: '2026-11-11', createdAt: '2026-11-04T00:00:00.002Z' },
  { serviceName: 'iCloud+', price: 12000, category: 'cloud', nextBillingDate: '2026-12-01', createdAt: '2026-11-04T00:00:00.003Z' },
  { serviceName: 'ChatGPT', price: 3000, category: 'ai', nextBillingDate: '2026-11-30', createdAt: '2026-11-04T00:00:00.004Z' },
] as const;

const names = (items: readonly { serviceName: unknown }[]) => items.map((item) => item.serviceName);

describe('No.58 検索（サービス名の部分一致。前後の空白・大文字小文字を無視）', () => {
  it('No.58 部分一致：「cloud」で Adobe Creative Cloud と iCloud+', () => {
    expect(names(filterSubscriptions(TEST_DATA, { query: 'cloud' }))).toEqual(['Adobe Creative Cloud', 'iCloud+']);
  });

  it('No.58 大文字小文字を区別しない：「NETFLIX」「netflix」「NetFlix」で Netflix', () => {
    for (const query of ['NETFLIX', 'netflix', 'NetFlix']) {
      expect(names(filterSubscriptions(TEST_DATA, { query }))).toEqual(['Netflix']);
    }
  });

  it('No.58 前後の空白（全角を含む）を除く：「　 spot 　」で Spotify', () => {
    expect(names(filterSubscriptions(TEST_DATA, { query: '　 spot 　' }))).toEqual(['Spotify']);
    expect(names(filterSubscriptions(TEST_DATA, { query: '　Netflix　' }))).toEqual(['Netflix']);
  });

  it('No.58 全角と半角をそろえる（決まりの一覧 C-17）：「ｎｅｔｆｌｉｘ」「ＮＥＴＦＬＩＸ」でも Netflix', () => {
    expect(names(filterSubscriptions(TEST_DATA, { query: 'ｎｅｔｆｌｉｘ' }))).toEqual(['Netflix']);
    expect(names(filterSubscriptions(TEST_DATA, { query: 'ＮＥＴＦＬＩＸ' }))).toEqual(['Netflix']);
    expect(matchesSearch('ＮＥＴＦＬＩＸ', 'net')).toBe(true); // 全角で登録した名前も、半角で探せる
    expect(matchesSearch('ＮＥＴＦＬＩＸ', 'ｎｅｔ')).toBe(true);
    expect(matchesSearch('ﾈｯﾄﾌﾘｯｸｽ', 'ネット')).toBe(true); // 半角カナも全角カナと同じ
  });

  it('No.58 検索語の途中の空白はそのまま比べる（「Adobe Creative」は合い、「Adobe  Creative」「AdobeCreative」は合わない）', () => {
    expect(names(filterSubscriptions(TEST_DATA, { query: 'adobe creative' }))).toEqual(['Adobe Creative Cloud']);
    expect(filterSubscriptions(TEST_DATA, { query: 'Adobe  Creative' })).toEqual([]);
    expect(filterSubscriptions(TEST_DATA, { query: 'AdobeCreative' })).toEqual([]);
  });

  it('No.58 空・空白だけ（全角を含む）の検索語は、絞り込まない（5件のまま）', () => {
    for (const query of ['', ' ', '　', ' 　 ']) {
      expect(filterSubscriptions(TEST_DATA, { query })).toHaveLength(5);
    }
  });

  it('No.58 合うものが無ければ0件（「Hulu」）', () => {
    expect(viewSubscriptions(TEST_DATA, { query: 'Hulu' })).toEqual([]);
  });

  it('サービス名の前後の空白も除いて比べる（保存値に空白が残っていても合う）', () => {
    expect(matchesSearch('  Netflix ', 'netflix')).toBe(true);
  });
});

describe('No.58 カテゴリーの絞り込み', () => {
  it('No.58 「クラウド」で Adobe Creative Cloud と iCloud+、「音楽」で Spotify、「すべて」で5件', () => {
    expect(names(filterSubscriptions(TEST_DATA, { category: 'cloud' }))).toEqual(['Adobe Creative Cloud', 'iCloud+']);
    expect(names(filterSubscriptions(TEST_DATA, { category: 'music' }))).toEqual(['Spotify']);
    expect(filterSubscriptions(TEST_DATA, { category: 'all' })).toHaveLength(5);
  });

  it('No.58 そのカテゴリーが無ければ0件（「ゲーム」）', () => {
    expect(filterSubscriptions(TEST_DATA, { category: 'game' })).toEqual([]);
  });

  it('No.58 検索語とカテゴリーの両方に合うものだけ（「cloud」＋「AI」は0件、「cloud」＋「クラウド」は2件）', () => {
    expect(filterSubscriptions(TEST_DATA, { query: 'cloud', category: 'ai' })).toEqual([]);
    expect(names(filterSubscriptions(TEST_DATA, { query: 'cloud', category: 'cloud' }))).toEqual(['Adobe Creative Cloud', 'iCloud+']);
  });

  it('タブはすべて／動画／音楽／クラウド／学習／AI／ゲーム／ニュース／仕事／その他の順', () => {
    expect(CATEGORY_FILTERS.map((option) => option.label)).toEqual(['すべて', '動画', '音楽', 'クラウド', '学習', 'AI', 'ゲーム', 'ニュース', '仕事', 'その他']);
  });
});

describe('No.58 並べ替え3種', () => {
  it('選択肢は 次回請求日が近い順（既定）／料金の高い順／登録日の新しい順', () => {
    expect(SORT_OPTIONS.map((option) => option.label)).toEqual(['次回請求日が近い順', '料金の高い順', '登録日の新しい順']);
  });

  it('No.58 次回請求日が近い順：Spotify → Netflix → Adobe Creative Cloud → ChatGPT → iCloud+（画面設計書 サンプルデータ A19）', () => {
    expect(names(sortSubscriptions(TEST_DATA, 'nextBillingDate'))).toEqual(['Spotify', 'Netflix', 'Adobe Creative Cloud', 'ChatGPT', 'iCloud+']);
    expect(names(viewSubscriptions(TEST_DATA, {}))).toEqual(['Spotify', 'Netflix', 'Adobe Creative Cloud', 'ChatGPT', 'iCloud+']); // 既定
  });

  it('No.58 料金の高い順（1回の請求額）：iCloud+ → Adobe Creative Cloud → ChatGPT → Netflix → Spotify', () => {
    expect(names(sortSubscriptions(TEST_DATA, 'priceDesc'))).toEqual(['iCloud+', 'Adobe Creative Cloud', 'ChatGPT', 'Netflix', 'Spotify']);
  });

  it('No.58 登録日の新しい順：ChatGPT → iCloud+ → Adobe Creative Cloud → Spotify → Netflix', () => {
    expect(names(sortSubscriptions(TEST_DATA, 'createdAtDesc'))).toEqual(['ChatGPT', 'iCloud+', 'Adobe Creative Cloud', 'Spotify', 'Netflix']);
  });

  it('No.58 絞り込んだ結果を並べ替える（「クラウド」＋料金の高い順：iCloud+ → Adobe Creative Cloud）', () => {
    expect(names(viewSubscriptions(TEST_DATA, { category: 'cloud', sort: 'priceDesc' }))).toEqual(['iCloud+', 'Adobe Creative Cloud']);
  });

  it('料金が同じときは API の並び（作成日時の昇順）のまま', () => {
    const items = [
      { id: 'a', serviceName: 'A', price: 1000, category: 'other', nextBillingDate: '2026-11-10', createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'b', serviceName: 'B', price: 2000, category: 'other', nextBillingDate: '2026-11-10', createdAt: '2026-11-01T00:00:00.001Z' },
      { id: 'c', serviceName: 'C', price: 1000, category: 'other', nextBillingDate: '2026-11-10', createdAt: '2026-11-01T00:00:00.002Z' },
    ];
    expect(sortSubscriptions(items, 'priceDesc').map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('登録日は日時（ミリ秒まで）で比べる。同じ日の中でも新しいほうが先。同じ時刻は API の並びのまま', () => {
    const items = [
      { id: 'a', serviceName: 'A', price: 1, category: 'other', nextBillingDate: '2026-11-10', createdAt: '2026-11-04T09:00:00.000Z' },
      { id: 'b', serviceName: 'B', price: 1, category: 'other', nextBillingDate: '2026-11-10', createdAt: '2026-11-04T09:00:00.001Z' },
      { id: 'c', serviceName: 'C', price: 1, category: 'other', nextBillingDate: '2026-11-10', createdAt: '2026-11-04T09:00:00.001Z' },
      { id: 'd', serviceName: 'D', price: 1, category: 'other', nextBillingDate: '2026-11-10', createdAt: '2026-11-04T23:59:59.999Z' },
    ];
    expect(sortSubscriptions(items, 'createdAtDesc').map((i) => i.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('値が読めないものは最後（その中は API の並び）。元の配列は変えない', () => {
    const items = [
      { id: 'a', serviceName: 'A', price: null, category: 'other', nextBillingDate: 'broken', createdAt: 'broken' },
      { id: 'b', serviceName: 'B', price: 500, category: 'other', nextBillingDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z' },
      { id: 'c', serviceName: 'C', price: 'x', category: 'other', nextBillingDate: null, createdAt: null },
      { id: 'd', serviceName: 'D', price: 900, category: 'other', nextBillingDate: '2026-11-10', createdAt: '2026-11-02T00:00:00.000Z' },
    ];
    expect(sortSubscriptions(items, 'priceDesc').map((i) => i.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(sortSubscriptions(items, 'createdAtDesc').map((i) => i.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(sortSubscriptions(items, 'nextBillingDate').map((i) => i.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

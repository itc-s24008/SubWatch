'use client';
// S-09 のスイッチ（③ NotificationSection・④ PushSection）で使う。開いたときの読み込みが済んでから、2回描画した後に true になる。
// false の間は、スイッチを滑らせない・色を薄くしない（読み込みの結果で位置や濃さが変わると、勝手に切り替わったように見えるため）。
// true になった後は、押したときの動きが戻る
import { useEffect, useState } from 'react';

export function useSettled(ready: boolean): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ready || settled) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [ready, settled]);
  return settled;
}

// 読み込みの間に Card に付ける class：滑らせない（settled まで）・色を薄くしない（ready まで。押せないのはそのまま）
export function settlingClass(ready: boolean, settled: boolean): string {
  return [ready ? '' : '[&_button]:!opacity-100', settled ? '' : '[&_*]:!transition-none'].filter(Boolean).join(' ');
}

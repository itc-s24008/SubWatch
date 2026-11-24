'use client';
// S-09 の部品：③通知（通知履歴とPushをまとめて有効・無効）（04-21）
// 画面設計書 S-09 ③・状態・ダイアログ一覧の S-09 の行（51行）、詳細_F-12 の手順5、API共通仕様 B108、決まりの一覧 C-3
//   開いたとき：GET /api/account を自分で1回読み、accountNotificationEnabled を出す。読めるまでは、Gates がログインのときに読んだ値
//     （useAccountGate().account）を出して押せないようにする。読めなかったとき（404・503・通信の失敗など）は文を出さず、
//     Gates の値のまま押せるようにする。ゲートのエラー（isGateError）のときは何もしない（ゲートが画面を切り替える）
//   押したとき：すぐにスイッチを切り替え、PATCH /api/account を送る（通信の間は押せない）。成功したら応答の値を出す
//     （読み直さない。画面全体を「読み込み中」に戻さない）。失敗したらスイッチを元へ戻す。isGateError のときは文を出さない。
//     それ以外の失敗（オフライン・503 を含む）は、共通の文ではなく「変更できませんでした。もう一度お試しください」を③のすぐ下に出す
import { useEffect, useRef, useState } from 'react';
import { useAccountGate } from '@/components/AuthProvider';
import { Card, Switch } from '@/components/ui';
import { api, isGateError } from '@/lib/api-client';
import type { AccountDto, UpdateAccountBody, UpdateAccountResult } from '@/lib/types';

const CHANGE_FAILED = '変更できませんでした。もう一度お試しください';

export function NotificationSection() {
  const { account } = useAccountGate();
  const [enabled, setEnabled] = useState<boolean>(account ? account.accountNotificationEnabled !== false : true);
  const [loaded, setLoaded] = useState(false); // 開いたときの GET /api/account が終わったか（読めなかったときも true）
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api<AccountDto>('/api/account')
      .then((data) => {
        if (!mounted.current) return;
        setEnabled(data.accountNotificationEnabled !== false);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (isGateError(error)) return; // ゲートが画面を切り替える。押せないまま
        if (mounted.current) setLoaded(true); // 文を出さず、ログインのときに読んだ値のまま押せるようにする
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleChange(next: boolean) {
    if (!loaded || saving) return;
    const previous = enabled;
    setEnabled(next); // 押したらすぐ切り替える
    setSaving(true);
    setMessage(null);
    try {
      const body: UpdateAccountBody = { accountNotificationEnabled: next };
      const result = await api<UpdateAccountResult>('/api/account', { method: 'PATCH', body });
      if (mounted.current) setEnabled(result.accountNotificationEnabled);
    } catch (error) {
      if (!mounted.current) return;
      setEnabled(previous); // 失敗したら元へ戻す（ゲートのエラーでも戻す）
      if (isGateError(error)) return; // 文を出さない（ゲートが画面を切り替える）
      setMessage(CHANGE_FAILED);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Card>
      <Switch
        id="notification-switch"
        checked={enabled}
        onChange={(next) => void handleChange(next)}
        label="通知"
        description="通知履歴とPushをまとめて有効・無効"
        disabled={!loaded || saving}
      />
      {message && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {message}
        </p>
      )}
    </Card>
  );
}

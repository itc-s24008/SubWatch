'use client';
// S-09 の部品：④この端末でPushを受け取る・⑤この端末のPush状態・⑥通知タイミング（NotificationTiming）・⑦PWAの利用案内（04-12）
// 画面設計書 S-09 ④〜⑦、状態・ダイアログ一覧の S-09 の行、詳細_F-12 の手順6、API共通仕様 B95、決まりの一覧 C-3・C-14
//   開いたとき：対応・許可・ブラウザの購読をブラウザで判定する。購読があれば GET /api/account を読み、
//     サーバーにこの端末の ID が無ければブラウザの購読を解除して「オフ」（確かめる間は「確認中…」。読めなければブラウザの判定のまま）
//   ④の失敗はスイッチを元へ戻す。isGateError のときは文を出さない。それ以外はオン「登録できませんでした…」、オフ「解除できませんでした…」
//   （オフライン・503 でも共通の文ではなく④の文）。④の文は④のすぐ下に出すが、同じ文が⑤に出ているときは出さない
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NotificationTiming } from '@/components/settings/NotificationTiming';
import { settlingClass, useSettled } from '@/components/settings/useSettled';
import { Card, Switch } from '@/components/ui';
import { isGateError } from '@/lib/api-client';
import {
  PUSH_MESSAGES,
  checkThisDevice,
  detectPushSupport,
  disablePush,
  enablePush,
  notificationPermission,
  type PushSupport,
} from '@/lib/push-client';

type Subscribed = boolean | null; // null は確かめている途中（「確認中…」）

// ⑤の状態と案内（画面設計書 S-09 ⑤）
export function pushStatusTexts(support: PushSupport | null, permission: NotificationPermission, subscribed: Subscribed): { status: string; guides: string[] } {
  if (support === 'needsHomeScreen') {
    return { status: PUSH_MESSAGES.unsupported, guides: [PUSH_MESSAGES.needsHomeScreen, PUSH_MESSAGES.historyAvailable] };
  }
  if (support === 'unsupported') {
    // 状態と案内が同じ文になるので、案内に同じ文を重ねない
    return { status: PUSH_MESSAGES.unsupported, guides: [PUSH_MESSAGES.historyAvailable] };
  }
  if (permission === 'denied') {
    return { status: PUSH_MESSAGES.denied, guides: [PUSH_MESSAGES.allowInSettings, PUSH_MESSAGES.historyAvailable] };
  }
  if (support === null || subscribed === null) return { status: PUSH_MESSAGES.checking, guides: [] };
  return { status: subscribed ? PUSH_MESSAGES.on : PUSH_MESSAGES.off, guides: [] };
}

// この端末で前回確かめた④の結果（表示のためだけの目安。保存するのは true / false だけ）。
// 開いたときの確認（確認中…）の間は、この値の位置でスイッチを出しておき、確認の結果が違ったときだけ動かさずに置き換える
const PUSH_SWITCH_HINT_KEY = 'subwatch.pushSwitchHint';

function readSwitchHint(): boolean | null {
  try {
    const value = window.localStorage.getItem(PUSH_SWITCH_HINT_KEY);
    return value === 'true' ? true : value === 'false' ? false : null;
  } catch {
    return null; // 使えないブラウザ（プライベートモードなど）は目安なし
  }
}

function writeSwitchHint(value: boolean): void {
  try {
    window.localStorage.setItem(PUSH_SWITCH_HINT_KEY, String(value));
  } catch {
    // 保存できなくても動きは変わらない（次に開いたときに確認の間だけ隠れる）
  }
}

export function PushSection() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState<Subscribed>(null);
  const [hint, setHint] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  // 対応・許可・前回の結果の判定は、最初の描画の前に行う（useLayoutEffect）。画面を移って開いたときに、
  // 「確認中…」や空のスイッチが1コマ見えないようにするため（読み込み直したときは、サーバーの HTML の間だけ見えない）
  useLayoutEffect(() => {
    mounted.current = true;
    const detected = detectPushSupport();
    setSupport(detected);
    if (detected !== 'supported') {
      setSubscribed(false);
      return () => {
        mounted.current = false;
      };
    }
    const permissionNow = notificationPermission();
    const savedHint = readSwitchHint();
    setHint(savedHint === true && permissionNow !== 'granted' ? null : savedHint); // 許可が外れていたら「オン」の目安は使わない
    setPermission(permissionNow);
    void checkThisDevice().then((value) => {
      if (mounted.current) setSubscribed(value);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  async function turnOn() {
    if (support === 'needsHomeScreen') {
      setMessage(PUSH_MESSAGES.needsHomeScreen);
      return;
    }
    if (support !== 'supported') {
      setMessage(PUSH_MESSAGES.unsupported);
      return;
    }
    setBusy(true); // 処理中は押せない。表示は、成功してから「オン」にする（フロー図 F-12「成功 → オンに更新」）
    try {
      const result = await enablePush();
      if (!mounted.current) return;
      if (result.status === 'permission') {
        setPermission(result.permission);
        setSubscribed(false);
        setMessage(PUSH_MESSAGES.allowInSettings);
        return;
      }
      setPermission('granted');
      setSubscribed(true);
    } catch (error) {
      if (!mounted.current) return;
      setSubscribed(false);
      if (isGateError(error)) return; // ゲートが画面を切り替える。文を出さない
      setMessage(PUSH_MESSAGES.registerFailed);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true); // 表示は、サーバーとブラウザの解除が済んでから「オフ」にする
    try {
      await disablePush();
      if (mounted.current) setSubscribed(false);
    } catch (error) {
      if (!mounted.current) return;
      setSubscribed(true); // ブラウザの購読を残して、オンのまま
      if (isGateError(error)) return;
      setMessage(PUSH_MESSAGES.unregisterFailed);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function handleChange(next: boolean) {
    if (busy) return;
    setMessage(null);
    void (next ? turnOn() : turnOff());
  }

  // 開いたときの判定（確認中…）の間は、前回の結果（hint）の位置でスイッチを出し、⑤も前回の結果の文にする。
  // 前回の結果が無ければ、スイッチと⑤の「確認中…」を見せない（確かめ終わったら、結果の位置と文で出す）。
  // 確認中は押せないが、色は薄くしない。判定が済んだら、動かさずにその位置にする。その次の描画から、押したときの動きを戻す
  const checking = support === null || (support === 'supported' && subscribed === null);
  const showHint = checking && hint !== null;
  const settled = useSettled(!checking);
  useEffect(() => {
    if (subscribed !== null && support === 'supported') writeSwitchHint(subscribed);
  }, [subscribed, support]);

  const shownSubscribed = showHint ? hint : subscribed;
  const texts = pushStatusTexts(support, permission, shownSubscribed);
  const shownOnStatus = [texts.status, ...texts.guides];
  const switchMessage = message && !shownOnStatus.includes(message) ? message : null;

  return (
    <>
      <Card
        className={`${checking && !showHint ? '[&_button]:invisible' : ''} ${settlingClass(!checking, settled)}`}
      >
        <Switch
          id="push-switch"
          checked={shownSubscribed === true}
          onChange={handleChange}
          label="この端末でPushを受け取る"
          description="ブラウザの許可が必要です"
          disabled={busy || support === null || (support === 'supported' && subscribed === null)}
        />
        {switchMessage && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {switchMessage}
          </p>
        )}
      </Card>
      <Card>
        <h3 className="font-bold">この端末のPush状態</h3>
        <p className={`mt-1 text-sm text-gray-600 ${texts.status === PUSH_MESSAGES.checking ? 'invisible' : ''}`} data-testid="push-status">
          {texts.status}
        </p>
        {texts.guides.map((guide) => (
          <p key={guide} className="mt-1 text-sm text-gray-600">
            {guide}
          </p>
        ))}
      </Card>
      <NotificationTiming />
      <div className="rounded-2xl bg-brand-light p-4">
        <h3 className="font-bold text-brand">ホーム画面に追加（PWA）</h3>
        <p className="mt-1 text-sm">iPhone：Safariの共有メニュー →「ホーム画面に追加」</p>
        <p className="text-sm">Android：対応ブラウザからインストール</p>
        <p className="mt-1 text-xs text-gray-600">ホーム画面に追加していないiPhoneではPushが届かないため、アプリを開いて通知履歴を確認してください</p>
        <p className="mt-1 text-xs text-gray-600">ホーム画面に追加したアプリは Safari とログインの状態を共有しないため、追加した後にもう一度ログインしてください</p>
      </div>
    </>
  );
}

// Web Push（ブラウザ）。04-12：S-09 ④⑤の判定と操作、ログアウト・後始末での購読の解除
// 機能設計書 詳細_F-12 の手順6、API共通仕様 B34・B95・B105、DB設計書 3.補足設計 B16、決まりの一覧 C-3・C-7・C-14
//
//   detectPushSupport()：'supported'／'needsHomeScreen'（iPhone・iPad でホーム画面に追加していない）／'unsupported'
//   getBrowserSubscription()：この端末（ブラウザ）の購読。無ければ null（Service Worker を登録していなければ null。登録はしない）
//   webPushIdOf(endpoint)：endpoint の sha256 の16進64文字（サーバーの webPushId と同じ値）
//   serverCheckOf(webPushId, account)：GET /api/account の値から⑤を決める（'registered'／'missing'／'unknown'）
//   checkThisDevice()：⑤の確認。ブラウザに購読があれば GET /api/account を読み、サーバーに無ければブラウザの購読を解除して false
//   enablePush()・disablePush()：④のオン・オフ
//   unsubscribeBrowserPush()：サーバーを呼ばずにブラウザの購読だけを解除する（失敗しても例外を投げない）
//   logoutPushCleanup()：ログアウトの前の処理（registerBeforeLogout に登録する）
// このファイルを import すると、registerBeforeLogout と registerLocalCleanup に登録する（AuthProvider が import する）
import { api } from '@/lib/api-client';
import { registerBeforeLogout, registerLocalCleanup } from '@/lib/logout';
import type { AccountDto, PushSubscribeRequest, PushSubscribeResult, PushUnsubscribeRequest } from '@/lib/types';

// 画面の文（画面設計書 S-09 ④⑤、状態・ダイアログ一覧の S-09 の行）
export const PUSH_MESSAGES = {
  checking: '確認中…',
  on: 'この端末で受け取る：オン',
  off: 'この端末で受け取る：オフ',
  unsupported: 'この環境では利用できません',
  denied: '許可されていません',
  needsHomeScreen: 'ホーム画面に追加すると利用できます',
  allowInSettings: 'ブラウザの設定で通知を許可してください',
  historyAvailable: '通知センターの通知履歴は使えます。',
  registerFailed: '登録できませんでした。もう一度お試しください',
  unregisterFailed: '解除できませんでした。もう一度お試しください',
} as const;

export const SW_READY_TIMEOUT_MS = 10_000; // Service Worker が動き出すのを待つのは10秒まで（決まりの一覧 C-14）
export const LOGOUT_DELETE_WAIT_MS = 2_500; // ログアウトで DELETE の応答を待つのは2.5秒まで（決まりの一覧 C-7）
export const USER_AGENT_MAX_LENGTH = 512; // サーバーは512文字を超えると 400

export type PushSupport = 'supported' | 'needsHomeScreen' | 'unsupported';

// 端末の対応（API共通仕様 B95）：Service Worker・PushManager・Notification がそろっていれば対応。
// どれかが無く、iPhone・iPad（iPadOS の Safari は Mac と名乗るので、タッチの点の数で見分ける）で、ホーム画面から開いていなければ needsHomeScreen
export function detectPushSupport(): PushSupport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  const hasAll = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (hasAll) return 'supported';
  const ua = navigator.userAgent ?? '';
  const isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
  if (!isIos) return 'unsupported';
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return standalone ? 'unsupported' : 'needsHomeScreen';
}

// 通知の許可（'default'・'granted'・'denied'）。Notification が無ければ 'default'
export function notificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'default';
  return window.Notification.permission;
}

// endpoint の sha256（小文字16進64文字）。サーバーの webPushId と同じ
export async function webPushIdOf(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// この端末の購読（無ければ null。例外を投げない）。Service Worker の登録はしない（オンにしたときだけ登録する）
export async function getBrowserSubscription(): Promise<PushSubscription | null> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration || !registration.pushManager) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// ブラウザの購読だけを解除する（サーバーは呼ばない。購読が無い・失敗しても例外を投げない）
// 401 のサインアウトの前（04-05）と、アカウント削除の後（04-17）に runLocalCleanup() から呼ばれる
export async function unsubscribeBrowserPush(): Promise<void> {
  try {
    const subscription = await getBrowserSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    // 失敗しても続ける
  }
}

// 登録で送る本文：必要な項目（endpoint・keys.p256dh・keys.auth）だけを選び、userAgent は512文字までに切る
// （toJSON() には expirationTime が付くので、そのまま送ると未知のキーで 400 になる）
export function subscribeRequestBody(subscription: PushSubscription, userAgent: string | null | undefined): PushSubscribeRequest {
  const json = subscription.toJSON();
  const ua = typeof userAgent === 'string' && userAgent !== '' ? Array.from(userAgent).slice(0, USER_AGENT_MAX_LENGTH).join('') : null;
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    userAgent: ua,
  };
}

export type ServerCheck = 'registered' | 'missing' | 'unknown';

// ⑤の判定（API共通仕様 B95）：pushSubscriptionIds にこの端末の ID があれば 'registered'、無ければ 'missing'。
// 応答が無い・pushSubscriptionIds が配列でないときは 'unknown'（読めなかったのと同じ。ブラウザの判定のまま）
export function serverCheckOf(webPushId: string, account: Partial<AccountDto> | null | undefined): ServerCheck {
  if (!account || !Array.isArray(account.pushSubscriptionIds)) return 'unknown';
  return account.pushSubscriptionIds.includes(webPushId) ? 'registered' : 'missing';
}

// ⑤の確認：ブラウザに購読が無ければ false（GET /api/account は読まない）。あれば GET /api/account を読み、
// サーバーに無ければブラウザの購読を解除して false（解除に失敗しても false）。読めなかったときはブラウザの判定のまま true
export async function checkThisDevice(): Promise<boolean> {
  const subscription = await getBrowserSubscription();
  if (!subscription) return false;
  let account: AccountDto | null;
  try {
    account = await api<AccountDto>('/api/account');
  } catch {
    return true; // 読めなかった（404・503・ゲートのエラーを含む）。ゲートのエラーの画面の切り替えはゲートが行う
  }
  const check = serverCheckOf(await webPushIdOf(subscription.endpoint), account);
  if (check !== 'missing') return true;
  try {
    await subscription.unsubscribe();
  } catch {
    // 解除に失敗しても「オフ」と表示する（オンにし直すと登録し直される）
  }
  return false;
}

// VAPID の公開鍵（base64url）を、pushManager.subscribe の applicationServerKey の形にする
export function applicationServerKeyOf(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sleep(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), ms));
}

// Service Worker を登録し、動き出すのを待つ（10秒まで。過ぎたら例外）
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const started = navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready);
  const result = await Promise.race([started, sleep(SW_READY_TIMEOUT_MS)]);
  if (result === 'timeout') throw new Error('SW_READY_TIMEOUT');
  return result;
}

// 購読を作る。作れないとき、ブラウザに古い購読が残っていれば、解除して1回だけ作り直す（API共通仕様 B95）
async function createSubscription(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
  if (!key) throw new Error('VAPID_PUBLIC_KEY_MISSING');
  const options: PushSubscriptionOptionsInit = { userVisibleOnly: true, applicationServerKey: applicationServerKeyOf(key) };
  try {
    return await registration.pushManager.subscribe(options);
  } catch (error) {
    const old = await registration.pushManager.getSubscription().catch(() => null);
    if (!old) throw error;
    await old.unsubscribe().catch(() => false);
    return registration.pushManager.subscribe(options);
  }
}

export type EnablePushResult = { status: 'enabled' } | { status: 'permission'; permission: NotificationPermission };

// ④をオンにする（詳細_F-12 の手順6-2〜6-5）。対応の確認は画面が先に行う。
//   許可が得られなければ { status: 'permission' }（拒否は 'denied'、ダイアログを閉じただけは 'default'）
//   Service Worker・購読の失敗は例外。POST /api/push/subscribe の失敗は、ブラウザの購読を解除してから、api() のエラーをそのまま投げる
//   （画面は isGateError なら文を出さず、それ以外は「登録できませんでした…」）
export async function enablePush(): Promise<EnablePushResult> {
  let permission: NotificationPermission = notificationPermission();
  if (permission !== 'granted') permission = await window.Notification.requestPermission();
  if (permission !== 'granted') return { status: 'permission', permission };

  const registration = await readyRegistration();
  const subscription = await createSubscription(registration);
  try {
    await api<PushSubscribeResult>('/api/push/subscribe', {
      method: 'POST',
      body: subscribeRequestBody(subscription, navigator.userAgent),
    });
  } catch (error) {
    await subscription.unsubscribe().catch(() => false);
    throw error;
  }
  return { status: 'enabled' };
}

// ④をオフにする（詳細_F-12 の手順6-6）：先に DELETE /api/push/subscribe を呼び、成功してからブラウザの購読を解除する。
// サーバーが失敗したら、ブラウザの購読を残して api() のエラーを投げる（画面はオンのまま）。ブラウザに購読が無ければ何もしない
export async function disablePush(): Promise<void> {
  const subscription = await getBrowserSubscription();
  if (!subscription) return;
  const body: PushUnsubscribeRequest = { endpoint: subscription.endpoint };
  await api<void>('/api/push/subscribe', { method: 'DELETE', body });
  try {
    await subscription.unsubscribe();
  } catch {
    // サーバーの登録は消えているので、オフとして扱う（ブラウザに残った購読は、次に開いたとき⑤の確認で解除される）
  }
}

// ログアウトの前の処理（DB設計書 3.補足設計 B16、決まりの一覧 C-7）：
//   ブラウザに購読が無ければ何もしない（DELETE /api/push/subscribe を呼ばない）。
//   あれば DELETE を skipGate で呼び（onApiGate を呼ばせない）、応答を待つのは2.5秒まで（api() の timeoutMs は使わず、待つのをやめるだけ）。
//   その結果（成功・失敗・409・時間切れ）にかかわらず、ブラウザの購読を必ず解除する
export async function logoutPushCleanup(): Promise<void> {
  const subscription = await getBrowserSubscription();
  if (!subscription) return;
  const body: PushUnsubscribeRequest = { endpoint: subscription.endpoint };
  const request = api<void>('/api/push/subscribe', { method: 'DELETE', body, skipGate: true }).catch(() => undefined);
  await Promise.race([request, sleep(LOGOUT_DELETE_WAIT_MS)]);
  try {
    await subscription.unsubscribe();
  } catch {
    // 失敗してもログアウトを続ける
  }
}

registerBeforeLogout(logoutPushCleanup);
registerLocalCleanup(unsubscribeBrowserPush);

// SubWatch の Service Worker（04-12。API共通仕様 B95・B96、詳細_F-12 の手順7）
// S-09 で「この端末でPushを受け取る」をオンにしたときだけ登録する。通信の横取りとオフライン用のキャッシュはしない（fetch を扱わない）。
// pushsubscriptionchange は扱わない（Service Worker は ID token を持たないので、サーバーに登録し直せない。既知の制限）
// 受信（push）の処理は 04-15（このファイルの下）。showNotification の data は { url, notificationId }（タップの処理がこれを読む）

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim()); // 登録より前に開いていたタブも制御する
});

// 開く URL：アプリの中のパス（/ で始まる同じオリジン）なら ?from=push を付けて開く。そうでなければホーム（/）を開く
function pushTargetUrl(raw) {
  const origin = self.location.origin;
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return origin + '/';
  let url;
  try {
    url = new URL(raw, origin);
  } catch (error) {
    return origin + '/';
  }
  if (url.origin !== origin) return origin + '/';
  url.searchParams.set('from', 'push');
  return url.href;
}

// 通知をタップしたとき：開いている画面があれば navigate してから focus。navigate が失敗したとき・画面が無いときは openWindow
async function openFromNotification(data) {
  const target = pushTargetUrl(data && typeof data === 'object' ? data.url : undefined);
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows.find((c) => {
    try {
      return new URL(c.url).origin === self.location.origin;
    } catch (error) {
      return false;
    }
  });
  if (client && typeof client.navigate === 'function') {
    try {
      const moved = await client.navigate(target);
      if (moved) {
        await moved.focus();
        return;
      }
    } catch (error) {
      // 下で新しく開く
    }
  }
  await self.clients.openWindow(target);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openFromNotification(event.notification.data));
});

// ===== 04-15：受信（push イベントで通知を出す）ここに足す =====
// Push の中身（詳細_F-06 の 8-5）：{ title:「サービス名：title」, body, url:「/subscriptions/{subscriptionId}」, notificationId }
// showNotification の data は { url, notificationId }（タップの処理〔上の notificationclick〕が読む。API共通仕様 B96）。
// icon・badge は /icon-192.png、tag は notificationId（同じ通知が2回届いても1つにまとまる）。
// 中身が無い・JSON でない Push は、タイトル「SubWatch」だけの通知を出す（タップするとホームを開く）
function pushNotificationOf(data) {
  let payload = null;
  try {
    payload = data ? data.json() : null;
  } catch (error) {
    payload = null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { title: 'SubWatch', options: { icon: '/icon-192.png', badge: '/icon-192.png' } };
  }
  const title = typeof payload.title === 'string' && payload.title !== '' ? payload.title : 'SubWatch';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url, notificationId: payload.notificationId },
  };
  if (typeof payload.notificationId === 'string' && payload.notificationId !== '') options.tag = payload.notificationId;
  return { title, options };
}

self.addEventListener('push', (event) => {
  const { title, options } = pushNotificationOf(event.data);
  event.waitUntil(self.registration.showNotification(title, options));
});

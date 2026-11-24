// SubWatch の Service Worker（04-12。API共通仕様 B95・B96、詳細_F-12 の手順7）
// S-09 で「この端末でPushを受け取る」をオンにしたときだけ登録する。通信の横取りとオフライン用のキャッシュはしない（fetch を扱わない）。
// pushsubscriptionchange は扱わない（Service Worker は ID token を持たないので、サーバーに登録し直せない。既知の制限）
// 受信（push）の処理は 04-15 が足す。showNotification の data は { url, notificationId }（タップの処理がこれを読む）

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

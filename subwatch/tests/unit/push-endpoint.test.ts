// lib/push.ts の endpoint の検証（04-12。API共通仕様 B23・B91。テスト一覧 No.74 の検証の部分を、細かい場合まで確かめる）
import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint, webPushIdOf } from '@/lib/push';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://push.example.com:8443/a',
  ])('受け付ける：%s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['http', 'http://push.example.com/a'],
    ['IPv4', 'https://192.168.0.1/a'],
    ['IPv4（数字だけのホスト）', 'https://3232235521/a'],
    ['IPv4（16進）', 'https://0x7f.1/a'],
    ['IPv6', 'https://[::1]/a'],
    ['localhost', 'https://localhost/a'],
    ['*.localhost', 'https://app.localhost/a'],
    ['ドットを含まないホスト', 'https://pushserver/a'],
    ['*.local', 'https://printer.local/a'],
    ['*.internal', 'https://metadata.google.internal/a'],
    ['*.intranet', 'https://a.intranet/a'],
    ['*.lan', 'https://a.lan/a'],
    ['*.home', 'https://a.home/a'],
    ['*.corp', 'https://a.corp/a'],
    ['*.localdomain', 'https://a.localdomain/a'],
    ['URL の中の認証情報', 'https://user:pass@push.example.com/a'],
    ['URL でない', 'not a url'],
    ['空文字', ''],
  ])('受け付けない：%s', (_name, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it('UTF-8 で1499バイトまで受け付け、1500バイトは受け付けない', () => {
    const prefix = 'https://push.example.com/';
    expect(isAllowedPushEndpoint(prefix + 'a'.repeat(1499 - prefix.length))).toBe(true);
    expect(isAllowedPushEndpoint(prefix + 'a'.repeat(1500 - prefix.length))).toBe(false);
  });
});

describe('webPushIdOf', () => {
  it('endpoint の SHA-256 の小文字16進64文字', () => {
    // 'abc' の SHA-256（よく知られた値）
    expect(webPushIdOf('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

// S-11 利用規約・S-12 プライバシーポリシーの本文（04-19）。静的な本文で、通信はしない（DB項目なし）
// 本文は図（設計書図 S-11_利用規約・S-12_プライバシーポリシー）のとおり。図に無い1行として、運営者の項目の箇条書きの最後に
// 「公開範囲：…」を両方に入れる（画面設計書 S-11 B7・S-12 B7）。問い合わせ先は運営者名だけ（メールアドレスは書かない。決まりの一覧 D-5）
// 公開日が変わったら、施行日と版（環境変数）も直す（機能設計書 公開前の確認事項 B5）
//
// LegalSection：title（「1. サービスの概要」の形の見出し）、paragraphs?（文。箇条書きの前に出す）、items?（箇条書き）、after?（箇条書きの後の文）
export interface LegalSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
  after?: string[];
}

export interface LegalDocument {
  pageTitle: string; // 画面のタイトル（<h1>）
  documentTitle: string; // 本文の題（<h2>）
  sections: LegalSection[];
  versionEnv: 'terms' | 'privacy'; // 末尾の「版：…」に使う環境変数（NEXT_PUBLIC_TERMS_VERSION／NEXT_PUBLIC_PRIVACY_VERSION）
}

// 見出しの下に出す文（S-11 ③・S-12 ③）
export const LEGAL_DISCLAIMER = 'この文書は卒業制作のために作成したもので、法律の専門家による確認は受けていません';

// 図に無い1行（運営者の項目の箇条書きの最後。両方に入れる）
export const PUBLICATION_SCOPE = '公開範囲：授業関係者とデモのみ。2026年12月24日に公開を停止し、登録データを削除します';

// 問い合わせ先（決まりの一覧 D-5。メールアドレスは書かない）
export const CONTACT = '問い合わせ先：Eチーム（卒業制作のため、個別の連絡窓口は設けていません）';

export const TERMS_DOCUMENT: LegalDocument = {
  pageTitle: '利用規約',
  documentTitle: 'SubWatch 利用規約',
  versionEnv: 'terms',
  sections: [
    {
      title: '1. サービスの概要',
      paragraphs: [
        'SubWatch は、利用者が登録したサブスクリプション（定期課金）の請求予定を一覧・カレンダーで確認し、請求日や最終無料日の前にお知らせするサービスです。表示する金額・日付は利用者が登録した内容からの予測であり、実際の決済額や決済結果ではありません。画面での解約手続きは行いません。',
      ],
    },
    {
      title: '2. 運営者・対象年齢',
      items: [
        '運営者名：Eチーム',
        '主な対象：10代〜30代（年齢による利用制限はありません）',
        '18歳未満の方は、保護者の同意を得てご利用ください',
        PUBLICATION_SCOPE,
      ],
    },
    {
      title: '3. 禁止事項',
      items: [
        '法令または公序良俗に反する行為',
        '他の利用者・第三者の権利や利益を侵害する行為',
        '不正アクセス、サービスの運営を妨げる行為（過度な負荷をかける操作を含む）',
        '他人のアカウントやメールアドレスの無断使用',
        'クレジットカード番号などの機微な情報を入力する行為',
        'その他、運営者が不適切と判断する行為',
      ],
    },
    {
      title: '4. 免責',
      items: [
        '表示する請求予定は登録内容からの予測であり、正確性・完全性を保証しません。',
        '通知はお使いの端末・ブラウザ・通信環境により届かないことがあります。',
        'サービスの停止、変更、データの消失などによって生じた損害について、運営者は責任を負いません（法令で認められる範囲）。',
      ],
    },
    {
      title: '5. 規約の変更',
      paragraphs: [
        '運営者は、必要に応じて本規約を変更できます。変更後に利用者が同意の確認画面で同意するまで、サービスの他の画面は利用できません。',
      ],
    },
    {
      title: '6. 準拠法・施行日',
      items: ['準拠法：日本法', '施行日：2026年12月1日'],
    },
    {
      title: '7. 問い合わせ先',
      paragraphs: [CONTACT],
    },
  ],
};

export const PRIVACY_DOCUMENT: LegalDocument = {
  pageTitle: 'プライバシーポリシー',
  documentTitle: 'SubWatch プライバシーポリシー',
  versionEnv: 'privacy',
  sections: [
    {
      title: '1. 運営者',
      items: [
        '運営者名：Eチーム',
        '主な対象：10代〜30代',
        'データの保存地域：日本（東京。Cloud Firestore）。ログイン情報は Firebase Authentication（Google）が管理します',
        PUBLICATION_SCOPE,
      ],
    },
    {
      title: '2. 取得する情報',
      items: [
        'メールアドレス（ログインと本人確認のため）',
        '利用者が登録したサブスク情報（サービス名、プラン名、料金、請求周期、請求日、カテゴリー、トライアル、URL、支払方法の表示名、メモ、通知の設定）',
        'Push 購読情報（端末の宛先情報と、ブラウザの種類（User-Agent））',
        '同意の記録（同意した日時と、利用規約・プライバシーポリシーの版）',
        '通知履歴（いつ・どのサブスクについて通知したか）',
      ],
    },
    {
      title: '3. 利用目的',
      items: ['ログインと本人確認', '請求予定の表示と、請求日・最終無料日の事前通知', 'サービスの運営・不具合の調査・改善'],
    },
    {
      title: '4. 外部サービスへの提供',
      items: [
        'Firebase（Google）：認証（Authentication）とデータの保存（Firestore）',
        'Vercel：アプリの配信とサーバー処理（毎日の通知判定を含む）',
        'ブラウザの Push サービス（Google・Apple など）：Push 通知の配信。通知は暗号化して送るため、Push サービスは通知の内容（サービス名・請求日・料金）を読めません',
        'favicon.im：サービスアイコンの取得',
      ],
      after: [
        'サービスアイコンの取得のため、入力した公式サイトのドメイン、またはサービス名から辞書で特定したドメインを、入力中や表示のときに外部サービス（favicon.im）に送信します。画像はお使いのブラウザが直接取得します。',
      ],
    },
    {
      title: '5. 保存期間',
      items: ['登録したサブスク・アカウント情報：アカウントを削除するまで', '通知履歴：作成から90日で削除します'],
    },
    {
      title: '6. 削除',
      paragraphs: ['設定画面の［アカウントを削除］で、すべてのデータを削除します。'],
    },
    {
      title: '7. 施行日・変更',
      paragraphs: ['施行日：2026年12月1日。内容を変更したときは、同意の確認画面でお知らせします。'],
    },
    {
      title: '8. 問い合わせ先',
      paragraphs: [CONTACT],
    },
  ],
};

// 末尾の版（「版：2026-12-01」。未設定・空なら「版：―」）
export function versionLabel(versionEnv: LegalDocument['versionEnv']): string {
  const value = versionEnv === 'terms' ? process.env.NEXT_PUBLIC_TERMS_VERSION : process.env.NEXT_PUBLIC_PRIVACY_VERSION;
  return `版：${value ? value : '―'}`;
}

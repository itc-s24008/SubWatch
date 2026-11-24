'use client';
// サービスのアイコン（共通部品）。各画面は、この部品を使う（画面ごとに頭文字の表示を作らない）
// 04-01 の時点では頭文字だけ：サービス名の前後の空白を除いた最初の1文字（英字は大文字）を角丸四角で出す。
// favicon（F-13）は 05-07 が、この部品の中に足す（05-07 だけは中身を変えてよい）
//
// props：
//   serviceName：サービス名
//   websiteUrl?：公式サイトの URL（05-07 がドメインの決定に使う。04-01 の時点では使わない）
//   size?：一辺の px（既定 40）
//   initialOnly?：true なら 05-07 の後も頭文字だけ（S-07・S-08 が付ける）

export interface IconBadgeProps {
  serviceName: string;
  websiteUrl?: string | null;
  size?: number;
  initialOnly?: boolean;
}

export function initialOf(serviceName: string): string {
  const trimmed = serviceName.replace(/^[\s　]+|[\s　]+$/g, '');
  const first = Array.from(trimmed)[0] ?? '';
  return /^[a-z]$/.test(first) ? first.toUpperCase() : first;
}

export function IconBadge({ serviceName, size = 40 }: IconBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-xl bg-brand-light font-bold text-brand"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initialOf(serviceName)}
    </span>
  );
}

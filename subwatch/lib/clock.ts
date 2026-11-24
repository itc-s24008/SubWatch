// 日本時間の「今日」。今日の日付は、全員がこれだけで得る。テストでは引数で now を渡す
export function todayJST(now: Date = new Date()): string {
  // en-CA の書式は YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

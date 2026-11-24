// 請求日・換算の計算と、日付の部品（共通ファイル。04-04 が作る。ブラウザからも使うので firebase を import しない）
// 機能設計書「共通ロジック」のとおり。日付は引数も戻り値も YYYY-MM-DD の文字列で、年・月・日を数値で扱う（Date の補正に頼らない）
//
// 壊れた入力は RangeError を投げる（Cron が受ける。画面は catch して「―」を出す）：
//   壊れた日付（形が YYYY-MM-DD でない・実在しない。2000〜2100 年の範囲は調べない＝呼ぶ側が文字列の比較で調べる）、
//   型に無い周期・方式、負や小数の k、整数でない n、数でない金額
// 日付の部品は、isValidDate のほかは、壊れた日付で RangeError（画面は isValidDate(s) && isEndOfMonth(s) の順で使う）
import type { BillingCycle, BillingDayMode, DateString } from '@/lib/types';

// 周期の月数（毎月1・3か月3・6か月6・毎年12）
const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, semiAnnual: 6, yearly: 12 };
const DAY_MODES: readonly BillingDayMode[] = ['fixedDay', 'endOfMonth'];

interface YMD {
  year: number;
  month: number; // 1〜12
  day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function monthLength(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// 形と実在を調べて、年・月・日にする（合わなければ null）
function parse(s: unknown): YMD | null {
  if (typeof s !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > monthLength(year, month)) return null;
  return { year, month, day };
}

function parseOrThrow(s: unknown, name: string): YMD {
  const ymd = parse(s);
  if (!ymd) throw new RangeError(`${name} が正しい日付（YYYY-MM-DD）ではありません`);
  return ymd;
}

function format({ year, month, day }: YMD): DateString {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 1970-01-01 からの日数（グレゴリオ暦。年・月・日の整数だけで計算する）
function toDayNumber({ year, month, day }: YMD): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(dayNumber: number): YMD {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function cycleMonths(billingCycle: unknown): number {
  if (typeof billingCycle !== 'string' || !Object.prototype.hasOwnProperty.call(CYCLE_MONTHS, billingCycle)) {
    throw new RangeError('請求周期が正しくありません');
  }
  return CYCLE_MONTHS[billingCycle as BillingCycle];
}

function checkDayMode(billingDayMode: unknown): BillingDayMode {
  if (!DAY_MODES.includes(billingDayMode as BillingDayMode)) throw new RangeError('請求日方式が正しくありません');
  return billingDayMode as BillingDayMode;
}

function checkAmount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} が数ではありません`);
  return value;
}

// k 回目の請求日（請求日の年月に k×周期 か月を足した月の日付）を、検査を済ませた値から作る
function billingDateAt(first: YMD, months: number, mode: BillingDayMode, k: number): YMD {
  const index = first.month - 1 + k * months;
  const year = first.year + Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = monthLength(year, month);
  // fixedDay：請求日の「日」。その月に無ければ月末日（前回丸めた日を次の基準にしない）／endOfMonth：その月の末日
  return { year, month, day: mode === 'endOfMonth' ? last : Math.min(first.day, last) };
}

// 日付 target より前になる、いちばん大きい k の目安（そこから数え始めれば、前の請求日を全部数えなくてよい）
// k 回目の月は「請求日の月 + k×周期」なので、target の月より前の月にある k は、どれも target より前
function startIndex(first: YMD, months: number, target: YMD): number {
  const monthDiff = (target.year - first.year) * 12 + (target.month - first.month);
  return Math.max(0, Math.floor(monthDiff / months) - 1);
}

// ---- 請求日 ----

// k 回目（0 始まり）の請求日。0 回目は請求日（firstBillingDate）そのもの
// （endOfMonth で請求日が月末日でないデータ〔API は 400 で拒否するので、通常は無い〕は、0 回目をその月の末日にする）
export function nthBillingDate(firstBillingDate: DateString, billingCycle: BillingCycle, billingDayMode: BillingDayMode, k: number): DateString {
  const first = parseOrThrow(firstBillingDate, 'firstBillingDate');
  const months = cycleMonths(billingCycle);
  const mode = checkDayMode(billingDayMode);
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 0) throw new RangeError('k は 0 以上の整数にしてください');
  return format(billingDateAt(first, months, mode, k));
}

// 次回請求日：今日（日本時間。today）を含む、今日以降で最も早い請求日。請求日が今日以降なら、請求日そのもの（2100年までの遠い未来でも求まる）
export function nextBillingDate(firstBillingDate: DateString, billingCycle: BillingCycle, billingDayMode: BillingDayMode, today: DateString): DateString {
  const first = parseOrThrow(firstBillingDate, 'firstBillingDate');
  const months = cycleMonths(billingCycle);
  const mode = checkDayMode(billingDayMode);
  const now = parseOrThrow(today, 'today');
  const todayString = format(now);
  for (let k = startIndex(first, months, now); ; k += 1) {
    const date = format(billingDateAt(first, months, mode, k));
    if (date >= todayString) return date;
  }
}

// from から to まで（両端を含む）にある請求日を、昇順の配列で返す。from が to より後なら空の配列。請求日より前の請求日は作らない
export function billingDatesInRange(
  firstBillingDate: DateString,
  billingCycle: BillingCycle,
  billingDayMode: BillingDayMode,
  from: DateString,
  to: DateString,
): DateString[] {
  const first = parseOrThrow(firstBillingDate, 'firstBillingDate');
  const months = cycleMonths(billingCycle);
  const mode = checkDayMode(billingDayMode);
  const start = parseOrThrow(from, 'from');
  const end = parseOrThrow(to, 'to');
  const fromString = format(start);
  const toString = format(end);
  if (fromString > toString) return [];
  const result: DateString[] = [];
  for (let k = startIndex(first, months, start); ; k += 1) {
    const date = format(billingDateAt(first, months, mode, k));
    if (date > toString) break;
    if (date >= fromString) result.push(date);
  }
  return result;
}

// ---- 換算 ----

// 1件の年額換算＝price ×（12 ÷ 周期の月数）（毎月12、3か月4、6か月2、毎年1）。数でない金額は RangeError
export function annualAmount(price: number, billingCycle: BillingCycle): number {
  const amount = checkAmount(price, 'price');
  return amount * (12 / cycleMonths(billingCycle));
}

// 月額換算の合計＝Math.floor((A + 6) / 12)。A は年額換算の整数の和（個別に四捨五入した値は足さない）
// 1件分の月額換算は monthlyEquivalentTotal(annualAmount(price, billingCycle))
export function monthlyEquivalentTotal(annualTotal: number): number {
  const total = checkAmount(annualTotal, 'annualTotal');
  return Math.floor((total + 6) / 12);
}

// ---- 日付の部品（全員がこれを使う。自分で作らない） ----

// 形が YYYY-MM-DD で、実在する日付か（2000-01-01〜2100-12-31 の範囲は、呼ぶ側が文字列の比較で調べる）。RangeError を投げない
export function isValidDate(s: unknown): s is DateString {
  return parse(s) !== null;
}

// 月末日か（壊れた日付は RangeError）
export function isEndOfMonth(s: DateString): boolean {
  const ymd = parseOrThrow(s, '日付');
  return ymd.day === monthLength(ymd.year, ymd.month);
}

// s の n 日後（n が負なら前）。n が整数でなければ RangeError
export function addDays(s: DateString, n: number): DateString {
  const ymd = parseOrThrow(s, '日付');
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new RangeError('n は整数にしてください');
  return format(fromDayNumber(toDayNumber(ymd) + n));
}

// a から b までの日数（b が後なら正、前なら負、同じ日なら 0）
export function daysBetween(a: DateString, b: DateString): number {
  return toDayNumber(parseOrThrow(b, 'b')) - toDayNumber(parseOrThrow(a, 'a'));
}

// その月の日数（month は 1〜12。年と月が整数でない・月が範囲外なら RangeError）
export function daysInMonth(year: number, month: number): number {
  if (typeof year !== 'number' || !Number.isInteger(year)) throw new RangeError('year は整数にしてください');
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('month は 1〜12 にしてください');
  return monthLength(year, month);
}

// 曜日（0 が日曜、6 が土曜）
export function weekdayOf(s: DateString): number {
  const dayNumber = toDayNumber(parseOrThrow(s, '日付'));
  return (((dayNumber + 4) % 7) + 7) % 7; // 1970-01-01 は木曜（4）
}

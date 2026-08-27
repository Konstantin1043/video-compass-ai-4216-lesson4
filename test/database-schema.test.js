import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608270001_auth_and_daily_credits.sql",
  import.meta.url,
);

test("миграция включает RLS и не выдаёт права анонимным пользователям", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /alter table public\.profiles enable row level security/i);
  assert.match(sql, /alter table public\.credit_events enable row level security/i);
  assert.match(sql, /revoke all on function public\.reserve_analysis_credit[\s\S]+from public, anon/i);
  assert.match(sql, /grant execute on function public\.reserve_analysis_credit[\s\S]+to authenticated/i);
});

test("ежедневный баланс использует календарный день Europe\/Riga", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /time zone 'Europe\/Riga'/i);
  assert.match(sql, /set credits = 10, credit_day = v_today/i);
});

test("возврат кредита идемпотентен и не поднимает баланс выше 10", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /and e\.status = 'reserved'/i);
  assert.match(sql, /least\(10, p\.credits \+ 1\)/i);
});

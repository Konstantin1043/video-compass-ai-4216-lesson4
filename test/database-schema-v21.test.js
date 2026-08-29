import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/202608280001_video_compass_21.sql",
  import.meta.url,
);

test("схема 2.1 создаёт задания, общие результаты, ссылки и ограничения", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["analysis_results", "analysis_jobs", "analysis_shares", "rate_limit_events"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
});

test("активный анализ защищён уникальным ключом и блокировкой этапа", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /unique index[\s\S]+where status in \('queued', 'transcript_processing', 'transcript_ready', 'ai_processing'\)/i);
  assert.match(sql, /for update;/i);
  assert.match(sql, /locked_until = now\(\) \+ interval '5 minutes'/i);
});

test("ошибка и зависшее задание возвращают зарезервированный кредит", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.fail_analysis_stage/i);
  assert.match(sql, /e\.status = 'reserved'/i);
  assert.match(sql, /set status = 'refunded'/i);
  assert.match(sql, /perform public\.fail_analysis_stage\(v_stale\.id, 'JOB_EXPIRED'\)/i);
});

test("очистка соблюдает 30 дней, 30 обычных анализов и бессрочное избранное", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /favorite = false/i);
  assert.match(sql, /interval '30 days'/i);
  assert.match(sql, /r\.position > 30/i);
  assert.match(sql, /cleanup_video_compass/i);
});

test("служебные таблицы и функции закрыты от браузерных ролей", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /revoke all on public\.analysis_results from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.count_external_analyses_since[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.cleanup_video_compass\(\) to service_role/i);
});

test("служебная роль получает минимальные права на таблицы анализа", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["analysis_results", "analysis_jobs", "analysis_shares", "rate_limit_events"]) {
    assert.match(
      sql,
      new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role`, "i"),
    );
  }
  assert.doesNotMatch(sql, /grant all on public\.(analysis_results|analysis_jobs|analysis_shares|rate_limit_events)/i);
});

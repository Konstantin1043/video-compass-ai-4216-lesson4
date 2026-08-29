-- Repair migration for projects that already applied VideoCompass AI 2.1.
-- Public browser roles stay revoked; only the backend Secret key receives access.

grant select, insert, update, delete on public.analysis_results to service_role;
grant select, insert, update, delete on public.analysis_jobs to service_role;
grant select, insert, update, delete on public.analysis_shares to service_role;
grant select, insert, update, delete on public.rate_limit_events to service_role;

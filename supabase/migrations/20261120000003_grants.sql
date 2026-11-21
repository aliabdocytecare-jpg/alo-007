-- DEC-046: explicit privileges for the service-role-only data path.
-- Tables created through the connection pooler did not inherit Supabase's default
-- privileges, so service_role got "permission denied for table". Grant explicitly and
-- set default privileges so future migrations (run as postgres) inherit them too.
-- Security model unchanged: only the server (service_role) reads/writes; RLS stays
-- deny-all for anon/authenticated (0 policies), so the SELECT grant below yields no rows.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
grant select on all tables in schema public to anon, authenticated;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
alter default privileges in schema public grant select on tables to anon, authenticated;
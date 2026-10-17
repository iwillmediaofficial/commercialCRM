-- Visitors who are not signed in never read or write tables directly. The only
-- things they can call are the public form functions (get_public_form,
-- submit_public_lead), which have their own grants.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

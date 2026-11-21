-- The leads phone index (leads_phone_key_idx) calls private.phone_key, so
-- everyone who saves a lead must be allowed to run it. Without this, staff
-- saw "permission denied for function phone_key" when changing a lead.
grant execute on function private.phone_key(text) to authenticated, service_role;

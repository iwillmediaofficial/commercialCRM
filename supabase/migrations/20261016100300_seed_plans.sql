-- Starting plans, taken from the examples in the product spec. Edit them in /admin.
-- Prices left NULL are not for sale until you set them.
insert into public.plans (name, description, price_monthly, price_quarterly, price_half_yearly, price_yearly,
                          staff_limit, client_limit, modules, sort_order)
values
  ('Starter', 'Leads and work tracking for small teams', 2999, 7999, null, 24999,
   3, 15, array['leads', 'work'], 1),
  ('Pro Agency', 'Everything, including invoicing, recurring billing and ad funds', null, null, null, null,
   10, 50, array['leads', 'work', 'invoicing', 'ad_funds'], 2),
  ('Enterprise', 'Unlimited staff and clients', null, null, null, null,
   null, null, array['leads', 'work', 'invoicing', 'ad_funds'], 3);

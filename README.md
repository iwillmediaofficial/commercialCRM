# Commercial CRM

A multi-company CRM sold on subscription. The Super Admin adds companies and
plans; each company (workspace) gets its own team, leads, clients, work,
invoicing and ad-fund tracking, kept apart by row-level security.

There is no email anywhere. People sign up with **email + password + a one-time
PIN**: the Super Admin gives company owners a PIN, owners and admins give their
staff PINs, and password resets work the same way.

## Stack

- React 19, TypeScript, Vite, Tailwind CSS, React Router
- Supabase (Postgres, Auth, Row Level Security, Edge Functions, pg_cron), Mumbai region
- Cloudflare Pages for hosting, Cloudflare R2 for files (coming)

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

`npm run build` type-checks and builds to `dist/`.

## Deploy to Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (values in `.env.example`)

`public/_redirects` sends every path to the app so links like `/w/acme/team` work.

## Layout

| Path | What |
| --- | --- |
| `supabase/migrations/` | Database: platform tables, module tables, functions, security rules |
| `supabase/functions/pin-auth/` | Edge Function for PIN sign-up and password reset |
| `supabase/tests/isolation.sql` | Proves companies can't see or change each other's data |
| `src/pages/admin/` | Super Admin: companies, renewals, plans |
| `src/pages/workspace/` | A company's app at `/w/<company>` |
| `src/pages/PublicForm.tsx` | Public lead form at `/f/<form>` |

## How access works

- **Super Admin** (`platform_admins`): sees every company, creates companies,
  sets plans, approves renewals. Can't edit a company's data without being a member.
- **Owner / Admin**: manage their company's team, data and subscription.
- **Staff**: see only leads and work assigned to them; no invoices or ad funds.
- **Plans** limit staff seats and clients and switch modules on or off.
- **Subscription status** is trial, active, grace (a few days after the end date),
  expired (read-only) or suspended (locked; public forms stop too).

## Tests

Run `supabase/tests/isolation.sql` in the Supabase SQL editor. It seeds two test
companies, checks 79 rules, and rolls everything back. The last line must be
`ALL TESTS PASSED (79 checks)`.

## Regenerate database types

After a schema change, regenerate `src/lib/database.types.ts` with
`supabase gen types typescript --project-id zpotoxpaeqeissxycgrz`.

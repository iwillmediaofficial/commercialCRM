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
- Cloudflare Pages for hosting, Cloudflare R2 for files (through the `files` Edge Function)

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

`npm run build` type-checks and builds to `dist/`.

## Deploy to Cloudflare Pages

1. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git, pick
   `iwillmediaofficial/commercialCRM`.
2. Production branch `main`. Framework preset: None. Build command `npm run build`.
   Output directory `dist`.
3. Environment variables (Production and Preview): `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (the same values as `.env.local`; both are public).
   Optionally `NODE_VERSION` = `22`.
4. Save and deploy. The site is at `https://<project>.pages.dev`. A custom domain can
   be added later under the project's Custom domains tab.
5. Supabase > Authentication > URL Configuration: set Site URL to the pages.dev address
   (no emails are sent, but it keeps auth redirects correct).

If Cloudflare shows "disconnected from your Git account", reconnect it, then push or merge any change to `main` to start a new build.

`public/_redirects` sends every path to the app so links like `/w/acme/team` work.
`public/_headers` sets security headers (CSP allows only Supabase and R2) and long
caching for hashed build files.

## Running on the free plans

- `.github/workflows/keep-awake.yml` calls Supabase once a day so the free project never pauses.
- `.github/workflows/backup.yml` backs up the database every Sunday, encrypted, to
  `_backups/` in the R2 bucket and keeps the last 8. It needs the repository secrets
  listed at the top of that file. Run it once by hand from the Actions tab to check it.
- `supabase/migrations/20261017100100_cleanup.sql` (run once in the SQL Editor) clears
  activity older than 6 months, read notifications older than 3 months and error
  reports older than 1 month, on the 1st of every month.
- File attachments on tasks, clients, leads and invoices are off until the Super Admin
  turns them on for a company in /admin. Images are shrunk in the browser before upload.

To restore a backup: download it from R2, then
`gpg -d db-YYYY-MM-DD.dump.gpg > db.dump` and
`pg_restore --no-owner --no-privileges -d "<connection string>" db.dump` into a fresh project.

## WhatsApp Inbox

Customers message a company's WhatsApp Business number; the messages land in that
company's **WhatsApp** page, matched to a lead (or a new lead with source
"WhatsApp", handed out by round-robin). Staff reply from the CRM.

1. Run `supabase/migrations/20261119140000_whatsapp_inbox.sql` in the SQL Editor.
2. Deploy the Edge Functions `whatsapp-webhook` (verify JWT **off**; it checks Meta's
   signature) and `whatsapp-send` (verify JWT on).
3. Add Edge Function secrets: `WHATSAPP_VERIFY_TOKEN` (any long random text),
   `WHATSAPP_APP_SECRET` (Meta app → App settings → Basic) and `WHATSAPP_ACCESS_TOKEN`
   (permanent System User token with whatsapp_business_messaging and
   whatsapp_business_management).
4. In the Meta app, WhatsApp → Configuration → Webhook: callback URL
   `https://<project>.supabase.co/functions/v1/whatsapp-webhook`, the same verify
   token, then subscribe to the **messages** field.
5. Super Admin → Companies → open the company → WhatsApp: turn it on and link the
   number's Phone number ID.

Replies are allowed only within 24 hours of the customer's last message
(WhatsApp's rule). Photos and files show as a label for now.

### WhatsApp AI assistant

When a company switches it on (WhatsApp → **AI assistant settings**, admins), new
chats are answered by Claude Haiku 5.5 from what the company wrote there. It asks
the company's questions, saves the answers and the customer's name on the lead,
and hands the chat to a person (with a note and a notification) when asked, when
the customer is ready to buy, or when it doesn't know. Staff can **Take over** or
**Hand back to AI**; any staff reply takes over. AI replies never count as
contact for the 1-hour rule. Usage per month is in `wa_ai_usage`; the allowance
(`wa_ai_settings.monthly_chat_limit`, default 500) can only be changed by the
Super Admin.

Needs the Edge Function secret `ANTHROPIC_API_KEY`, plus the functions
`whatsapp-webhook` (updated) and `whatsapp-ai-test` deployed, both sharing
`supabase/functions/_shared/wa_ai.ts`.

**Fill from website** (`whatsapp-ai-import`) reads the company's home page and up to
five key pages and drafts the knowledge fields; the admin reviews and saves. Only
public addresses are fetched (no IPs, private or local hosts). Usage counts toward
the month's AI use.

**Add-on and billing.** The assistant is a paid add-on (`workspaces.wa_ai_addon`,
default ₹999/month incl. GST, 500 AI chats). The Super Admin switches it on per
company in Companies > WhatsApp AI add-on (`admin_set_wa_ai_addon`). Without it the
settings page, test box, Fill from website and AI replies are off. Renewals add the
add-on price for the period, and the invoice shows it as its own line
(`invoice.lines`; `subscription_payments.addon_amount`). Switching the add-on or AI
replies off hands the AI's chats to the team.

**Follow-ups.** When a customer asks to be called or visited at a time, the AI returns
`follow_up_at` and `wa_ai_follow_up` sets it as the lead's follow-up, unless the team
already has an earlier one set by hand.

## Launch checklist

- Supabase > Authentication > Leaked password protection: turn on.
- /admin/settings: product name, support contact, and your business and GST details
  for subscription invoices.
- /admin/errors: crashes reported by browsers. Edge Function errors are under
  Supabase > Edge Functions > Logs.

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

## Installable app (PWA) and phone alerts

The site is an installable app. On Android (Chrome) people tap **Install** on the
banner or **Install app** in the account menu; on iPhone they use Safari's
Share > Add to Home Screen (the app shows these steps). Updates reach installed
apps on the next open, with no store and no review.

- `public/manifest.webmanifest` and `public/icons/` give the name, icon and splash
  screen (dark background with the icon). Change the name there if the product name changes.
- `public/sw.js` is the service worker. It caches **nothing**: every page, file
  and database request goes to the network, so new deploys and data are never
  stale. It only shows an offline page and handles phone alerts. `_headers`
  stops `sw.js` and the manifest from being cached.
- **Phone alerts**: account menu > Phone alerts (or "Turn on" under the bell).
  Every new bell notification (new or passed-on leads, follow-ups due, the daily
  follow-up summary and the rest) is also sent to each device that turned alerts on.
  `supabase/migrations/20261121110000_push_notifications.sql` stores devices and
  hands new notifications to the `push` Edge Function (verify JWT **off**), which
  makes its own VAPID keys on first use. Nothing needs setting up. iPhone alerts
  need iOS 16.4+ and the installed app. Signing out turns alerts off on that device.

### Later: Google Play (Trusted Web Activity)

1. Make a Google Play developer account (one-time $25).
2. Go to https://www.pwabuilder.com, enter `https://iwillcrm.in`, choose Android,
   package id e.g. `in.iwillcrm.app`, and download the package (it includes the
   signing key; keep it safe).
3. Put the SHA-256 fingerprint it gives into `public/.well-known/assetlinks.json`:
   `[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"in.iwillcrm.app","sha256_cert_fingerprints":["<fingerprint>"]}}]`
   (add Play App Signing's fingerprint too once Play shows it), and deploy.
4. Upload the `.aab` to Play Console. The Play app runs this same site, so every
   deploy updates it too.

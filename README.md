# Madinimarket

Madinimarket is a marketplace concept for buying and selling minerals in Tanzania and beyond. The current frontend prototype includes searchable seller listings, buyer requests, account modals, and listing forms.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Run a production build with `npm run build` and lint with `npm run lint`.

## Supabase setup

Configure the Supabase project and run these scripts in order in the Supabase SQL editor:

1. Copy `.env.example` to `.env.local`.
2. Add your Supabase project URL and keys.
3. Run `supabase/schema.sql`.
4. Run `supabase/approval-workflow.sql`.
5. Run `supabase/currency-control.sql` to add or upgrade the marketplace currency setting.
6. Run `supabase/platform-pricing.sql` to enable the admin-managed mineral listing fee.
7. Run `supabase/subscription-control.sql` to add account subscription plans and marketplace visibility controls.
8. Run `supabase/certificate-verification.sql`.
9. Run `supabase/translation-dictionary.sql`.
10. Run `supabase/market-hours.sql` after the other scripts so public listing and request views enforce the weekly market schedule.
11. Run `supabase/live-refresh.sql` to enable Realtime change notifications for public listing and buyer-request updates.
12. Add `SUPABASE_SERVICE_ROLE_KEY` to the server environment. Never expose it to the browser.

The admin currency switch controls whether new seller listings and buyer requests can use USD. The database keeps existing USD records unchanged and rejects new or currency-edited USD records while USD is disabled. The admin listing fee setting applies to new mineral listings; each listing keeps its saved fee rate and price when the setting changes. The admin market-hours schedule repeats weekly in Tanzania time; its default keeps the market open until an admin saves a schedule. When closed, public listing and buyer-request views return no records.

Open marketplace pages refresh when they become visible or reconnect, poll for changes as a fallback, and use Supabase Realtime notifications to refresh listings and buyer requests. Private settings and administrator data continue to refresh through authenticated API polling. A version notice appears when a newer deployment is detected; users can reload when ready so an open form is not lost.

Buyer and seller accounts are stored in `public.website_accounts`; their passwords are hashed by the server and they do not appear in Supabase Auth. The admin must be created in Supabase Auth and have a matching `public.profiles` row with `role = 'admin'`. Admin usernames can be any value; `MM-####` usernames are reserved for buyer and seller accounts.

Admins manage subscription plans from the Seller/buyer subscription panel. Website users request a plan and submit payment outside the site; an admin confirms or rejects the payment. Confirmation starts the plan immediately or schedules a same-plan renewal at the current expiry. Each subscription month is exactly 30 days, and approved listings and buyer requests from website accounts are visible only during an active subscription.

Active subscription plan prices are readable through the public Data API. Subscription records remain private: only the server's service-role API can access them; do not grant anonymous or authenticated CRUD access to `account_subscriptions`.

## Account and data model

- Buyer and seller accounts sign in to the website using generated `MM-####` usernames; they are not Supabase Auth users.
- Only the admin signs in through Supabase Auth. The server checks the profile's admin role before issuing a Supabase session.
- Website users can submit and manage their own pending or rejected requests; the admin reviews submissions using the Supabase-backed queue.
- Website users must submit an approved dealer or broker licence before they can list a mineral. Licence files are private and accept PDF, JPEG, or PNG up to 10 MB; admin rejection requires a reason before the user can replace and resubmit a licence.

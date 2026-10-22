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
6. Run `supabase/certificate-verification.sql`.
7. Run `supabase/translation-dictionary.sql`.
8. Add `SUPABASE_SERVICE_ROLE_KEY` to the server environment. Never expose it to the browser.

The admin currency switch controls whether new seller listings and buyer requests can use USD. The database keeps existing USD records unchanged and rejects new or currency-edited USD records while USD is disabled.

Buyer and seller accounts are stored in `public.website_accounts`; their passwords are hashed by the server and they do not appear in Supabase Auth. The admin must be created in Supabase Auth and have a matching `public.profiles` row with `role = 'admin'`. Admin usernames can be any value; `MM-####` usernames are reserved for buyer and seller accounts.

## Account and data model

- Buyer and seller accounts sign in to the website using generated `MM-####` usernames; they are not Supabase Auth users.
- Only the admin signs in through Supabase Auth. The server checks the profile's admin role before issuing a Supabase session.
- Website users can submit and manage their own pending or rejected requests; the admin reviews submissions using the Supabase-backed queue.
- Website users must submit an approved dealer or broker licence before they can list a mineral. Licence files are private and accept PDF, JPEG, or PNG up to 10 MB; admin rejection requires a reason before the user can replace and resubmit a licence.

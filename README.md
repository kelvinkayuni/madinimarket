# Madinimarket

Madinimarket is a marketplace concept for buying and selling minerals in Tanzania and beyond. The current frontend prototype includes searchable seller listings, buyer requests, account modals, and listing forms.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Run a production build with `npm run build` and lint with `npm run lint`.

## Supabase-ready setup

This app is now prepared for the next phase of real backend work:

1. Copy `.env.example` to `.env.local`.
2. Add your Supabase project URL and keys.
3. Run the SQL in `supabase/schema.sql` inside your Supabase SQL editor.
4. Enable the authentication providers you want for sign-in and account creation.
5. Add a storage bucket for listed mineral images if you plan to upload photos.

The health endpoint at `/api/health` reports whether the Supabase environment variables are configured and whether the app is running in prototype mode.

## Current prototype boundaries

- Seller listings, buyer requests, and the demo username are saved in the current browser and survive refreshes on that browser.
- Browser-local data is not shared with other devices or users; clearing this site's browser storage removes it.
- Account creation and sign-in are visual demos only. No passwords are saved or verified.
- Uploaded seller photos are resized to a square and stored with the listing in browser storage.
- A newly generated `MM-####` username is shown for one minute.
- Supabase authentication, database and image storage are not connected yet.
- GitHub repository linking and Vercel deployment have not been configured.

The next integration step is to replace browser-local storage with real Supabase auth, database tables, and image storage so accounts and listings are shared across devices.

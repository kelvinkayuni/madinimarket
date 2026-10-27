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
8. Run `supabase/subscription-no-renew.sql` after `subscription-control.sql` to prevent new subscription requests while a confirmed subscription is active.
9. Run `supabase/certificate-verification.sql`.
10. Run `supabase/translation-dictionary.sql`.
11. Run `supabase/homepage-content-settings.sql` to allow admin control of the Swahili switch, rotating homepage phrases, and headline font size. Re-run this idempotent script when applying updates to an existing installation.
12. Run `supabase/market-hours.sql` after the other scripts so public listing and request views enforce the weekly market schedule.
13. Run `supabase/live-refresh.sql` to enable Realtime change notifications for public listing and buyer-request updates.
14. Run `supabase/marketplace-orders.sql` to add the mineral cart, purchase orders, availability/payment/shipping workflows, and payout records. Re-run this idempotent script after updates so existing installations receive new order-notification fields.
15. Run `supabase/marketplace-listing-reservations.sql` to show confirmed-order reservations publicly, hide unavailable listings, let sellers confirm stock before relisting, keep listing reservation state synchronized when order items are updated or deleted, and release stale reservations with no active order item. Re-run this idempotent script after updates so existing installations receive reservation fixes and stale reservations are reconciled.
16. Run `supabase/marketplace-private-offers.sql` to add private offers on buyer requests and connect accepted offers to the standard order workflow.
17. Run `supabase/website-password-reset.sql` to enable one-time password-reset links for buyer and seller accounts.
18. Add `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MARKETPLACE_PAYMENT_INSTRUCTIONS`, and a strong `CRON_SECRET` to the server environment. Never expose the service-role key or cron secret to the browser. Set `GMAIL_FROM` to `Madini Market <info@madinimarket.co.tz>` only after that sender alias is verified in Gmail; otherwise app emails use `GMAIL_USER`. Set `NEXT_PUBLIC_APP_URL` to the deployed site URL used in password-reset and seller-notification links.
19. Configure an external scheduler to send an HTTP `GET` request to `/api/cron/marketplace-orders` every minute, using the standard HTTP token authorization scheme and the `CRON_SECRET` value. This endpoint expires seller-response and payment windows, hides listings whose sellers do not respond, retries failed seller availability emails, sends timeout notices, triggers the seven-day delivery payout rule, retries unsent transactional emails, and automatically deletes expired unpaid orders 30 minutes after their payment deadline. Buyers can delete an expired order themselves before then. Set the same strong `CRON_SECRET` in the deployment environment and in the scheduler's secret/header configuration. Vercel Hobby does not allow a one-minute cron schedule, so this repository does not configure a Vercel cron; order deadlines, automatic expired-order cleanup, and automatic payout eligibility will be processed late or not at all until the external scheduler is configured.

The admin currency switch controls whether new seller listings and buyer requests can use USD. The database keeps existing USD records unchanged and rejects new or currency-edited USD records while USD is disabled. The admin listing fee setting applies to new mineral listings; each listing keeps its saved fee rate and price when the setting changes. The admin market-hours schedule repeats weekly in Tanzania time; its default keeps the market open until an admin saves a schedule. When closed, public listing and buyer-request views return no records.

The admin English–Swahili panel controls whether visitors can switch to Swahili. Homepage headline phrases have their own admin panel; enter regular and highlighted parts separately, then set the headline size from 24 to 72 pixels. Saved phrases rotate every minute and are hidden when none are saved; the font size scales down on narrow screens.

Open marketplace pages refresh when they become visible or reconnect, poll for changes as a fallback, and use Supabase Realtime notifications to refresh listings and buyer requests. Private settings and administrator data continue to refresh through authenticated API polling. A version notice appears when a newer deployment is detected; users can reload when ready so an open form is not lost.

Buyer and seller accounts are stored in `public.website_accounts`; their passwords are hashed by the server and they do not appear in Supabase Auth. The admin must be created in Supabase Auth and have a matching `public.profiles` row with `role = 'admin'`. Admin usernames can be any value; `MM-####` usernames are reserved for buyer and seller accounts.

Admins manage subscription plans from the Seller/buyer subscription panel. Website users request a plan and submit payment outside the site; an admin confirms or rejects the payment. Confirmation starts the plan immediately or schedules a same-plan renewal at the current expiry. Each subscription month is exactly 30 days, and approved listings and buyer requests from website accounts are visible only during an active subscription.

Active subscription plan prices are readable through the public Data API. Subscription records remain private: only the server's service-role API can access them; do not grant anonymous or authenticated CRUD access to `account_subscriptions`.

## Mineral purchase workflow

- New website accounts collect a delivery address; existing accounts can fill or correct it when confirming their first order. The buyer's saved name, phone, and delivery address are snapshotted to each order. The seller receives the buyer name, phone, and address only after an administrator verifies payment; the buyer email is not included.
- Adding a mineral to a cart does not reserve it. Confirming the order reserves each listing, disables further cart additions, and publicly shows “Temporarily reserved — availability being confirmed” until the seller responds. Sellers have six hours to respond. A seller-confirmed unavailable item or a non-response is hidden from the public market and remains in the seller's order history; sellers can confirm the stock and relist it from My orders. Unavailable items are removed from the order, and the two-hour payment period starts after seller responses are finalized. Orders use one currency at a time.
- Buyers submit a payment transaction reference. An administrator verifies payment manually before sellers are instructed to dispatch. Sellers record the carrier and tracking number. An administrator checks the carrier's tracking and marks delivery confirmed; the buyer may confirm receipt or open a dispute.
- Receipt confirmation makes the seller payout due. If the buyer does not confirm, the scheduled job makes the payout due seven days after the administrator records carrier-confirmed delivery, unless the buyer opens a dispute. An administrator resolves disputes and records seller payout or buyer refund transaction references.
- This is manual payment administration, not escrow or an automatic money-transfer integration. Madinimarket must receive and hold buyer funds outside the app, make seller payouts/refunds outside the app, and record those transfers in the admin orders panel. Configure `MARKETPLACE_PAYMENT_INSTRUCTIONS` with the approved payment destination and steps. Configure Gmail SMTP so seller and buyer notifications can be sent. The app does not independently verify a carrier API or transfer funds.
- Listings owned by a seller without a website account cannot be purchased through this checkout workflow because that seller cannot respond to availability requests in their account.

## Private buyer-request offers

- An active seller with an approved dealer/broker licence can send a structured mineral offer and private photo from an eligible public buyer request. Buyer and seller review offer cards in the signed-in cart/orders panel; contact email and phone are not displayed in these cards.
- Each seller/request thread allows up to three price offers. A seller must wait for the buyer to decline an offer before sending a revision. Every offer snapshots the current admin-set listing fee, seller amount, fee amount, buyer total, and currency. Sellers see their price and fee breakdown; buyers see only the all-in total.
- The buyer can accept or decline an offer. After acceptance, the seller confirms the final mineral details without changing the agreed price or currency; the buyer reviews the final card and confirms the delivery details to create a standard marketplace order. The private mineral is not published as a public listing.
- Private orders use the same seller availability response, two-hour payment window, manual payment verification, shipping, receipt, dispute, and payout workflows as public market orders. An active or completed order prevents another checkout for the same buyer request, closes that request’s competing offers, and reserves the same seller’s matching private mineral card across requests. The saved fee and seller amount are carried into the order item. This remains manual payment administration; it does not automatically hold funds or transfer the seller payout.

## Account and data model

- Buyer and seller accounts sign in to the website using generated `MM-####` usernames; they are not Supabase Auth users.
- Buyer and seller account recovery emails go to the account's registered email and contain a single-use link that expires after 30 minutes. The user sets a new password on the site; passwords are never emailed. Apply `supabase/website-password-reset.sql` before deploying this flow. Administrator account recovery remains managed through Supabase Auth.
- Only the admin signs in through Supabase Auth. The server checks the profile's admin role before issuing a Supabase session.
- Website users can submit and manage their own pending or rejected requests; the admin reviews submissions using the Supabase-backed queue.
- Website users must submit an approved dealer or broker licence before they can list a mineral. Licence files are private and accept PDF, JPEG, or PNG up to 10 MB; admin rejection requires a reason before the user can replace and resubmit a licence.

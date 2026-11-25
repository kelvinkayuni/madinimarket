create table if not exists public.user_guide_content (
  id integer primary key check (id = 1),
  english_content text not null,
  swahili_content text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint user_guide_english_required check (char_length(btrim(english_content)) > 0),
  constraint user_guide_swahili_required check (char_length(btrim(swahili_content)) > 0),
  constraint user_guide_english_size check (char_length(english_content) <= 30000),
  constraint user_guide_swahili_size check (char_length(swahili_content) <= 30000)
);

alter table public.user_guide_content enable row level security;
revoke all on public.user_guide_content from public, anon, authenticated;
grant all on public.user_guide_content to service_role;

insert into public.user_guide_content (id, english_content, swahili_content)
values (
  1,
  $english$# English

## 1. Create your account and sign in

One account can be used to buy, sell, or do both.

To create an account, enter your first name, surname, email, phone number, 20-digit Tanzania NIDA NIN, country, region, district, street address, and a password of at least 8 characters. Your username will be emailed to you.

Sign in with your **username and password**—not your email address. If you already have an account but have not added your NIN, the site will ask you to add it before you continue. The site checks the NIN’s 20-digit format; it does not verify the number with NIDA. Only administrators can view it.

## 2. Pay for a subscription

Open the subscription section in your account, choose an available plan, and select TSh or USD if USD is offered. Check the payment methods and any additional instructions shown there, then pay the amount displayed.

Submit the transaction reference and a payment receipt in PDF, JPEG, or PNG format. Subscription receipts must be no larger than **4 MB**. Your subscription starts after an administrator confirms the payment. Each subscription month is 30 days; if you already have an active plan, a new plan may be scheduled to start after it expires.

An active subscription is needed for your approved listing or buyer request to appear on the public market.

## 3. Get approved to sell

Before listing minerals or sending private offers, upload an approved dealer or broker licence in your account. Licence files can be PDF, JPEG, or PNG, up to **10 MB**. Wait for the licence review:

- **Pending:** it is being reviewed and cannot be replaced while under review.
- **Rejected:** follow the review note and submit it again.
- **Approved:** you can proceed with seller features.

Licence approval is separate from approval of each mineral listing.

## 4. List a mineral for sale

Submit the mineral’s details, such as its name, weight, unit, type (single piece or batch), price, and location. The price you enter is the seller’s portion; the site adds its configured fee, and buyers see the total.

A main mineral photo is required. You can add up to two more photos. A stone certificate is optional; the listing accepts a PDF or JPEG certificate up to **10 MB**.

Your listing must be approved by an administrator before it appears on the market. It also needs an active subscription to be publicly visible. Check **Your submissions** in your account for its status.

## 5. Respond to and complete a sale

When a buyer orders your mineral, open **Orders and Cart → Selling** and respond to the availability request before the deadline shown:

- Choose **Available** if you can supply it.
- Choose **Unavailable** if you cannot. The mineral is hidden from the public market.
- If you do not respond before the deadline, the order may be cancelled and the mineral released.

After the buyer’s payment is verified, arrange delivery and enter the carrier and tracking details in the order. The buyer can then follow the shipment and confirm receipt.

After delivery is confirmed, Madinimarket records the payout status. Payouts are not automatic transfers from the app; follow the payout status and receipt shown in your order.

## 6. Buy a listed mineral

Browse the market, add the minerals you want to your cart, and proceed to checkout. Enter your name, phone number, and delivery address. Submitting the cart creates an order; sellers then confirm availability for their items.

Pay only for items sellers have confirmed as available. An unavailable item—or one whose seller does not respond in time—may be cancelled and released. Check **Orders and Cart → Buying** for the order status and any deadline.

Once an item is ready for payment, follow the payment methods and instructions shown on the site. Submit your transaction reference and proof of payment in PDF, JPEG, or PNG format, up to **10 MB**. The payment must be verified by an administrator before the seller is asked to dispatch.

When the mineral arrives, check it before confirming receipt. If there is a problem, report it through the order **before** confirming receipt. After you confirm receipt, you cannot report a delivery issue for that order item.

## 7. Make or respond to a buyer request

A buyer can submit a request describing the mineral they want, including details such as weight, colour, shape, quality, location, and requested price. An administrator must approve the request before it appears publicly, and an active subscription is needed for public visibility.

A licensed seller can send a private offer in response. Review the mineral details, total price, and any certificate before deciding. The buyer total includes the Madinimarket fee. Accepting an offer means agreeing to buy at the offered total, but it does not collect payment immediately. Complete checkout with your delivery details within the **30-minute** reservation window, then follow the payment deadline and status shown in your orders.

## 8. Payments and help

Payment methods, account details, fees, and deadlines may change; use the current instructions displayed on the site. The app records payment and payout information, but does not automatically transfer or hold funds.

For account or order help, open the support area from your account.$english$,
  $swahili$# Kiswahili

## 1. Fungua akaunti na uingie

Akaunti moja inaweza kutumika kununua, kuuza, au kufanya yote mawili.

Ili kufungua akaunti, jaza jina la kwanza, jina la ukoo, barua pepe, namba ya simu, NIN ya Tanzania yenye tarakimu 20, nchi, mkoa, wilaya, anwani ya mtaa, na nenosiri lenye angalau herufi/tarakimu 8. Jina lako la mtumiaji litatumwa kwa barua pepe.

Ingia kwa kutumia **jina la mtumiaji na nenosiri**—si anwani ya barua pepe. Ikiwa tayari una akaunti lakini hujaongeza NIN, tovuti itakuomba uiongeze kabla ya kuendelea. Tovuti hukagua tu kama NIN ina tarakimu 20; haihakiki namba hiyo kupitia NIDA. Wasimamizi pekee ndio wanaoweza kuiona.

## 2. Lipa usajili

Fungua sehemu ya usajili kwenye akaunti yako, chagua mpango unaopatikana, kisha chagua TSh au USD ikiwa USD imewezeshwa. Kagua njia za malipo na maelekezo ya ziada yanayoonyeshwa hapo, kisha lipa kiasi kilichoonyeshwa.

Wasilisha kumbukumbu ya muamala na risiti ya malipo katika PDF, JPEG au PNG. Risiti ya usajili isiwe kubwa kuliko **MB 4**. Usajili wako utaanza baada ya msimamizi kuthibitisha malipo. Kila mwezi wa usajili ni siku 30; ikiwa bado una usajili unaoendelea, mpango mpya unaweza kupangwa kuanza baada ya muda huo kuisha.

Usajili unaoendelea unahitajika ili tangazo lako lililoidhinishwa au ombi lako la mnunuzi lionekane kwenye soko la umma.

## 3. Pata idhini ya kuuza

Kabla ya kutangaza madini au kutuma ofa za faragha, pakia leseni iliyoidhinishwa ya dealer au broker kwenye akaunti yako. Faili ya leseni inaweza kuwa PDF, JPEG au PNG, hadi **MB 10**. Subiri ukaguzi wa leseni:

- **Inasubiri:** inakaguliwa; huwezi kuibadilisha wakati ukaguzi unaendelea.
- **Imekataliwa:** fuata maelezo ya ukaguzi kisha itume tena.
- **Imeidhinishwa:** unaweza kutumia huduma za muuzaji.

Idhini ya leseni ni tofauti na idhini ya kila tangazo la madini.

## 4. Tangaza madini ya kuuza

Wasilisha maelezo ya madini, kama vile jina, uzito, kipimo, aina (jiwe moja au kundi), bei na eneo. Bei unayoingiza ni sehemu ya muuzaji; tovuti huongeza ada yake iliyowekwa, na mnunuzi huona jumla ya bei.

Picha kuu ya madini inahitajika. Unaweza kuongeza hadi picha mbili zaidi. Cheti cha jiwe si lazima; cheti kinaweza kuwa PDF au JPEG, hadi **MB 10**.

Msimamizi lazima aidhinishe tangazo lako kabla halijaonekana sokoni. Pia unahitaji usajili unaoendelea ili tangazo lionekane hadharani. Angalia hali yake kwenye sehemu ya **Your submissions** kwenye akaunti yako.

## 5. Jibu na kamilisha mauzo

Mnunuzi akiagiza madini yako, fungua **Orders and Cart → Selling** na ujibu ombi la kuthibitisha upatikanaji kabla ya muda wa mwisho unaoonyeshwa:

- Chagua **Available** ikiwa unaweza kuyatoa.
- Chagua **Unavailable** ikiwa huwezi. Madini hayo yatafichwa kwenye soko la umma.
- Usipojibu kwa wakati, oda inaweza kufutwa na madini kuachiliwa.

Baada ya malipo ya mnunuzi kuthibitishwa, panga usafirishaji na uweke jina la kampuni ya usafirishaji pamoja na namba ya ufuatiliaji kwenye oda. Mnunuzi ataweza kufuatilia mzigo na kuthibitisha kuupokea.

Baada ya kupokea kuthibitishwa, Madinimarket huonyesha hali ya malipo ya muuzaji. Malipo ya muuzaji hayatumiwi kiotomatiki na programu; fuatilia hali ya malipo na risiti inayoonyeshwa kwenye oda yako.

## 6. Nunua madini yaliyotangazwa

Vinjari soko, ongeza madini unayotaka kwenye kapu, kisha endelea kulipia. Weka jina lako, namba ya simu na anwani ya kupeleka mzigo. Kutuma kapu hutengeneza oda; wauzaji kisha huthibitisha upatikanaji wa bidhaa zao.

Lipa tu bidhaa ambazo wauzaji wamethibitisha kuwa zinapatikana. Bidhaa isiyopatikana—au ambayo muuzaji hajajibu kwa wakati—inaweza kufutwa na kuachiliwa. Angalia **Orders and Cart → Buying** kuona hali ya oda na muda wa mwisho wa kulipa.

Bidhaa inapokuwa tayari kulipiwa, fuata njia na maelekezo ya malipo yanayoonyeshwa kwenye tovuti. Wasilisha kumbukumbu ya muamala na uthibitisho wa malipo katika PDF, JPEG au PNG, hadi **MB 10**. Msimamizi lazima athibitishe malipo kabla muuzaji hajaombwa kutuma bidhaa.

Madini yakifika, yakague kabla ya kuthibitisha kuwa umeyapokea. Ikiwa kuna tatizo, liripoti kupitia oda **kabla** ya kuthibitisha kupokea. Baada ya kuthibitisha kupokea, hutaweza kuripoti tatizo la uwasilishaji kwa bidhaa hiyo.

## 7. Tuma au jibu ombi la mnunuzi

Mnunuzi anaweza kutuma ombi linaloeleza madini anayotafuta, likijumuisha maelezo kama uzito, rangi, umbo, ubora, eneo na bei anayopendekeza. Msimamizi lazima aidhinishe ombi kabla halijaonekana hadharani, na usajili unaoendelea unahitajika ili lionekane kwenye soko.

Muuzaji mwenye leseni iliyoidhinishwa anaweza kutuma ofa ya faragha. Kabla ya kuamua, kagua maelezo ya madini, jumla ya bei na cheti chochote kilichowekwa. Jumla ya mnunuzi inajumuisha ada ya Madinimarket. Kukubali ofa kunamaanisha kukubali kununua kwa jumla ya bei iliyotolewa, lakini malipo hayakusanywi mara moja. Kamilisha malipo ya oda kwa kuweka maelezo ya anwani ndani ya muda wa **dakika 30** ambao madini yamehifadhiwa, kisha fuata muda wa mwisho na hali ya malipo inayoonyeshwa kwenye oda zako.

## 8. Malipo na msaada

Njia za malipo, taarifa za akaunti, ada na muda wa mwisho vinaweza kubadilika; tumia maelekezo ya sasa yanayoonyeshwa kwenye tovuti. Programu huhifadhi taarifa za malipo na malipo ya wauzaji, lakini haihamishi wala kuhifadhi fedha kiotomatiki.

Kwa msaada kuhusu akaunti au oda, fungua sehemu ya usaidizi kupitia akaunti yako.$swahili$
)
on conflict (id) do nothing;

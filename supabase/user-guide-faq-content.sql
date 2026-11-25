alter table public.user_guide_content
  add column if not exists english_faq_content text not null default ''
    check (char_length(english_faq_content) <= 30000),
  add column if not exists swahili_faq_content text not null default ''
    check (char_length(swahili_faq_content) <= 30000);

update public.user_guide_content
set english_faq_content = $english_faq$## Accounts and getting started
### What is Madinimarket?
Madinimarket is an online mineral marketplace. Buyers can browse and order listed minerals or post a request; sellers can list minerals or respond to requests. One account can be used to buy, sell, or both.

### How do I create an account?
Enter your name, email, phone number, 20-digit Tanzania NIDA NIN, address, and a password of at least 8 characters. Your username will be emailed to you. Sign in with your username and password, not your email address.

### Why is my NIN required?
Account setup requires a 20-digit Tanzania NIDA NIN. The site checks the number's format but does not verify it with NIDA. Only administrators can view it.

### Can I use one account to buy and sell?
Yes. One account can be used for both. To use seller features, you need an approved dealer or broker licence. An active subscription is needed for your approved listing or buyer request to appear publicly.

### What licence do I need to sell?
Upload an approved dealer or broker licence in your account. Licence files can be PDF, JPEG, or PNG, up to 10 MB. Licence approval is separate from approval of each mineral listing.

## Subscriptions and selling
### Do I need a subscription?
An active subscription is required for an approved mineral listing or buyer request to appear publicly. Available plans and prices are shown in the subscription section of your account.

### How do I pay for a subscription?
Choose an available plan and follow the current payment instructions shown on the site. Submit the transaction reference and a receipt in PDF, JPEG, or PNG format, up to 4 MB. An administrator confirms the payment before the subscription starts. Each subscription month is 30 days.

### How do I list a mineral or post a buyer request?
For a mineral listing, submit its details, price, location, and a main photo; you can add up to two more photos. A buyer request should describe the mineral you want and your requested details. Listings and requests need administrator approval and an active subscription to appear publicly.

### Why is my licence, listing, or request still pending?
Licences, mineral listings, and buyer requests each have a review process. Check Your submissions in your account for the current status and any review note. Approval of a licence does not automatically approve a listing.

## Buying, orders, and help
### How do I buy a listed mineral?
Add the mineral to your cart and proceed to checkout with your delivery details. The seller must confirm availability. Pay only for items confirmed as available; the buyer total includes the site's configured fee.

### How do private offers work?
A licensed seller can send a private offer in response to a buyer request. Review the mineral details and total price before accepting. Accepting does not collect payment immediately; complete checkout with your delivery details within the 30-minute reservation window, then follow the payment deadline shown in your orders.

### Where can I check my order status?
Open Orders and Cart, then choose Buying or Selling. The order shows its current status, next steps, and any payment or response deadline.

### What should I do if there is a delivery problem?
Report the problem through the order before confirming receipt. After you confirm receipt, you cannot report a delivery issue for that order item.

### Where do I find the correct payment instructions?
Use the current instructions shown on the site for the specific subscription or order. Payment methods, account details, fees, and deadlines may change, so do not rely on old instructions.

### What if my payment is not confirmed?
Check that you submitted the correct transaction reference and payment receipt, then check the subscription or order status. An administrator must verify payment. If you still need help, contact support from your account.

### Does Madinimarket hold funds or automatically transfer payouts?
No. The app records payment and payout information, but it does not automatically hold funds or transfer seller payouts. Follow the payment and payout status and instructions shown on the site.

### How do I get help with my account or an order?
Sign in and open Help / Contact admin from your account menu to submit a support request.$english_faq$
where id = 1 and btrim(english_faq_content) = '';

update public.user_guide_content
set swahili_faq_content = $swahili_faq$## Akaunti na kuanza kutumia
### Madinimarket ni nini?
Madinimarket ni soko la mtandaoni la madini. Wanunuzi wanaweza kuvinjari na kuagiza madini yaliyotangazwa au kutuma ombi; wauzaji wanaweza kutangaza madini au kujibu maombi. Akaunti moja inaweza kutumika kununua, kuuza, au kufanya yote mawili.

### Nitafunguaje akaunti?
Weka jina lako, barua pepe, namba ya simu, NIN ya Tanzania yenye tarakimu 20, anwani, na nenosiri lenye angalau herufi au tarakimu 8. Jina lako la mtumiaji litatumwa kwa barua pepe. Ingia kwa kutumia jina la mtumiaji na nenosiri, si anwani ya barua pepe.

### Kwa nini NIN yangu inahitajika?
Usajili wa akaunti unahitaji NIN ya NIDA ya Tanzania yenye tarakimu 20. Tovuti hukagua muundo wa namba pekee; haihakiki kupitia NIDA. Wasimamizi pekee ndio wanaoweza kuiona.

### Je, naweza kutumia akaunti moja kununua na kuuza?
Ndiyo. Akaunti moja inaweza kutumika kwa yote mawili. Ili kutumia huduma za muuzaji, unahitaji leseni iliyoidhinishwa ya dealer au broker. Usajili unaoendelea unahitajika ili tangazo au ombi lako lililoidhinishwa lionekane hadharani.

### Nahitaji leseni gani ili kuuza?
Pakia leseni iliyoidhinishwa ya dealer au broker kwenye akaunti yako. Faili inaweza kuwa PDF, JPEG au PNG, hadi MB 10. Idhini ya leseni ni tofauti na idhini ya kila tangazo la madini.

## Usajili na uuzaji
### Je, nahitaji usajili?
Usajili unaoendelea unahitajika ili tangazo la madini au ombi la mnunuzi lililoidhinishwa lionekane hadharani. Mipango na bei zinazopatikana zinaonyeshwa kwenye sehemu ya usajili katika akaunti yako.

### Nitalipiaje usajili?
Chagua mpango unaopatikana na ufuate maelekezo ya sasa ya malipo yanayoonyeshwa kwenye tovuti. Wasilisha kumbukumbu ya muamala na risiti katika PDF, JPEG au PNG, hadi MB 4. Usajili utaanza baada ya msimamizi kuthibitisha malipo. Kila mwezi wa usajili ni siku 30.

### Nitatangazaje madini au kutuma ombi la mnunuzi?
Kwa tangazo la madini, wasilisha maelezo yake, bei, eneo na picha kuu; unaweza kuongeza hadi picha mbili zaidi. Ombi la mnunuzi lieleze madini unayotafuta na maelezo unayotaka. Matangazo na maombi yanahitaji idhini ya msimamizi na usajili unaoendelea ili yaonekane hadharani.

### Kwa nini leseni, tangazo au ombi langu bado linasubiri?
Leseni, matangazo ya madini na maombi ya wanunuzi hukaguliwa kila kimoja kivyake. Angalia hali na maelezo ya ukaguzi kwenye sehemu ya Your submissions katika akaunti yako. Leseni kuidhinishwa hakumaanishi tangazo limeidhinishwa moja kwa moja.

## Ununuzi, oda na msaada
### Nitanunuaje madini yaliyotangazwa?
Ongeza madini kwenye kapu na uendelee kulipia kwa kuweka maelezo ya anwani ya kupeleka. Muuzaji lazima athibitishe upatikanaji. Lipa bidhaa zilizothibitishwa kuwa zinapatikana pekee; jumla ya mnunuzi inajumuisha ada iliyowekwa na tovuti.

### Ofa za faragha hufanya kazi vipi?
Muuzaji mwenye leseni anaweza kutuma ofa ya faragha kujibu ombi la mnunuzi. Kagua maelezo ya madini na jumla ya bei kabla ya kukubali. Kukubali hakusanyi malipo mara moja; kamilisha hatua ya kulipia kwa kuweka anwani ndani ya muda wa dakika 30 wa kuhifadhiwa, kisha fuata muda wa mwisho wa malipo unaoonyeshwa kwenye oda zako.

### Nitaangalia wapi hali ya oda yangu?
Fungua Orders and Cart, kisha uchague Buying au Selling. Oda inaonyesha hali ya sasa, hatua zinazofuata, na muda wowote wa mwisho wa kujibu au kulipa.

### Nifanye nini kukiwa na tatizo la uwasilishaji?
Ripoti tatizo kupitia oda kabla ya kuthibitisha kuwa umepokea bidhaa. Baada ya kuthibitisha kupokea, hutaweza kuripoti tatizo la uwasilishaji kwa bidhaa hiyo.

### Nitapata wapi maelekezo sahihi ya malipo?
Tumia maelekezo ya sasa yanayoonyeshwa kwenye tovuti kwa usajili au oda husika. Njia za malipo, taarifa za akaunti, ada na muda wa mwisho vinaweza kubadilika; usitegemee maelekezo ya zamani.

### Nifanye nini ikiwa malipo yangu hayajathibitishwa?
Hakikisha umewasilisha kumbukumbu sahihi ya muamala na risiti ya malipo, kisha angalia hali ya usajili au oda. Msimamizi lazima athibitishe malipo. Ikiwa bado unahitaji msaada, wasiliana na usaidizi kupitia akaunti yako.

### Je, Madinimarket huhifadhi fedha au kutuma malipo ya wauzaji kiotomatiki?
Hapana. Programu huhifadhi taarifa za malipo na malipo ya wauzaji, lakini haihifadhi fedha wala kutuma malipo ya wauzaji kiotomatiki. Fuata hali na maelekezo ya malipo yanayoonyeshwa kwenye tovuti.

### Nitapataje msaada kuhusu akaunti au oda?
Ingia kwenye akaunti yako, kisha fungua Help / Contact admin kwenye menyu ya akaunti ili kutuma ombi la msaada.$swahili_faq$
where id = 1 and btrim(swahili_faq_content) = '';

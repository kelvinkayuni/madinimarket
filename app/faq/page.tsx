import type { Metadata } from "next";
import Link from "next/link";

type Faq = {
  question: string;
  answer: string;
};

type FaqGroup = {
  title: string;
  items: Faq[];
};

const englishFaqGroups: FaqGroup[] = [
  {
    title: "Accounts and getting started",
    items: [
      {
        question: "What is Madinimarket?",
        answer: "Madinimarket is an online mineral marketplace. Buyers can browse and order listed minerals or post a request; sellers can list minerals or respond to requests. One account can be used to buy, sell, or both.",
      },
      {
        question: "How do I create an account?",
        answer: "Enter your name, email, phone number, 20-digit Tanzania NIDA NIN, address, and a password of at least 8 characters. Your username will be emailed to you. Sign in with your username and password, not your email address.",
      },
      {
        question: "Why is my NIN required?",
        answer: "Account setup requires a 20-digit Tanzania NIDA NIN. The site checks the number's format but does not verify it with NIDA. Only administrators can view it.",
      },
      {
        question: "Can I use one account to buy and sell?",
        answer: "Yes. One account can be used for both. To use seller features, you need an approved dealer or broker licence. An active subscription is needed for your approved listing or buyer request to appear publicly.",
      },
      {
        question: "What licence do I need to sell?",
        answer: "Upload an approved dealer or broker licence in your account. Licence files can be PDF, JPEG, or PNG, up to 10 MB. Licence approval is separate from approval of each mineral listing.",
      },
    ],
  },
  {
    title: "Subscriptions and selling",
    items: [
      {
        question: "Do I need a subscription?",
        answer: "An active subscription is required for an approved mineral listing or buyer request to appear publicly. Available plans and prices are shown in the subscription section of your account.",
      },
      {
        question: "How do I pay for a subscription?",
        answer: "Choose an available plan and follow the current payment instructions shown on the site. Submit the transaction reference and a receipt in PDF, JPEG, or PNG format, up to 4 MB. An administrator confirms the payment before the subscription starts. Each subscription month is 30 days.",
      },
      {
        question: "How do I list a mineral or post a buyer request?",
        answer: "For a mineral listing, submit its details, price, location, and a main photo; you can add up to two more photos. A buyer request should describe the mineral you want and your requested details. Listings and requests need administrator approval and an active subscription to appear publicly.",
      },
      {
        question: "Why is my licence, listing, or request still pending?",
        answer: "Licences, mineral listings, and buyer requests each have a review process. Check Your submissions in your account for the current status and any review note. Approval of a licence does not automatically approve a listing.",
      },
    ],
  },
  {
    title: "Buying, orders, and help",
    items: [
      {
        question: "How do I buy a listed mineral?",
        answer: "Add the mineral to your cart and proceed to checkout with your delivery details. The seller must confirm availability. Pay only for items confirmed as available; the buyer total includes the site's configured fee.",
      },
      {
        question: "How do private offers work?",
        answer: "A licensed seller can send a private offer in response to a buyer request. Review the mineral details and total price before accepting. Accepting does not collect payment immediately; complete checkout with your delivery details within the 30-minute reservation window, then follow the payment deadline shown in your orders.",
      },
      {
        question: "Where can I check my order status?",
        answer: "Open Orders and Cart, then choose Buying or Selling. The order shows its current status, next steps, and any payment or response deadline.",
      },
      {
        question: "What should I do if there is a delivery problem?",
        answer: "Report the problem through the order before confirming receipt. After you confirm receipt, you cannot report a delivery issue for that order item.",
      },
      {
        question: "Where do I find the correct payment instructions?",
        answer: "Use the current instructions shown on the site for the specific subscription or order. Payment methods, account details, fees, and deadlines may change, so do not rely on old instructions.",
      },
      {
        question: "What if my payment is not confirmed?",
        answer: "Check that you submitted the correct transaction reference and payment receipt, then check the subscription or order status. An administrator must verify payment. If you still need help, contact support from your account.",
      },
      {
        question: "Does Madinimarket hold funds or automatically transfer payouts?",
        answer: "No. The app records payment and payout information, but it does not automatically hold funds or transfer seller payouts. Follow the payment and payout status and instructions shown on the site.",
      },
      {
        question: "How do I get help with my account or an order?",
        answer: "Sign in and open Help / Contact admin from your account menu to submit a support request.",
      },
    ],
  },
];

const swahiliFaqGroups: FaqGroup[] = [
  {
    title: "Akaunti na kuanza kutumia",
    items: [
      {
        question: "Madinimarket ni nini?",
        answer: "Madinimarket ni soko la mtandaoni la madini. Wanunuzi wanaweza kuvinjari na kuagiza madini yaliyotangazwa au kutuma ombi; wauzaji wanaweza kutangaza madini au kujibu maombi. Akaunti moja inaweza kutumika kununua, kuuza, au kufanya yote mawili.",
      },
      {
        question: "Nitafunguaje akaunti?",
        answer: "Weka jina lako, barua pepe, namba ya simu, NIN ya Tanzania yenye tarakimu 20, anwani, na nenosiri lenye angalau herufi au tarakimu 8. Jina lako la mtumiaji litatumwa kwa barua pepe. Ingia kwa kutumia jina la mtumiaji na nenosiri, si anwani ya barua pepe.",
      },
      {
        question: "Kwa nini NIN yangu inahitajika?",
        answer: "Usajili wa akaunti unahitaji NIN ya NIDA ya Tanzania yenye tarakimu 20. Tovuti hukagua muundo wa namba pekee; haihakiki kupitia NIDA. Wasimamizi pekee ndio wanaoweza kuiona.",
      },
      {
        question: "Je, naweza kutumia akaunti moja kununua na kuuza?",
        answer: "Ndiyo. Akaunti moja inaweza kutumika kwa yote mawili. Ili kutumia huduma za muuzaji, unahitaji leseni iliyoidhinishwa ya dealer au broker. Usajili unaoendelea unahitajika ili tangazo au ombi lako lililoidhinishwa lionekane hadharani.",
      },
      {
        question: "Nahitaji leseni gani ili kuuza?",
        answer: "Pakia leseni iliyoidhinishwa ya dealer au broker kwenye akaunti yako. Faili inaweza kuwa PDF, JPEG au PNG, hadi MB 10. Idhini ya leseni ni tofauti na idhini ya kila tangazo la madini.",
      },
    ],
  },
  {
    title: "Usajili na uuzaji",
    items: [
      {
        question: "Je, nahitaji usajili?",
        answer: "Usajili unaoendelea unahitajika ili tangazo la madini au ombi la mnunuzi lililoidhinishwa lionekane hadharani. Mipango na bei zinazopatikana zinaonyeshwa kwenye sehemu ya usajili katika akaunti yako.",
      },
      {
        question: "Nitalipiaje usajili?",
        answer: "Chagua mpango unaopatikana na ufuate maelekezo ya sasa ya malipo yanayoonyeshwa kwenye tovuti. Wasilisha kumbukumbu ya muamala na risiti katika PDF, JPEG au PNG, hadi MB 4. Usajili utaanza baada ya msimamizi kuthibitisha malipo. Kila mwezi wa usajili ni siku 30.",
      },
      {
        question: "Nitatangazaje madini au kutuma ombi la mnunuzi?",
        answer: "Kwa tangazo la madini, wasilisha maelezo yake, bei, eneo na picha kuu; unaweza kuongeza hadi picha mbili zaidi. Ombi la mnunuzi lieleze madini unayotafuta na maelezo unayotaka. Matangazo na maombi yanahitaji idhini ya msimamizi na usajili unaoendelea ili yaonekane hadharani.",
      },
      {
        question: "Kwa nini leseni, tangazo au ombi langu bado linasubiri?",
        answer: "Leseni, matangazo ya madini na maombi ya wanunuzi hukaguliwa kila kimoja kivyake. Angalia hali na maelezo ya ukaguzi kwenye sehemu ya Your submissions katika akaunti yako. Leseni kuidhinishwa hakumaanishi tangazo limeidhinishwa moja kwa moja.",
      },
    ],
  },
  {
    title: "Ununuzi, oda na msaada",
    items: [
      {
        question: "Nitanunuaje madini yaliyotangazwa?",
        answer: "Ongeza madini kwenye kapu na uendelee kulipia kwa kuweka maelezo ya anwani ya kupeleka. Muuzaji lazima athibitishe upatikanaji. Lipa bidhaa zilizothibitishwa kuwa zinapatikana pekee; jumla ya mnunuzi inajumuisha ada iliyowekwa na tovuti.",
      },
      {
        question: "Ofa za faragha hufanya kazi vipi?",
        answer: "Muuzaji mwenye leseni anaweza kutuma ofa ya faragha kujibu ombi la mnunuzi. Kagua maelezo ya madini na jumla ya bei kabla ya kukubali. Kukubali hakusanyi malipo mara moja; kamilisha hatua ya kulipia kwa kuweka anwani ndani ya muda wa dakika 30 wa kuhifadhiwa, kisha fuata muda wa mwisho wa malipo unaoonyeshwa kwenye oda zako.",
      },
      {
        question: "Nitaangalia wapi hali ya oda yangu?",
        answer: "Fungua Orders and Cart, kisha uchague Buying au Selling. Oda inaonyesha hali ya sasa, hatua zinazofuata, na muda wowote wa mwisho wa kujibu au kulipa.",
      },
      {
        question: "Nifanye nini kukiwa na tatizo la uwasilishaji?",
        answer: "Ripoti tatizo kupitia oda kabla ya kuthibitisha kuwa umepokea bidhaa. Baada ya kuthibitisha kupokea, hutaweza kuripoti tatizo la uwasilishaji kwa bidhaa hiyo.",
      },
      {
        question: "Nitapata wapi maelekezo sahihi ya malipo?",
        answer: "Tumia maelekezo ya sasa yanayoonyeshwa kwenye tovuti kwa usajili au oda husika. Njia za malipo, taarifa za akaunti, ada na muda wa mwisho vinaweza kubadilika; usitegemee maelekezo ya zamani.",
      },
      {
        question: "Nifanye nini ikiwa malipo yangu hayajathibitishwa?",
        answer: "Hakikisha umewasilisha kumbukumbu sahihi ya muamala na risiti ya malipo, kisha angalia hali ya usajili au oda. Msimamizi lazima athibitishe malipo. Ikiwa bado unahitaji msaada, wasiliana na usaidizi kupitia akaunti yako.",
      },
      {
        question: "Je, Madinimarket huhifadhi fedha au kutuma malipo ya wauzaji kiotomatiki?",
        answer: "Hapana. Programu huhifadhi taarifa za malipo na malipo ya wauzaji, lakini haihifadhi fedha wala kutuma malipo ya wauzaji kiotomatiki. Fuata hali na maelekezo ya malipo yanayoonyeshwa kwenye tovuti.",
      },
      {
        question: "Nitapataje msaada kuhusu akaunti au oda?",
        answer: "Ingia kwenye akaunti yako, kisha fungua Help / Contact admin kwenye menyu ya akaunti ili kutuma ombi la msaada.",
      },
    ],
  },
];

export const metadata: Metadata = {
  title: "Frequently Asked Questions | Madinimarket",
  description: "Quick answers about Madinimarket accounts, subscriptions, buying, selling, orders, and payments.",
};

function FaqGroups({ groups }: { groups: FaqGroup[] }) {
  return <div className="faq-groups">
    {groups.map((group) => <section className="faq-group" key={group.title}>
      <h3>{group.title}</h3>
      <div className="faq-list">
        {group.items.map((item) => <details className="faq-item" key={item.question}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>)}
      </div>
    </section>)}
  </div>;
}

export default function Page() {
  return <main className="user-guide-page faq-page">
    <div className="user-guide-topbar">
      <Link href="/" className="user-guide-back">Back to marketplace</Link>
      <Link href="/user-guide" className="user-guide-back">Read the Buyer &amp; Seller Guide</Link>
    </div>
    <header className="user-guide-header">
      <p className="dialog-kicker">FREQUENTLY ASKED QUESTIONS</p>
      <h1>Quick answers for the mineral market.</h1>
      <p>Find answers about accounts, licences, subscriptions, buying, selling, orders, and payments.</p>
      <nav className="user-guide-contents" aria-label="FAQ languages">
        <a href="#english-faq">English FAQs</a>
        <a href="#swahili-faq">Maswali ya Kiswahili</a>
      </nav>
    </header>
    <article id="english-faq" className="user-guide-language faq-language">
      <h2>English</h2>
      <FaqGroups groups={englishFaqGroups} />
      <p className="faq-guide-prompt">For step-by-step instructions, read the <Link href="/user-guide">Buyer &amp; Seller Guide</Link>.</p>
    </article>
    <article id="swahili-faq" className="user-guide-language user-guide-swahili faq-language">
      <h2>Kiswahili</h2>
      <FaqGroups groups={swahiliFaqGroups} />
      <p className="faq-guide-prompt">Kwa maelekezo ya hatua kwa hatua, soma <Link href="/user-guide">Mwongozo wa Mnunuzi na Muuzaji</Link>.</p>
    </article>
  </main>;
}

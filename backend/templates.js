// Fixed follow-up emails (6). The signature below is added to every email automatically. Har person ke liye sirf {{firstName}} aur {{company}} badalte hain.
// First email aapki CSV / Excel file se aata hai (subject + body).
// Har follow-up same thread mein "Re: <first subject>" banke jata hai, pichhle emails niche quote hote hain.
// Text badalna ho to yahin badlo aur backend restart karo.

// Signature - added automatically at the end of EVERY email (first email + all follow-ups).
// If your first email in the file already has "Aanchal Ara", it is not added twice.
export const SIGNATURE = `Best regards,

Aanchal Ara
Mobile:  +91-7251924877
Executive Assistant to Director`;

// text that tells us the signature is already in an email
export const SIGNATURE_KEY = 'Aanchal Ara';

const hi = (text) => `Hi {{firstName}},\n\n${text}`;

// Follow-up 1 ... 6 (in this order)
export const FOLLOW_UPS = [
  // 1 - the barter pitch
  hi(`We run influencer campaigns with micro- and nano-creators on a barter basis. Creators are paid in product, not cash, so the cost of adding one more creator is a unit of stock plus our fee - no per-creator cash payouts to negotiate. That lets us run more creators than most brands can manage in-house.

We've done this for brands including PepsiCo.

If it's worth it, reply and I'll send a short note on what a barter creator campaign would look like for {{company | your brand}}.`),

  // 2
  hi(`Just following up on my earlier email regarding barter-led micro and nano influencer campaigns for {{company | your brand}}.

Given the brand's growth phase, I'd love to explore how this model could support upcoming launches and awareness campaigns. Please share a suitable time for a quick 15-minute call to discuss this further.

Awaiting your response.`),

  // 3
  hi(`Just following up on my earlier note. We can help {{company | your brand}} scale micro & nano creator collaborations to drive authentic product content, increase brand visibility, and reach a wider relevant audience while keeping creator costs efficient through barter. If you share your upcoming launch or marketing focus, I can send 2–3 tailored campaign ideas for your brand.

Looking forward to your response.`),

  // 4
  hi(`Following up on my previous messages regarding creator amplification for {{company | your brand}}.

Please let me know if you have 15 minutes to spare for a quick call this week to discuss how we can support your upcoming marketing initiatives.

Awaiting your response.`),

  // 5
  hi(`Following up on my previous notes regarding barter-led creator campaigns for {{company | your brand}}.

Please let me know if you have 10-15 minutes available for a quick call this week to discuss how this could work for your upcoming campaigns.

Awaiting your response.`),

  // 6 - last one
  hi(`Since I've sent a few follow-ups regarding barter-led creator campaigns for {{company | your brand}}, please let me know a time that works best for you to connect for a quick 15-minute call.

Awaiting your response.`),
];

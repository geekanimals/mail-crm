// Fixed follow-up emails (6). The signature below is added to every email automatically. Har person ke liye sirf {{firstName}} aur {{company}} badalte hain.
// First email aapki CSV / Excel file se aata hai (subject + body).
// Har follow-up same thread mein "Re: <first subject>" banke jata hai, pichhle emails niche quote hote hain.
// Text badalna ho to yahin badlo aur backend restart karo.

// Signature - added automatically at the end of EVERY email (first email + all follow-ups).
// If your first email in the file already has "Aanchal Ara", it is not added twice.
// The logo is backend/assets/geekmail.png (sent inside the email, so it always shows).
export const SIGNATURE = `Aanchal Ara
Executive Assistant - Director
m: +917251924877  e: hr@geekcreativeagency.com
Book appointment: calendly.com/geekexploring`;

export const SIGNATURE_LOGO = 'geekmail.png';

const blue = '#5bbad9';
export const SIGNATURE_HTML = `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;border-collapse:collapse"><tr>
<td style="padding:0 14px 0 0;vertical-align:middle"><img src="cid:geek-signature-logo" width="150" height="123" alt="Geek" style="display:block;border:0;width:150px;height:123px"></td>
<td style="border-left:4px solid ${blue};padding:6px 0 6px 18px;vertical-align:middle;line-height:1.5">
<div style="color:${blue};font-size:19px;margin-bottom:8px">Aanchal Ara</div>
<div style="color:#1f1f1f;font-size:15px;font-weight:bold">Executive Assistant - Director</div>
<div style="color:#1f1f1f;font-size:14px"><span style="color:${blue}">m:</span> +917251924877&nbsp;&nbsp;<span style="color:#a3c4dc">e:</span><a href="mailto:hr@geekcreativeagency.com" style="color:#1155cc">hr@geekcreativeagency.com</a></div>
<div style="color:#1f1f1f;font-size:14px"><b>Book appointment:</b> <a href="https://calendly.com/geekexploring" style="color:#1155cc">calendly.com/geekexploring</a></div>
</td></tr></table>`;

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

Awaiting your response.

Regards,`),

  // 3
  hi(`Just following up on my earlier note. We can help {{company | your brand}} scale micro & nano creator collaborations to drive authentic product content, increase brand visibility, and reach a wider relevant audience while keeping creator costs efficient through barter. If you share your upcoming launch or marketing focus, I can send 2–3 tailored campaign ideas for your brand.

Looking forward to your response.

Regards,`),

  // 4
  hi(`Following up on my previous messages regarding creator amplification for {{company | your brand}}.

Please let me know if you have 15 minutes to spare for a quick call this week to discuss how we can support your upcoming marketing initiatives.

Awaiting your response.

Best regards,`),

  // 5
  hi(`Following up on my previous notes regarding barter-led creator campaigns for {{company | your brand}}.

Please let me know if you have 10-15 minutes available for a quick call this week to discuss how this could work for your upcoming campaigns.

Awaiting your response.

Best regards,`),

  // 6 - last one
  hi(`Since I've sent a few follow-ups regarding barter-led creator campaigns for {{company | your brand}}, please let me know a time that works best for you to connect for a quick 15-minute call.

Awaiting your response.

Best regards,`),
];

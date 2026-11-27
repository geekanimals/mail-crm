// Turns two periods of numbers (one company + one platform) into plain-English findings:
// what went up / down, the likely reason (from the numbers), and what to do next.
// Rules only use the uploaded numbers — they point the team where to look, they don't replace checking the posts.
import { change, engagementRate } from "./calc";
import { fmt } from "./format";

const BIG = 10; // a change of 10% or more counts as "moved"

const pct = (p) => (p === null ? "new" : `${p > 0 ? "+" : ""}${p.toFixed(0)}%`);
const perPost = (t) => (t.posts ? Math.round(t.views / t.posts) : 0);

// Ideas that usually help on each platform
export const PLATFORM_TIPS = {
  Facebook: [
    "Short vertical videos (Reels) get the most reach on Facebook right now — post 2–3 a week.",
    "Hook in the first 3 seconds: Facebook counts a view after 3 seconds, so start with the point, not a logo.",
    "Ask a direct question in the caption and reply to every comment within the first hour.",
  ],
  Instagram: [
    "Reels bring new people; carousels bring saves and shares — mix both every week.",
    "Saves and shares tell Instagram the post is useful: make tips, checklists and before/after posts.",
    "Use the first line of the caption as a hook and add a clear call to action (save / share / follow).",
  ],
  LinkedIn: [
    "Text + image or document (PDF carousel) posts get the most reach — share real lessons and numbers.",
    "Comments in the first hour decide reach: ask the team to engage early and reply to every comment.",
    "Post from people's profiles too — personal profiles usually reach more than company pages.",
  ],
  "X / Twitter": [
    "Post more often — X rewards frequency; 1–3 posts a day keeps the account visible.",
    "Threads and posts with an image or short video get more views than plain links.",
    "Reply to bigger accounts in your industry to get in front of new people.",
  ],
  YouTube: [
    "Title and thumbnail decide clicks — test a clearer, bigger-text thumbnail.",
    "Shorts bring new viewers; long videos bring watch time and subscribers — use both.",
    "Keep the first 30 seconds tight: say what the viewer will get, then deliver it.",
  ],
};

/**
 * prev / cur: totals for the two periods. period: "week" | "month".
 * Returns { verdict: "up" | "down" | "mixed" | "steady", headline, findings: [{ tone, title, why, todo }] }
 */
export function diagnose(prev, cur, period = "week", platform = "") {
  const yt = platform === "YouTube"; // YouTube says subscribers, not followers
  const p = (k) => change(prev[k], cur[k]);
  const moved = (k) => prev[k] > 0 && Math.abs(p(k)) >= BIG;
  const up = (k) => moved(k) && p(k) > 0;
  const down = (k) => moved(k) && p(k) < 0;
  const word = period === "week" ? "week" : "month";
  const findings = [];

  // ---- Views / reach and the number of posts ----
  const reachKey = cur.views || prev.views ? "views" : "reach";
  const reachName = reachKey === "views" ? "Views" : "Reach";
  const hasPosts = prev.posts > 0 || cur.posts > 0;
  if (down(reachKey)) {
    if (hasPosts && cur.posts < prev.posts) {
      findings.push({
        tone: "down",
        title: `${reachName} fell ${pct(p(reachKey))} (${fmt(prev[reachKey])} → ${fmt(cur[reachKey])})`,
        why: `Only ${cur.posts} post${cur.posts === 1 ? "" : "s"} this ${word} vs ${prev.posts} last ${word}. Fewer posts means fewer chances to be seen.`,
        todo: `Get back to at least ${prev.posts} posts per ${word}. Plan and schedule them at the start of the ${word}.`,
      });
    } else if (hasPosts && cur.posts) {
      findings.push({
        tone: "down",
        title: `${reachName} fell ${pct(p(reachKey))} (${fmt(prev[reachKey])} → ${fmt(cur[reachKey])})`,
        why: `Posting was the same or more (${prev.posts} → ${cur.posts} posts), but each post got fewer views: ${fmt(perPost(cur))} per post vs ${fmt(perPost(prev))}. The content or format didn't pull people in.`,
        todo: "Open last week's best post and this week's posts side by side: compare the hook, format (video / image) and topic. Make the next posts like the best one.",
      });
    } else {
      findings.push({
        tone: "down",
        title: `${reachName} fell ${pct(p(reachKey))} (${fmt(prev[reachKey])} → ${fmt(cur[reachKey])})`,
        why: hasPosts ? `No posts were published this ${word}.` : "Fewer people saw the content this " + word + ".",
        todo: "Check how many posts went out and which ones did worst. Keep a steady posting schedule.",
      });
    }
  } else if (up(reachKey)) {
    findings.push({
      tone: "up",
      title: `${reachName} grew ${pct(p(reachKey))} (${fmt(prev[reachKey])} → ${fmt(cur[reachKey])})`,
      why:
        hasPosts && cur.posts > prev.posts
          ? `More posts (${prev.posts} → ${cur.posts}) brought more views.`
          : hasPosts && cur.posts
            ? `Each post reached more people: ${fmt(perPost(cur))} views per post vs ${fmt(perPost(prev))}.`
            : "More people saw the content.",
      todo: "Find the post that did best this " + word + " and make 2–3 more on the same topic / format.",
    });
  }

  // ---- Engagement: did people react to what they saw? ----
  const er = engagementRate(cur);
  const erPrev = engagementRate(prev);
  if (cur.views && prev.views && erPrev > 0) {
    const erChange = ((er - erPrev) / erPrev) * 100;
    if (erChange <= -15) {
      findings.push({
        tone: "down",
        title: `People reacted less: engagement rate ${erPrev.toFixed(2)}% → ${er.toFixed(2)}%`,
        why: up(reachKey)
          ? "More people saw the posts, but fewer of them liked, commented or shared. The content reached new people but didn't connect with them."
          : "Out of the people who saw the posts, fewer liked, commented or shared.",
        todo: "End every post with a question or clear call to action, reply to comments in the first hour, and post more useful / relatable content.",
      });
    } else if (erChange >= 15) {
      findings.push({
        tone: "up",
        title: `Content connected better: engagement rate ${erPrev.toFixed(2)}% → ${er.toFixed(2)}%`,
        why: "A bigger share of viewers liked, commented or shared.",
        todo: "Repeat this topic and format next " + word + " — it is working.",
      });
    }
  }

  // ---- Likes / comments / shares / saves ----
  if (down("comments") && !down("likes")) {
    findings.push({
      tone: "down",
      title: `Fewer comments ${pct(p("comments"))} (${fmt(prev.comments)} → ${fmt(cur.comments)})`,
      why: "Posts got likes but started fewer conversations.",
      todo: "Ask open questions, run polls, or reply to comments with a question to keep the conversation going.",
    });
  }
  if (up("shares") || up("saves")) {
    const k = up("shares") ? "shares" : "saves";
    findings.push({
      tone: "up",
      title: `More ${k} ${pct(p(k))} (${fmt(prev[k])} → ${fmt(cur[k])})`,
      why: `People found the posts worth ${k === "shares" ? "sharing" : "saving"} — this is one of the strongest signals for the algorithm.`,
      todo: "Make more of this kind of useful content (tips, how-to, checklists).",
    });
  } else if (down("shares")) {
    findings.push({
      tone: "down",
      title: `Fewer shares ${pct(p("shares"))} (${fmt(prev.shares)} → ${fmt(cur.shares)})`,
      why: "Content was less worth passing on.",
      todo: "Add value people want to send to a friend: tips, offers, relatable moments.",
    });
  }

  // ---- Audience: followers, visits, link clicks ----
  const fans = yt ? "subscribers" : "followers";
  if (down("newFollowers")) {
    findings.push({
      tone: "down",
      title: `Fewer new ${fans} ${pct(p("newFollowers"))} (${fmt(prev.newFollowers)} → ${fmt(cur.newFollowers)})`,
      why: yt ? "Fewer viewers decided to subscribe to the channel." : "Fewer viewers decided to follow the page.",
      todo: yt
        ? "Ask viewers to subscribe in the video and in a pinned comment, add an end screen with a Subscribe button, and keep the channel banner clear about what people get."
        : "Add a 'Follow for more' call to action, pin the best post, and keep the profile bio clear about what people get.",
    });
  } else if (up("newFollowers")) {
    findings.push({
      tone: "up",
      title: `More new ${fans} ${pct(p("newFollowers"))} (${fmt(prev.newFollowers)} → ${fmt(cur.newFollowers)})`,
      why: yt ? "More viewers liked the videos enough to subscribe." : "More people liked what they saw enough to follow.",
      todo: `Check which ${yt ? "video" : "post"} brought the ${fans} and do more of it.`,
    });
  }
  if (down("visits")) {
    findings.push({
      tone: "down",
      title: `Fewer profile / page visits ${pct(p("visits"))}`,
      why: "Fewer people were curious enough to open the profile.",
      todo: "Tease more in the posts ('full details on our page') and keep the profile updated.",
    });
  }
  if (down("linkClicks")) {
    findings.push({
      tone: "down",
      title: `Fewer link clicks ${pct(p("linkClicks"))}`,
      why: "Fewer people went to the website.",
      todo: "Give a clear reason to click (offer, free guide) and put the link where it is easy to find.",
    });
  }
  if (down("watchTime")) {
    findings.push({
      tone: "down",
      title: `Less watch time ${pct(p("watchTime"))}`,
      why: "People stopped watching the videos earlier.",
      todo: "Start with the main point, cut slow parts, and keep videos shorter.",
    });
  }

  // ---- Overall verdict (main metrics only) ----
  const main = ["views", "reach", "viewers", "interactions", "likes", "comments", "shares", "newFollowers"].filter((k) => prev[k] > 0);
  const ups = main.filter(up).length;
  const downs = main.filter(down).length;
  const verdict = ups && !downs ? "up" : downs && !ups ? "down" : ups || downs ? "mixed" : "steady";
  const headline = {
    up: `Good ${word} — ${ups} of the main numbers went up and nothing dropped.`,
    down: `Weak ${word} — ${downs} of the main numbers dropped. See below why and what to fix.`,
    mixed: `Mixed ${word} — ${ups} up, ${downs} down. See below what helped and what needs work.`,
    steady: `Steady ${word} — no big change (everything within ±${BIG}%).`,
  }[verdict];

  if (!findings.length) {
    findings.push({
      tone: "info",
      title: "No big change",
      why: `All numbers moved less than ${BIG}% compared with last ${word}.`,
      todo: "Try one new format or topic this " + word + " to find what grows the account.",
    });
  }

  return { verdict, headline, findings };
}

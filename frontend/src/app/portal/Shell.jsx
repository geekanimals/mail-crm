'use client';
// Employee portal frame: glass sidebar on desktop, top bar + bottom tab bar + slide-in menu on phones.
import { useEffect, useState } from 'react';
import {
  LuBriefcase, LuCalendarDays, LuClock, LuEllipsis, LuFileText, LuFolder, LuLayoutDashboard, LuLightbulb, LuListChecks, LuLogOut, LuTarget, LuUser, LuWallet, LuX,
} from 'react-icons/lu';
import { Avatar } from '@/lib/hr';

const LOGO = process.env.NEXT_PUBLIC_LOGO_ICON_URL || '/fav.png';

export const NAV = [
  { group: 'Overview', items: [['home', 'Home', LuLayoutDashboard, 'Your day at a glance']] },
  {
    group: 'My work',
    items: [
      ['tasks', 'Tasks', LuListChecks, 'Work given to you'],
      ['attendance', 'Attendance', LuClock, 'Check-in, check-out and your month'],
      ['leaves', 'Leaves', LuCalendarDays, 'Apply for leave and see your balance'],
      ['report', 'Weekly report', LuFileText, 'Tell the team what you did this week'],
      ['targets', 'Targets', LuTarget, 'This month’s goals - tick them off'],
      ['accounts', 'Accounts', LuBriefcase, 'Client accounts you work on'],
    ],
  },
  {
    group: 'Me',
    items: [
      ['documents', 'Documents', LuFolder, 'Your HR documents'],
      ['payslips', 'Payslips', LuWallet, 'Your salary slips'],
      ['profile', 'Profile', LuUser, 'Your details and password'],
      ['ideas', 'Idea Bucket', LuLightbulb, 'Ideas and suggestions from the team'],
    ],
  },
];
const ALL = NAV.flatMap((g) => g.items);
const BOTTOM = ['home', 'tasks', 'attendance', 'leaves'];

export default function Shell({ me, tab, setTab, hideAccounts, onLogout, children }) {
  const [open, setOpen] = useState(false); // phone menu
  const items = (list) => list.filter(([k]) => k !== 'accounts' || !hideAccounts);
  const current = ALL.find(([k]) => k === tab) || ALL[0];
  const go = (k) => {
    setTab(k);
    setOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // warm "employee" theme: only while the employee portal is on screen (the admin side never gets it)
  useEffect(() => {
    document.body.classList.add('emp-theme');
    return () => document.body.classList.remove('emp-theme');
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const Icon = current[2];

  return (
    <div className="es">
      <style>{themeCss}</style>
      <style>{css}</style>
      {open && <div className="es-dim" onClick={() => setOpen(false)} />}
      <aside className={`es-side ${open ? 'open' : ''}`}>
        <div className="es-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="Geek" />
          <div><b>Geek</b><small>Employee portal</small></div>
          <button className="es-close" onClick={() => setOpen(false)} aria-label="Close menu"><LuX /></button>
        </div>
        <nav className="es-nav">
          {NAV.map((g) => {
            const list = items(g.items);
            if (!list.length) return null;
            return (
              <div key={g.group} className="es-group">
                <span className="es-glabel">{g.group}</span>
                {list.map(([k, label, I]) => (
                  <button key={k} className={`es-link ${tab === k ? 'on' : ''}`} onClick={() => go(k)} title={label}>
                    <I /> <span>{label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="es-me">
          <Avatar name={me.name} photo={me.photo} size={40} className="es-avatar" />
          <div className="es-metext"><b>{me.name}</b><small>{me.title || me.email}</small></div>
          <button className="es-out" onClick={onLogout} title="Log out" aria-label="Log out"><LuLogOut /></button>
        </div>
      </aside>

      <div className="es-main">
        <header className="es-top">
          <div className="es-topleft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="es-toplogo" src={LOGO} alt="Geek" />
            <div>
              <small>{today}</small>
              <b>{hello}, {me.name.split(' ')[0]}</b>
            </div>
          </div>
          <button className="es-topme" onClick={() => go('profile')} aria-label="My profile">
            <Avatar name={me.name} photo={me.photo} size={38} className="es-avatar sm" />
          </button>
        </header>

        <div className="es-content">
          <div className="es-title">
            <span className="es-titleicon"><Icon /></span>
            <div><h1>{current[1]}</h1><p>{current[3]}</p></div>
          </div>
          {children}
        </div>
      </div>

      <nav className="es-bottom">
        {BOTTOM.map((k) => {
          const [, label, I] = ALL.find(([x]) => x === k);
          return <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}><I /><span>{label}</span></button>;
        })}
        <button className={!BOTTOM.includes(tab) ? 'on' : ''} onClick={() => setOpen(true)}><LuEllipsis /><span>More</span></button>
      </nav>
    </div>
  );
}

const css = `
.es { --sw: 264px; min-height: 100vh; }
.es-side { position: fixed; top: 16px; bottom: 16px; left: 16px; width: var(--sw); z-index: 40; display: flex; flex-direction: column; gap: 6px; padding: 18px 14px 14px;
  background: linear-gradient(160deg, rgba(255,255,255,.82), rgba(255,255,255,.62) 60%, rgba(50,193,223,.10));
  backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255,255,255,.9); border-radius: 28px; box-shadow: 0 24px 60px rgba(11,60,75,.12), inset 0 1px 0 #fff; }
.es-brand { display: flex; align-items: center; gap: 12px; padding: 0 6px 14px; border-bottom: 1px solid rgba(11,60,75,.07); }
.es-brand img { width: 44px; height: 44px; border-radius: 14px; background: #fff; box-shadow: 0 8px 18px rgba(50,193,223,.28); }
.es-brand b { display: block; font-size: 18px; letter-spacing: -.01em; }
.es-brand small { font-size: 12px; color: #5d7680; }
.es-close { display: none; margin-left: auto; width: 36px; height: 36px; border-radius: 12px; border: 0; background: rgba(50,193,223,.14); color: #0b87a5; font-size: 18px; cursor: pointer; place-items: center; }
.es-nav::-webkit-scrollbar { display: none; }
.es-nav { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; display: flex; flex-direction: column; gap: 14px; padding: 10px 2px; }
.es-group { display: flex; flex-direction: column; gap: 2px; }
.es-glabel { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #8aa1aa; padding: 0 12px 6px; }
.es-link { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border: 0; border-radius: 14px; background: transparent; color: #3a5560; font: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer; text-align: left; transition: background .15s, color .15s, transform .15s; }
.es-link svg { font-size: 19px; flex-shrink: 0; color: #6b8a94; transition: color .15s; }
.es-link:hover { background: rgba(50,193,223,.10); color: #0b87a5; }
.es-link:hover svg { color: #0b87a5; }
.es-link.on { background: linear-gradient(150deg, #4fcde7, #1aa9c8); color: #fff; box-shadow: 0 10px 22px rgba(26,169,200,.35); }
.es-link.on svg { color: #fff; }
.es-me { display: flex; align-items: center; gap: 10px; padding: 12px 8px 4px; border-top: 1px solid rgba(11,60,75,.07); }
.es-avatar.hr-avatar { border-radius: 13px; font-size: 14px !important; background: linear-gradient(150deg, #5fd3eb, #0b87a5); box-shadow: 0 0 0 2px #fff, 0 4px 12px rgba(11,135,165,.25); }
.es-avatar.sm.hr-avatar { border-radius: 12px; }
.es-metext { min-width: 0; flex: 1; }
.es-metext b { display: block; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.es-metext small { display: block; font-size: 12px; color: #5d7680; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.es-out { width: 38px; height: 38px; border-radius: 12px; border: 1px solid rgba(225,29,72,.18); background: #fff; color: #e11d48; display: grid; place-items: center; font-size: 17px; cursor: pointer; flex-shrink: 0; }
.es-out:hover { background: #e11d48; color: #fff; }

.es-main { margin-left: calc(var(--sw) + 32px); margin-right: 16px; min-width: 0; }
.es-top { position: sticky; top: 0; z-index: 20; display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 16px 0 0; padding: 14px 22px; border-radius: 22px;
  background: rgba(255,255,255,.72); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 10px 30px rgba(11,60,75,.07); }
.es-topleft { display: flex; align-items: center; gap: 12px; min-width: 0; }
.es-topleft small { display: block; font-size: 12.5px; color: #5d7680; }
.es-topleft b { display: block; font-size: 18px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.es-toplogo { display: none; width: 38px; height: 38px; border-radius: 12px; background: #fff; box-shadow: 0 6px 14px rgba(50,193,223,.25); }
.es-topme { border: 0; background: none; padding: 0; cursor: pointer; }
.es-content { padding: 26px 0 48px; display: flex; flex-direction: column; gap: 18px; } /* full width, lined up with the top bar */
@media (min-width: 1800px) { .es-main { max-width: 1640px; } } /* very wide screens: keep lines readable */
.es-title { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
.es-titleicon { width: 48px; height: 48px; border-radius: 16px; display: grid; place-items: center; font-size: 22px; color: #0b87a5; background: #fff; border: 1px solid rgba(50,193,223,.25); box-shadow: 0 8px 20px rgba(50,193,223,.15); flex-shrink: 0; }
.es-title h1 { font-size: 26px; letter-spacing: -.02em; margin: 0; }
.es-title p { margin: 2px 0 0; color: #5d7680; font-size: 14px; }
.es-bottom, .es-dim { display: none; }

/* desktop: icons only, opens over the page while the mouse is on it (same as the admin sidebar) */
@media (min-width: 901px) {
  .es { --sw: 84px; }
  .es-side { overflow: hidden; transition: width .22s ease, box-shadow .22s ease; }
  .es-side:hover { width: 264px; box-shadow: 0 30px 70px rgba(11,60,75,.20), inset 0 1px 0 #fff; }
  .es-brand { padding: 0 4px 14px; }
  .es-brand > div, .es-glabel, .es-link span, .es-metext { opacity: 0; white-space: nowrap; transition: opacity .15s; }
  .es-side:hover .es-brand > div, .es-side:hover .es-glabel, .es-side:hover .es-link span, .es-side:hover .es-metext { opacity: 1; }
  .es-link { padding: 11px 16px; }
  .es-me { padding: 12px 4px 4px; }
}

/* ---------- phones and small tablets ---------- */
@media (max-width: 900px) {
  .es-side { top: 0; bottom: 0; left: 0; border-radius: 0 28px 28px 0; width: min(300px, 86vw); transform: translateX(-105%); transition: transform .25s ease; }
  .es-side.open { transform: none; }
  .es-close { display: grid; }
  .es-dim { display: block; position: fixed; inset: 0; z-index: 35; background: rgba(14,42,51,.3); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
  .es-main { margin-left: 0; margin-right: 0; max-width: none; }
  .es-top { margin: 10px 12px 0; padding: 10px 14px; border-radius: 18px; }
  .es-toplogo { display: block; }
  .es-topleft b { font-size: 16px; }
  .es-topleft small { font-size: 11.5px; }
  .es-content { padding: 18px 14px 110px; gap: 14px; }
  .es-title h1 { font-size: 21px; }
  .es-title p { font-size: 13px; }
  .es-titleicon { width: 42px; height: 42px; font-size: 19px; border-radius: 14px; }
  .es-bottom { display: grid; grid-template-columns: repeat(5, 1fr); position: fixed; left: 10px; right: 10px; bottom: calc(10px + env(safe-area-inset-bottom)); z-index: 30; padding: 6px; border-radius: 22px;
    background: rgba(255,255,255,.88); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border: 1px solid rgba(255,255,255,.95); box-shadow: 0 14px 40px rgba(11,60,75,.18); }
  .es-bottom button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 2px; border: 0; border-radius: 16px; background: none; color: #6b8a94; font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
  .es-bottom button svg { font-size: 20px; }
  .pt-toast { bottom: calc(96px + env(safe-area-inset-bottom)) !important; }
  .es-bottom button.on { background: linear-gradient(150deg, #4fcde7, #1aa9c8); color: #fff; box-shadow: 0 8px 18px rgba(26,169,200,.35); }
}
`;

// Warm theme for the employee portal: cream glass on a peach-beige backdrop, charcoal text and buttons,
// copper accents and one dark highlight card. Everything is scoped to body.emp-theme.
const themeCss = `
body.emp-theme { background: #efe6dd; --ink: #26221f; --muted: #8c847d; --copper: #c27c4f; --copper2: #dfa47a; --cream: #f7ede4; --peach: #f3dfcf; --line: rgba(120,90,60,.12); }
body.emp-theme .pt {
  color: var(--ink);
  background:
    radial-gradient(1100px 600px at -10% -10%, rgba(232,176,136,.45), transparent 60%),
    radial-gradient(900px 700px at 110% 110%, rgba(214,200,190,.55), transparent 60%),
    linear-gradient(135deg, #f1e2d4 0%, #f6efe9 45%, #ebe7e4 100%);
  background-attachment: fixed;
}
body.emp-theme .pt h1, body.emp-theme .pt h2, body.emp-theme .pt h3 { color: var(--ink); }
body.emp-theme .pt-muted, body.emp-theme .es-topleft small, body.emp-theme .es-title p, body.emp-theme .es-brand small, body.emp-theme .es-metext small { color: var(--muted); }

/* glass panels */
body.emp-theme .es-side, body.emp-theme .es-top, body.emp-theme .pt-card, body.emp-theme .em-tiles > *, body.emp-theme .es-bottom {
  background: rgba(255,255,255,.52); border: 1px solid rgba(255,255,255,.75);
  box-shadow: 0 18px 50px rgba(120,80,50,.10), inset 0 1px 0 rgba(255,255,255,.8);
  backdrop-filter: blur(26px) saturate(140%); -webkit-backdrop-filter: blur(26px) saturate(140%);
}
body.emp-theme .es-brand, body.emp-theme .es-me { border-color: var(--line); }
body.emp-theme .es-brand img, body.emp-theme .es-toplogo { box-shadow: 0 8px 18px rgba(194,124,79,.25); }
body.emp-theme .es-glabel { color: #b3a89f; }

/* menu */
body.emp-theme .es-link { color: #6f6760; }
body.emp-theme .es-link svg { color: #a39a92; }
body.emp-theme .es-link:hover { background: rgba(243,223,207,.6); color: var(--ink); }
body.emp-theme .es-link:hover svg { color: var(--copper); }
body.emp-theme .es-link.on { background: var(--peach); color: var(--ink); box-shadow: inset 0 0 0 1px rgba(194,124,79,.18); }
body.emp-theme .es-link.on svg { color: var(--copper); }
body.emp-theme .es-side:hover { box-shadow: 0 30px 70px rgba(120,80,50,.22), inset 0 1px 0 rgba(255,255,255,.8); }
body.emp-theme .es-close { background: rgba(243,223,207,.7); color: var(--ink); }
body.emp-theme .es-bottom button { color: #8c847d; }
body.emp-theme .es-bottom button.on { background: var(--ink); color: #fff; box-shadow: 0 8px 18px rgba(38,34,31,.25); }
body.emp-theme .es-titleicon { color: var(--copper); background: rgba(255,255,255,.7); border-color: rgba(194,124,79,.2); box-shadow: 0 8px 20px rgba(194,124,79,.12); }
body.emp-theme .es-avatar.hr-avatar, body.emp-theme .hr-avatar { background: linear-gradient(150deg, #e2ad86, #b8734a); }
body.emp-theme .es-avatar.hr-avatar { box-shadow: 0 0 0 2px #fff, 0 4px 12px rgba(184,115,74,.25); }

/* buttons, fields, chips */
body.emp-theme .pt-btn { background: rgba(255,255,255,.75); color: var(--ink); border-color: rgba(120,90,60,.16); }
body.emp-theme .pt-btn:hover { background: #fff; }
body.emp-theme .pt-btn.solid, body.emp-theme .pt-btn.solid:hover { background: var(--ink); color: #fff; border-color: transparent; box-shadow: 0 8px 18px rgba(38,34,31,.18); }
body.emp-theme .pt input, body.emp-theme .pt select, body.emp-theme .pt textarea { background: rgba(255,255,255,.8); border-color: rgba(120,90,60,.18); color: var(--ink); }
body.emp-theme .pt input:focus, body.emp-theme .pt select:focus, body.emp-theme .pt textarea:focus { outline: 2px solid rgba(194,124,79,.35); border-color: var(--copper); }
body.emp-theme .em-tabs { background: rgba(255,255,255,.5); border-color: rgba(255,255,255,.75); }
body.emp-theme .em-tabs button.on { color: var(--ink); background: var(--peach); box-shadow: none; }
body.emp-theme .em-auto { color: #9a5a33; background: var(--peach); }
body.emp-theme .em-link, body.emp-theme .em-sum b { color: var(--copper); }
body.emp-theme .em-listbtn:hover { border-color: rgba(194,124,79,.45); }
body.emp-theme .pt-dot { background: var(--copper); box-shadow: 0 0 0 4px rgba(194,124,79,.15); }
body.emp-theme .pt-bar { background: rgba(120,90,60,.10); }
body.emp-theme .pt-bar span, body.emp-theme .hr-progress i { background: linear-gradient(180deg, var(--copper2), var(--copper)); }
body.emp-theme .pt-toast { background: var(--ink); }

/* left-over blue bits: big %, checkboxes, team chips, messages */
body.emp-theme .pt-progress b { color: var(--ink); }
body.emp-theme .pt input[type=checkbox], body.emp-theme .pt input[type=radio], body.emp-theme .dv-panel input[type=checkbox] { accent-color: var(--copper); }
body.emp-theme .pt-team span { background: var(--peach); color: #7a4527; }
body.emp-theme .pt-team span.me { background: var(--ink); color: #fff; }
body.emp-theme .pt-msg.mine { background: var(--peach); border-color: rgba(194,124,79,.25); }
body.emp-theme .pt-steps li.now { color: #9a5a33; } body.emp-theme .pt-steps li.now span { background: var(--copper); }
/* inline-styled shared parts (file links, pop-up buttons, payslip): the old blue becomes copper / charcoal here */
body.emp-theme [style*="color: rgb(11, 135, 165)"] { color: var(--copper) !important; }
body.emp-theme [style*="background: rgb(11, 135, 165)"], body.emp-theme [style*="background-color: rgb(11, 135, 165)"] { background: var(--ink) !important; }
body.emp-theme [style*="border: 1px solid rgb(11, 135, 165)"] { border-color: var(--ink) !important; }
body.emp-theme [style*="border-bottom: 2px solid rgb(11, 135, 165)"] { border-bottom-color: var(--copper) !important; }
body.emp-theme [style*="rgb(79, 205, 231)"] { background: var(--ink) !important; }
body.emp-theme [style*="background: rgb(239, 250, 252)"], body.emp-theme [style*="background-color: rgb(239, 250, 252)"] { background: var(--peach) !important; }

/* numbers */
body.emp-theme .em-tiles b, body.emp-theme .em-punch b, body.emp-theme .em-heroname b { color: var(--ink); }
body.emp-theme .em-tiles span, body.emp-theme .em-punch span { color: var(--muted); }
body.emp-theme .em-tiles.small > * { background: rgba(255,255,255,.7); }

/* the dark highlight card (Today) */
body.emp-theme .pt-card.em-today { background: linear-gradient(160deg, #2c2724 0%, #1b1917 100%); border-color: rgba(255,255,255,.08); color: #f4ede6; box-shadow: 0 24px 50px rgba(30,20,12,.28); }
body.emp-theme .em-today h2 { color: #fff; }
body.emp-theme .em-today .em-punch div { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.08); }
body.emp-theme .em-today .em-punch span { color: #b5aaa0; }
body.emp-theme .em-today .em-punch b { color: #f6dcc6; }
body.emp-theme .em-today .pt-btn { background: rgba(255,255,255,.08); color: #f4ede6; border-color: rgba(255,255,255,.14); }
body.emp-theme .em-today .pt-btn.solid { background: linear-gradient(150deg, var(--copper2), var(--copper)); color: #1b1917; box-shadow: 0 8px 20px rgba(194,124,79,.35); }

/* deal screen opened from a task (it sits outside the page, so it is themed here too) */
body.emp-theme .dv-overlay { background: rgba(60,40,25,.30); }
body.emp-theme .dv-panel { background: #f6efe8; color: #26221f; }
body.emp-theme .dv-card, body.emp-theme .dv-money div { background: rgba(255,255,255,.7); border-color: rgba(120,90,60,.12); }
body.emp-theme .dv-now { border-color: rgba(194,124,79,.45); box-shadow: 0 8px 26px rgba(194,124,79,.14); }
body.emp-theme .dv-form { background: rgba(243,223,207,.35); }
body.emp-theme .dv-btn { background: #26221f; }
body.emp-theme .dv-btn.ghost { background: #fff; color: #26221f; border-color: rgba(120,90,60,.2); }
body.emp-theme .dv-badge { background: #f3dfcf; color: #9a5a33; }
body.emp-theme .dv-money b { color: #26221f; }
body.emp-theme .dv-steps li.now { color: #9a5a33; }
body.emp-theme .dv-steps li.now .dv-dot { background: linear-gradient(150deg, #dfa47a, #c27c4f); box-shadow: 0 0 0 4px rgba(194,124,79,.22); }
body.emp-theme .dv-chip { background: #f3dfcf; color: #7a4527; }
body.emp-theme .dv-busy { color: #9a5a33; }
`;

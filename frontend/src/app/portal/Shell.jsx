'use client';
// Employee portal frame: glass sidebar on desktop, top bar + bottom tab bar + slide-in menu on phones.
import { useEffect, useState } from 'react';
import {
  LuBriefcase, LuCalendarDays, LuClock, LuEllipsis, LuFileText, LuFolder, LuLayoutDashboard, LuListChecks, LuLogOut, LuTarget, LuUser, LuWallet, LuX,
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
                  <button key={k} className={`es-link ${tab === k ? 'on' : ''}`} onClick={() => go(k)}>
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
.es-nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 10px 2px; }
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

.es-main { margin-left: calc(var(--sw) + 32px); min-width: 0; }
.es-top { position: sticky; top: 0; z-index: 20; display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 16px 16px 0 0; padding: 14px 20px; border-radius: 22px;
  background: rgba(255,255,255,.72); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 10px 30px rgba(11,60,75,.07); }
.es-topleft { display: flex; align-items: center; gap: 12px; min-width: 0; }
.es-topleft small { display: block; font-size: 12.5px; color: #5d7680; }
.es-topleft b { display: block; font-size: 18px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.es-toplogo { display: none; width: 38px; height: 38px; border-radius: 12px; background: #fff; box-shadow: 0 6px 14px rgba(50,193,223,.25); }
.es-topme { border: 0; background: none; padding: 0; cursor: pointer; }
.es-content { max-width: 1080px; margin: 0 auto; padding: 26px 32px 48px 16px; display: flex; flex-direction: column; gap: 16px; }
.es-title { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
.es-titleicon { width: 48px; height: 48px; border-radius: 16px; display: grid; place-items: center; font-size: 22px; color: #0b87a5; background: #fff; border: 1px solid rgba(50,193,223,.25); box-shadow: 0 8px 20px rgba(50,193,223,.15); flex-shrink: 0; }
.es-title h1 { font-size: 26px; letter-spacing: -.02em; margin: 0; }
.es-title p { margin: 2px 0 0; color: #5d7680; font-size: 14px; }
.es-bottom, .es-dim { display: none; }

/* ---------- phones and small tablets ---------- */
@media (max-width: 900px) {
  .es-side { top: 0; bottom: 0; left: 0; border-radius: 0 28px 28px 0; width: min(300px, 86vw); transform: translateX(-105%); transition: transform .25s ease; }
  .es-side.open { transform: none; }
  .es-close { display: grid; }
  .es-dim { display: block; position: fixed; inset: 0; z-index: 35; background: rgba(14,42,51,.3); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
  .es-main { margin-left: 0; }
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

'use client';
// Logged-in area: login check, glass sidebar (collapses to icons, expands on hover), glass header,
// and the shared UI styles (buttons, cards, tables, badges, inputs) used by every page.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LuBan, LuBell, LuCheck, LuFileSpreadsheet, LuKanban, LuLayoutDashboard, LuLogOut, LuMenu, LuReply, LuSend, LuSettings, LuUserCog, LuUsers, LuX } from 'react-icons/lu';
import { api, getToken, setRole, setToken } from '@/lib/api';

const ICON = process.env.NEXT_PUBLIC_LOGO_ICON_URL || '/fav.png'; // square logo (always shown)
const WORDMARK = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || '/logo.png'; // brand name, next to the logo when the sidebar opens
const MENU = [
  ['/', 'Dashboard', LuLayoutDashboard],
  ['/contacts', 'Contacts', LuUsers],
  ['/pipeline', 'Pipeline', LuKanban],
  ['/team', 'Team', LuUserCog],
  ['/import', 'Import', LuFileSpreadsheet],
  ['/campaigns', 'Campaigns', LuSend],
  ['/replies', 'Replies', LuReply],
  ['/settings', 'Settings', LuSettings],
];

export default function AppLayout({ children }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [notes, setNotes] = useState(null);
  const [noteCount, setNoteCount] = useState(0);
  const [now, setNow] = useState(0);
  const bellRef = useRef(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api('/api/auth/me')
      .then((r) => {
        setRole(r.role);
        if (r.role !== 'admin') router.replace('/portal'); // team members & clients have their own page
        else setUser(r.user);
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  // badges: new replies (sidebar) + unread notifications (bell). Refresh on page change and every 60 s.
  useEffect(() => {
    if (!getToken()) return undefined;
    const refresh = () => {
      api('/api/settings').then((s) => setUnread(s.unhandled || 0)).catch(() => {});
      api('/api/notifications').then((n) => setNoteCount(n.unread || 0)).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [path]);

  useEffect(() => {
    if (!bellOpen) return undefined;
    const onDown = (e) => bellRef.current && !bellRef.current.contains(e.target) && setBellOpen(false);
    const onKey = (e) => e.key === 'Escape' && setBellOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bellOpen]);

  useEffect(() => {
    let t;
    const show = (e) => {
      setToast(e.detail);
      clearTimeout(t);
      t = setTimeout(() => setToast(null), 3500);
    };
    window.addEventListener('geek-toast', show);
    return () => window.removeEventListener('geek-toast', show);
  }, []);

  // bell = everything that happened: emails sent, replies, unsubscribes, bounces, failures
  const loadNotes = () =>
    api('/api/notifications')
      .then((n) => {
        setNow(Date.now());
        setNotes(n.items);
        setNoteCount(n.unread);
      })
      .catch(() => setNotes([]));
  const toggleBell = () => {
    if (!bellOpen) loadNotes();
    setBellOpen(!bellOpen);
  };
  const markRead = async (id) => {
    await api(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
    loadNotes();
  };
  const markAll = async () => {
    await api('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
    loadNotes();
  };
  const step = (n) => (!n || n <= 1 ? 'First email' : `Follow-up ${n - 1}`);
  const noteView = (n) => {
    const who = n.name || 'Someone';
    switch (n.type) {
      case 'sent': return { icon: LuSend, title: `${step(n.step)} sent to ${who}`, href: n.campaign ? `/campaigns?open=${n.campaign._id}` : '/campaigns' };
      case 'replied': return { icon: LuReply, title: `${who} replied`, href: '/replies', extra: 'Follow-ups stopped' };
      case 'unsubscribed': return { icon: LuBan, title: `${who} unsubscribed`, href: '/contacts', extra: 'Will never be emailed again' };
      case 'bounced': return { icon: LuX, title: `Email to ${who} bounced`, href: '/contacts', extra: 'Address blocked' };
      default: return { icon: LuX, title: `Couldn't send ${step(n.step).toLowerCase()} to ${who}`, href: n.campaign ? `/campaigns?open=${n.campaign._id}` : '/settings' };
    }
  };
  const ago = (d) => {
    const m = Math.round((now - new Date(d)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} hr ago`;
    return `${Math.round(m / 1440)} d ago`;
  };

  const logout = () => {
    setToken(null);
    setRole(null);
    router.replace('/login');
  };

  if (!user) return <div className="loading"><style>{css}</style><span className="spinner" /></div>;

  const isActive = (href) => (href === '/' ? path === '/' : path.startsWith(href));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="shell">
      <style>{css}</style>
      <div className="bg" aria-hidden="true"><i /><i /><i /><i /></div>

      <aside className={`side ${menuOpen ? 'open' : ''}`}>
        <div className="side-brand">
          {/* Agency logo: public/fav.png */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ICON} alt="Geek" className="brand-icon" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={WORDMARK} alt="" className="brand-name" />
          <button className="side-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><LuX /></button>
        </div>
        <nav>
          {MENU.map(([href, label, Icon]) => (
            <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={isActive(href) ? 'active' : ''}>
              <span className="nav-ico"><Icon /></span>
              <span className="nav-label">{label}</span>
              {href === '/replies' && unread > 0 && <em className="nav-badge">{unread}</em>}
            </Link>
          ))}
        </nav>
        <span className="side-line" />
        <button className="side-logout" onClick={logout}>
          <span className="nav-ico"><LuLogOut /></span>
          <span className="nav-label">Log out</span>
        </button>
      </aside>
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}

      <div className="main">
        <header className="top">
          <div className="top-inner">
            <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menu"><LuMenu /></button>
            <div className="top-title">
              <small>{today}</small>
              <b>{greeting}, {user}</b>
            </div>
            <div className="top-right">
              <div className="bell-wrap" ref={bellRef}>
                <button className={`top-bell ${bellOpen ? 'on' : ''}`} onClick={toggleBell} aria-label="Notifications" aria-expanded={bellOpen}>
                  <LuBell />
                  {noteCount > 0 && <i>{noteCount > 99 ? '99+' : noteCount}</i>}
                </button>
                {bellOpen && (
                  <div className="bell-menu" role="dialog" aria-label="Notifications">
                    <div className="bell-head">
                      <b>Notifications</b>
                      {noteCount > 0 && <button onClick={markAll}>Mark all as read</button>}
                    </div>
                    <div className="bell-list">
                      {!notes ? (
                        <p className="bell-empty">Loading…</p>
                      ) : notes.length === 0 ? (
                        <p className="bell-empty">Nothing yet. Sent emails, replies and unsubscribes will show here.</p>
                      ) : (
                        notes.map((n) => {
                          const v = noteView(n);
                          const Icon = v.icon;
                          return (
                            <div key={n._id} className={`bell-item ${n.read ? 'read' : ''}`}>
                              <span className={`bell-avatar t-${n.type}`}><Icon /></span>
                              <Link href={v.href} className="bell-text" onClick={() => { setBellOpen(false); if (!n.read) markRead(n._id); }}>
                                <b>{v.title}</b>
                                {(n.text || v.extra) && <span>{n.text || v.extra}</span>}
                                <small>{ago(n.createdAt)}{n.campaign?.name ? ` · ${n.campaign.name}` : ''}</small>
                              </Link>
                              {!n.read && <button className="bell-done" onClick={() => markRead(n._id)} title="Mark as read" aria-label="Mark as read"><LuCheck /></button>}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="top-user">
                <span className="avatar">{user.slice(0, 2).toUpperCase()}</span>
                <div className="top-user-text">
                  <b>{user}</b>
                  <small>Admin</small>
                </div>
              </div>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}

const css = `
/* ================= Theme: #32c1df + white, frosted glass ================= */
:root {
  --c: #32c1df;            /* brand cyan */
  --c-600: #1aa9c8;        /* hover / pressed */
  --c-700: #0b87a5;        /* cyan text & links (readable on white) */
  --c-50: rgba(50, 193, 223, .08);
  --c-100: rgba(50, 193, 223, .14);
  --c-200: rgba(50, 193, 223, .28);
  --c-glow: rgba(50, 193, 223, .35);
  --glass: rgba(255, 255, 255, .68);
  --glass-strong: rgba(255, 255, 255, .82);
  --glass-border: rgba(255, 255, 255, .95);
  --glass-shadow: 0 1px 2px rgba(11, 60, 75, .04), 0 10px 32px rgba(11, 60, 75, .06);
  --line: rgba(11, 60, 75, .08);
  --blur: blur(24px) saturate(180%);
  --primary: var(--c);
  --text: #0e2a33;
  --muted: #5d7680;
  --side: 72px;
  --side-open: 220px;
}
body { background: #f3fbfd; color: var(--text); }
.loading { min-height: 100vh; display: grid; place-items: center; }
.spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--c-100); border-top-color: var(--c); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* soft cyan light behind the glass */
.bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; background: linear-gradient(180deg, #f7fdfe 0%, #eef8fb 100%); }
.bg i { position: absolute; border-radius: 50%; filter: blur(110px); }
.bg i:nth-child(1) { width: 640px; height: 640px; background: rgba(50, 193, 223, .22); top: -280px; right: 4%; }
.bg i:nth-child(2) { width: 520px; height: 520px; background: rgba(50, 193, 223, .14); bottom: -260px; left: 12%; }
.bg i:nth-child(3) { width: 380px; height: 380px; background: rgba(50, 193, 223, .30); top: 18%; left: -120px; filter: blur(80px); }
.bg i:nth-child(4) { width: 300px; height: 300px; background: rgba(120, 220, 240, .28); bottom: 6%; left: 30px; filter: blur(70px); }

.shell { min-height: 100vh; }

/* shared frosted glass panel (sidebar, header) - real "liquid glass":
   see-through tint, strong blur, light sheen on top, bright rim, cyan edge glow */
.side, .top-inner {
  position: relative; isolation: isolate;
  background: linear-gradient(135deg, rgba(255, 255, 255, .55) 0%, rgba(255, 255, 255, .28) 45%, rgba(50, 193, 223, .12) 100%);
  backdrop-filter: blur(22px) saturate(200%) brightness(1.06); -webkit-backdrop-filter: blur(22px) saturate(200%) brightness(1.06);
  border: 1px solid rgba(255, 255, 255, .75);
  box-shadow:
    0 20px 50px rgba(11, 60, 75, .12),
    0 2px 6px rgba(11, 60, 75, .05),
    inset 0 1px 0 rgba(255, 255, 255, .95),
    inset 0 -1px 0 rgba(50, 193, 223, .18),
    inset 0 0 0 1px rgba(50, 193, 223, .1),
    inset 0 0 30px rgba(255, 255, 255, .25);
}
/* glossy sheen across the top */
.side::before, .top-inner::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1;
  background: linear-gradient(180deg, rgba(255, 255, 255, .7) 0%, rgba(255, 255, 255, .15) 38%, rgba(255, 255, 255, 0) 60%);
}
/* soft cyan light reflected on the edge */
.side::after, .top-inner::after {
  content: ""; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none; z-index: -1; padding: 1px;
  background: linear-gradient(160deg, rgba(255, 255, 255, .9), rgba(50, 193, 223, .45) 45%, rgba(255, 255, 255, .6) 70%, rgba(50, 193, 223, .35));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
}

/* ---------- sidebar: icons only, expands on hover ---------- */
.side {
  position: fixed; left: 16px; top: 16px; bottom: 16px; width: var(--side); z-index: 30; overflow: hidden;
  border-radius: 36px; padding: 12px; display: flex; flex-direction: column; gap: 8px;
  transition: width .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s;
}
.side:hover { width: var(--side-open); background: linear-gradient(135deg, rgba(255, 255, 255, .66) 0%, rgba(255, 255, 255, .38) 45%, rgba(50, 193, 223, .16) 100%); }
.side-brand { position: relative; display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 4px; margin-bottom: 6px; }
.brand-icon { width: 44px; height: 44px; border-radius: 13px; flex-shrink: 0; object-fit: contain; background: #fff; box-shadow: 0 8px 18px rgba(50, 193, 223, .25); }
.brand-name { height: 30px; width: auto; max-width: 120px; object-fit: contain; flex-shrink: 0; opacity: 0; transition: opacity .18s; }
.side:hover .brand-name, .side.open .brand-name { opacity: 1; }
.side-close { display: none; }
.side nav { display: flex; flex-direction: column; gap: 8px; }
.side nav a, .side-logout {
  position: relative; display: flex; align-items: center; gap: 14px; height: 48px; padding: 0 12px; border-radius: 16px;
  color: #4b6873; font-weight: 500; font-size: 14.5px; white-space: nowrap; border: 0; background: none; cursor: pointer; width: 100%;
  transition: background .2s, color .2s, box-shadow .2s;
}
.side nav a:hover, .side-logout:hover { background: var(--c-100); color: var(--c-700); }
.side nav a.active {
  color: #fff; background: linear-gradient(150deg, #5fd3eb 0%, #32c1df 55%, #1aa9c8 100%);
  box-shadow: 0 10px 24px var(--c-glow), inset 0 1px 0 rgba(255, 255, 255, .45);
}
.nav-ico { width: 24px; height: 24px; display: grid; place-items: center; flex-shrink: 0; font-size: 21px; }
.nav-label { opacity: 0; transition: opacity .18s; }
.side:hover .nav-label, .side.open .nav-label { opacity: 1; }
.nav-badge { position: absolute; left: 28px; top: 6px; font-style: normal; background: #ff3b5c; color: #fff; font-size: 10px; font-weight: 700; min-width: 17px; height: 17px; border-radius: 9px; display: grid; place-items: center; padding: 0 4px; border: 2px solid #fff; }
.side:hover .nav-badge, .side.open .nav-badge { position: static; margin-left: auto; border: 0; }
.side-line { height: 1px; background: var(--line); margin: auto 8px 6px; flex-shrink: 0; }
.side-logout { color: #7b939c; }
.side-logout:hover { color: #e11d48; background: rgba(225, 29, 72, .08); }
.backdrop { position: fixed; inset: 0; background: rgba(14, 42, 51, .2); backdrop-filter: blur(4px); z-index: 25; }

/* ---------- main + header ---------- */
.main { margin-left: calc(var(--side) + 40px); min-width: 0; transition: margin-left .3s cubic-bezier(.2,.8,.2,1); }
.side:hover ~ .main { margin-left: calc(var(--side-open) + 40px); }
.top { position: sticky; top: 0; z-index: 20; padding: 16px 16px 0 0; }
.top-inner { height: 68px; padding: 0 12px 0 22px; display: flex; align-items: center; gap: 14px; border-radius: 26px; }
.top-title { display: flex; flex-direction: column; line-height: 1.25; }
.top-title small { color: var(--muted); font-size: 12px; font-weight: 500; }
.top-title b { color: var(--text); font-size: 18px; font-weight: 600; letter-spacing: -.01em; }
.top-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.top-bell { position: relative; width: 44px; height: 44px; border-radius: 15px; display: grid; place-items: center; font-size: 20px; color: #d9a521; background: rgba(245, 196, 81, .14); border: 1px solid rgba(245, 196, 81, .3); cursor: pointer; transition: background .2s, color .2s, box-shadow .2s; }
.top-bell svg { filter: drop-shadow(0 0 5px rgba(245, 196, 81, .5)); }
.top-bell:hover, .top-bell.on { background: rgba(245, 196, 81, .24); box-shadow: 0 6px 16px rgba(245, 196, 81, .3); }
.top-bell:focus { outline: none; }
.top-bell:focus-visible { outline: 2px solid var(--c); outline-offset: 2px; }
.top-bell i { position: absolute; top: -3px; right: -3px; font-style: normal; background: #ff3b5c; color: #fff; font-size: 10px; font-weight: 700; min-width: 17px; height: 17px; border-radius: 9px; display: grid; place-items: center; padding: 0 4px; border: 2px solid #fff; }

/* notification dropdown */
.bell-wrap { position: relative; }
.bell-menu {
  position: absolute; right: 0; top: calc(100% + 12px); width: 370px; max-width: calc(100vw - 32px); z-index: 40;
  background: rgba(255, 255, 255, .97); /* nearly solid: a glass layer inside the glass header can't blur behind it */
  border: 1px solid var(--c-100); border-radius: 22px; box-shadow: 0 24px 60px rgba(11, 60, 75, .18);
  color: var(--text); overflow: hidden; transform-origin: top right; animation: bellIn .18s cubic-bezier(.2,.8,.2,1);
}
@keyframes bellIn { from { opacity: 0; transform: translateY(-6px) scale(.97); } }
@media (prefers-reduced-motion: reduce) { .bell-menu { animation: none; } }
.bell-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 10px; border-bottom: 1px solid var(--line); }
.bell-head b { font-size: 15px; font-weight: 600; }
.bell-head button { background: none; border: 0; color: var(--c-700); font-size: 12.5px; font-weight: 600; cursor: pointer; }
.bell-head button:hover { text-decoration: underline; }
.bell-list { max-height: min(460px, calc(100vh - 160px)); overflow-y: auto; overscroll-behavior: contain; padding: 8px; scrollbar-width: thin; scrollbar-color: var(--c-200) transparent; }
.bell-list::-webkit-scrollbar { width: 6px; }
.bell-list::-webkit-scrollbar-thumb { background: var(--c-200); border-radius: 3px; }
.bell-empty { padding: 22px 12px 26px; text-align: center; color: var(--muted); font-size: 13.5px; }
.bell-item { position: relative; display: flex; align-items: flex-start; gap: 12px; padding: 10px 10px 10px 14px; border-radius: 14px; transition: background .15s; }
.bell-item:hover { background: var(--c-50); }
.bell-item:not(.read)::before { content: ""; position: absolute; left: 4px; top: 25px; width: 6px; height: 6px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px var(--c-100); }
.bell-item.read { opacity: .6; }
.bell-item.read:hover { opacity: .9; }
.bell-avatar { width: 34px; height: 34px; border-radius: 11px; flex-shrink: 0; display: grid; place-items: center; font-size: 16px; background: var(--c-100); color: var(--c-700); }
.bell-avatar.t-replied { background: rgba(22, 163, 74, .12); color: #15803d; }
.bell-avatar.t-unsubscribed, .bell-avatar.t-bounced, .bell-avatar.t-failed { background: rgba(225, 29, 72, .1); color: #e11d48; }
.bell-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.bell-text b { font-size: 13.5px; font-weight: 600; }
.bell-text span { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.bell-text small { font-size: 11.5px; color: #8aa1a9; }
.bell-done { width: 30px; height: 30px; flex-shrink: 0; border-radius: 10px; border: 0; background: var(--c-50); color: var(--c-700); display: grid; place-items: center; cursor: pointer; font-size: 15px; transition: background .15s, color .15s; }
.bell-done:hover { background: var(--c); color: #fff; }

.top-user { display: flex; align-items: center; gap: 10px; padding: 5px 16px 5px 5px; border-radius: 17px; background: rgba(255, 255, 255, .75); border: 1px solid var(--c-100); }
.top-user b { display: block; font-size: 13.5px; color: var(--text); font-weight: 600; }
.top-user small { color: var(--muted); font-size: 11.5px; }
.avatar { width: 34px; height: 34px; border-radius: 12px; background: linear-gradient(150deg, #5fd3eb, #32c1df 55%, #1aa9c8); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 12.5px; box-shadow: 0 6px 14px var(--c-glow); }
.menu-btn { display: none; width: 42px; height: 42px; border-radius: 14px; border: 1px solid var(--c-100); background: rgba(255, 255, 255, .8); color: var(--c-700); font-size: 20px; place-items: center; cursor: pointer; }

/* every page: max width 1400px, 32px side padding (20px on mobile) */
.content { width: 100%; max-width: 1400px; margin: 0 auto; padding: 24px 32px 40px; display: flex; flex-direction: column; gap: 22px; }

/* ---------- shared UI used by all pages ---------- */
.page-title { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.page-title h1 { font-size: 28px; font-weight: 700; letter-spacing: -.025em; color: var(--text); }
.page-title p { color: var(--muted); margin-top: 4px; }
.card {
  background: var(--glass); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--glass-border); border-radius: 24px; padding: 22px; box-shadow: var(--glass-shadow); min-width: 0;
  transition: border-color .25s, box-shadow .25s;
}
.card:hover { border-color: var(--c-200); box-shadow: 0 1px 2px rgba(11, 60, 75, .04), 0 14px 40px rgba(50, 193, 223, .14); }
.card h2 { font-size: 16px; font-weight: 600; margin-bottom: 14px; letter-spacing: -.01em; }
.muted { color: var(--muted); }
.small { font-size: 12.5px; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
a { transition: color .15s; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 18px; border-radius: 14px; border: 1px solid transparent; background: linear-gradient(150deg, #4fcde7, #32c1df 55%, #1fb0cf); color: #fff; font-weight: 600; cursor: pointer; white-space: nowrap; box-shadow: 0 8px 20px var(--c-glow), inset 0 1px 0 rgba(255, 255, 255, .35); transition: transform .15s, box-shadow .15s, filter .15s; }
.btn:hover { transform: translateY(-1px); filter: brightness(.96); box-shadow: 0 12px 26px rgba(50, 193, 223, .45), inset 0 1px 0 rgba(255, 255, 255, .35); }
.btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.btn svg { font-size: 17px; }
.btn.ghost { background: rgba(255, 255, 255, .78); color: var(--text); border-color: var(--c-100); box-shadow: 0 2px 8px rgba(11, 60, 75, .05); filter: none; }
.btn.ghost:hover { background: #fff; color: var(--c-700); border-color: var(--c-200); box-shadow: 0 6px 18px rgba(50, 193, 223, .18); }
.btn.soft { background: var(--c-100); color: var(--c-700); box-shadow: none; }
.btn.soft:hover { background: var(--c-200); filter: none; }
.btn.red { background: #fff; color: #e11d48; border-color: rgba(225, 29, 72, .25); box-shadow: none; }
.btn.red:hover { background: #e11d48; color: #fff; filter: none; }
.btn.sm { padding: 7px 12px; font-size: 13px; border-radius: 11px; }

input, select, textarea { width: 100%; padding: 11px 13px; border: 1px solid rgba(11, 60, 75, .14); border-radius: 13px; background: rgba(255, 255, 255, .8); color: var(--text); outline: none; transition: border-color .15s, box-shadow .15s, background .15s; }
input:hover, select:hover, textarea:hover { border-color: var(--c-200); }
input:focus, select:focus, textarea:focus { border-color: var(--c); background: #fff; box-shadow: 0 0 0 4px var(--c-100); }
input[type=checkbox] { width: auto; accent-color: var(--c); }
textarea { resize: vertical; min-height: 100px; }
label.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: #3a5560; }

.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13.5px; }
th { text-align: left; font-size: 12.5px; color: var(--muted); font-weight: 500; background: var(--c-50); padding: 11px 12px; white-space: nowrap; }
th:first-child { border-radius: 12px 0 0 12px; }
th:last-child { border-radius: 0 12px 12px 0; }
td { padding: 13px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; transition: background .15s; }
tbody tr:hover td { background: var(--c-50); }
tr:last-child td { border-bottom: 0; }
td small { display: block; color: var(--muted); font-size: 12px; }

.badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 500; background: rgba(11, 60, 75, .05); color: #3a5560; text-transform: capitalize; white-space: nowrap; }
.badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #9db2b9; }
.badge.contacted, .badge.active { background: var(--c-100); color: var(--c-700); }
.badge.contacted::before, .badge.active::before { background: var(--c); }
.badge.replied::before, .badge.completed::before { background: #16a34a; }
.badge.unsubscribed::before, .badge.failed::before { background: #e11d48; }
.badge.bounced::before, .badge.paused::before { background: #f59e0b; }

.tabs { display: inline-flex; gap: 4px; padding: 4px; margin-bottom: 16px; border-radius: 14px; background: var(--c-50); border: 1px solid var(--c-100); overflow-x: auto; max-width: 100%; }
.tabs button { background: none; border: 0; border-radius: 11px; padding: 8px 14px; font-weight: 600; color: var(--muted); cursor: pointer; white-space: nowrap; text-transform: capitalize; transition: background .15s, color .15s; }
.tabs button:hover { color: var(--c-700); }
.tabs button.on { background: #fff; color: var(--c-700); box-shadow: 0 2px 10px rgba(50, 193, 223, .18); }

.empty { text-align: center; padding: 36px 10px; color: var(--muted); }
.toast { position: fixed; right: 20px; bottom: 20px; background: rgba(255, 255, 255, .95); color: var(--text); border: 1px solid var(--c-200); border-left: 4px solid var(--c); padding: 13px 18px; border-radius: 16px; z-index: 50; max-width: calc(100vw - 40px); box-shadow: 0 16px 40px rgba(11, 60, 75, .16); }
.toast.error { border-left-color: #e11d48; }

/* ---------- mobile ---------- */
@media (max-width: 900px) {
  .side { top: 0; left: 0; bottom: 0; max-height: none; border-radius: 0 30px 30px 0; width: var(--side-open); transform: translateX(-110%); transition: transform .25s; }
  .side:hover { width: var(--side-open); }
  .side.open { transform: none; }
  .side .brand-name, .side .nav-label { opacity: 1; }
  .side-close { display: grid; place-items: center; position: absolute; right: 0; width: 36px; height: 36px; border-radius: 12px; border: 0; background: var(--c-100); color: var(--c-700); font-size: 18px; cursor: pointer; }
  .side-line { margin-top: auto; }
  .main, .side:hover ~ .main { margin-left: 0; }
  .menu-btn { display: grid; }
  .top { padding: 12px 20px 0; }
  .top-inner { height: 60px; padding: 0 8px 0 8px; border-radius: 22px; }
  .top-title small { display: none; }
  .top-title b { font-size: 17px; }
  .top-user { padding: 4px; }
  .top-user-text { display: none; }
  .content { padding: 18px 20px 30px; gap: 16px; }
  .card { padding: 16px; border-radius: 20px; }
  .page-title h1 { font-size: 22px; }
  .page-title .btn { flex: 1; }

  /* tables with className="cards" turn into cards on phones (td needs data-label) */
  table.cards thead { display: none; }
  table.cards, table.cards tbody, table.cards tr, table.cards td { display: block; width: 100%; }
  table.cards tr { background: rgba(255, 255, 255, .6); border: 1px solid var(--c-100); border-radius: 16px; padding: 4px 14px; margin-bottom: 10px; }
  table.cards td { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px dashed var(--line); text-align: right; }
  table.cards td:last-child { border-bottom: 0; }
  table.cards td::before { content: attr(data-label); font-size: 12px; font-weight: 600; color: var(--muted); text-align: left; }
  table.cards td:first-child { display: block; text-align: left; }
  table.cards td:first-child::before { content: none; }
  tbody tr:hover td { background: transparent; }
}
`;

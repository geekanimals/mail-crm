'use client';
// Login page - ID & password are checked by the backend against ADMIN_USERNAME / ADMIN_PASSWORD in .env
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LuBan, LuEye, LuEyeOff, LuLock, LuReply, LuRefreshCw, LuSend, LuUser } from 'react-icons/lu';
import { api, setToken } from '@/lib/api';

const LOGO = process.env.NEXT_PUBLIC_LOGO_URL || '/fav.png';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: '', password: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: form });
      setToken(r.token);
      router.replace('/');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <style>{css}</style>
      <section className="login-left">
        <h2>Follow-ups that run themselves.<br /><span>Stop the moment they reply.</span></h2>
        <ul>
          <li><i><LuSend /></i> Send from your own mailbox</li>
          <li><i><LuRefreshCw /></i> Automatic follow-ups in the same thread</li>
          <li><i><LuReply /></i> Reply detected → follow-ups stop</li>
          <li><i><LuBan /></i> One-click unsubscribe</li>
        </ul>
      </section>

      <section className="login-right">
        <form onSubmit={submit} className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="Logo" className="login-logo" />
          <h1>Welcome to Geek</h1>
          <p>Sign in with your Geek ID</p>
          {error && <div className="login-error">{error}</div>}
          <label>
            Geek ID
            <div className="inp"><LuUser />
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" required autoFocus />
            </div>
          </label>
          <label>
            Password
            <div className="inp pass"><LuLock />
              <input type={show ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" required />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <LuEyeOff /> : <LuEye />}</button>
            </div>
          </label>
          <button className="login-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to Geek'}</button>
        </form>
      </section>
    </div>
  );
}

const css = `
.login { position: relative; min-height: 100vh; display: grid; grid-template-columns: 1.1fr 1fr; overflow: hidden; background: linear-gradient(150deg, #e9f9fd 0%, #ffffff 55%, #e3f6fb 100%); color: #0e2a33; }
.login::before, .login::after { content: ""; position: absolute; border-radius: 50%; filter: blur(90px); }
.login::before { width: 560px; height: 560px; background: rgba(50,193,223,.35); top: -180px; left: -140px; }
.login::after { width: 480px; height: 480px; background: rgba(50,193,223,.22); bottom: -200px; right: 8%; }
.login-left { position: relative; z-index: 1; padding: 64px; display: flex; flex-direction: column; justify-content: center; }
.login-left h2 { font-size: 40px; line-height: 1.15; letter-spacing: -.02em; color: #0e2a33; }
.login-left h2 span { color: #0b87a5; }
.login-left ul { list-style: none; margin-top: 34px; display: flex; flex-direction: column; gap: 14px; font-size: 16px; color: #3a5560; }
.login-left li { display: flex; align-items: center; gap: 12px; }
.login-left li i { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; font-size: 18px; color: #0b87a5; background: rgba(255,255,255,.7); border: 1px solid rgba(50,193,223,.25); backdrop-filter: blur(10px); }
.login-right { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; padding: 32px; }
.login-card { width: 100%; max-width: 410px; background: rgba(255,255,255,.72); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%); border: 1px solid rgba(255,255,255,.95); border-radius: 28px; padding: 34px 30px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 30px 80px rgba(11,60,75,.14), inset 0 1px 0 #fff, inset 0 0 0 1px rgba(50,193,223,.1); }
.login-logo { width: 64px; height: 64px; object-fit: contain; align-self: flex-start; border-radius: 18px; box-shadow: 0 10px 24px rgba(50,193,223,.25); }
.login-card h1 { font-size: 26px; letter-spacing: -.02em; }
.login-card p { color: #5d7680; margin-top: -10px; }
.login-card label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: #3a5560; }
.inp { position: relative; display: flex; align-items: center; }
.inp > svg { position: absolute; left: 13px; color: #8aa1a9; font-size: 18px; pointer-events: none; }
.login-card input { width: 100%; padding: 12px 44px 12px 40px; border: 1px solid rgba(11,60,75,.14); border-radius: 14px; background: rgba(255,255,255,.85); outline: none; transition: border-color .15s, box-shadow .15s; }
.login-card input:hover { border-color: rgba(50,193,223,.4); }
.login-card input:focus { border-color: #32c1df; background: #fff; box-shadow: 0 0 0 4px rgba(50,193,223,.15); }
.pass button { position: absolute; right: 8px; border: 0; background: none; color: #5d7680; padding: 6px; font-size: 18px; cursor: pointer; display: grid; }
.pass button:hover { color: #0b87a5; }
.login-btn { background: linear-gradient(150deg, #4fcde7, #32c1df 55%, #1fb0cf); color: #fff; border: 0; border-radius: 14px; padding: 13px; font-weight: 600; font-size: 15px; cursor: pointer; box-shadow: 0 10px 24px rgba(50,193,223,.4), inset 0 1px 0 rgba(255,255,255,.35); transition: transform .15s, box-shadow .15s; }
.login-btn:hover { transform: translateY(-1px); box-shadow: 0 14px 30px rgba(50,193,223,.5), inset 0 1px 0 rgba(255,255,255,.35); }
.login-btn:disabled { opacity: .6; transform: none; }
.login-error { background: rgba(225,29,72,.08); color: #9f1239; padding: 10px 12px; border-radius: 12px; font-size: 13.5px; }
@media (max-width: 900px) {
  .login { grid-template-columns: 1fr; }
  .login-left { display: none; }
  .login-right { padding: 24px 20px; }
}
`;

import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, Info, ChevronDown } from 'lucide-react';
import { useDrive, useMe, SIGNOUT_REASON_KEY } from '../store/DriveStore';
import { checkPassword, twoFactorOn, twoFactorMissing, securityOf } from '../store/account';
import { verifyTotp } from '../utils/totp';
import { useT } from '../i18n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;
const COUNTRY_CODES = ['+63', '+91', '+1', '+44', '+61', '+65', '+971'];

import { safeNext } from '../utils/safeNext';

export { safeNext };

/** Fills {placeholders} in a translated sentence with React nodes. */
function withNodes(text, nodes) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const k = part.match(/^\{(\w+)\}$/)?.[1];
    return k && nodes[k] !== undefined ? <Fragment key={i}>{nodes[k]}</Fragment> : part;
  });
}

/** Glass folder holding files, a cloud-upload badge and floating file-type tokens. */
function DriveIllustration({ label }) {
  return (
    <svg className="login-illus" viewBox="0 0 420 340" role="img" aria-label={label}>
      <defs>
        <linearGradient id="lg-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#8cc6f0" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="lg-back" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e3f1fc" />
          <stop offset="1" stopColor="#5fb0ea" />
        </linearGradient>
        <linearGradient id="lg-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#bfe0f8" />
          <stop offset="1" stopColor="#1686d9" />
        </linearGradient>
        <linearGradient id="lg-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f5f6" />
          <stop offset="1" stopColor="#c4c8cc" />
        </linearGradient>
        <filter id="lg-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <linearGradient id="lg-core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3aa0ec" /><stop offset="1" stopColor="#0f5fa0" /></linearGradient>
        <linearGradient id="lg-teal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5eead4" /><stop offset="1" stopColor="#0ea5a4" /></linearGradient>
        <linearGradient id="lg-orange" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fdba74" /><stop offset="1" stopColor="#ea7a1a" /></linearGradient>
        <linearGradient id="lg-violet" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a5b4fc" /><stop offset="1" stopColor="#6366f1" /></linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="210" cy="300" rx="120" ry="12" fill="#1686d9" opacity="0.25" filter="url(#lg-soft)" />

      {/* orbit ring (back half) */}
      <path d="M48 214 A170 52 -10 0 1 372 156" fill="none" stroke="#c9ccd1" strokeWidth="1.6" />

      {/* folder back with tab */}
      <path d="M98 96 h66 a8 8 0 0 1 6 3 l14 15 h128 a12 12 0 0 1 12 12 v150 a12 12 0 0 1 -12 12 H98 a12 12 0 0 1 -12 -12 V108 a12 12 0 0 1 12 -12z"
        fill="url(#lg-back)" stroke="#1686d9" strokeWidth="2" />

      {/* documents sticking out */}
      <g className="li-doc-a"><g transform="rotate(-9 160 140)">
        <rect x="118" y="88" width="96" height="120" rx="9" fill="url(#lg-metal)" stroke="#b3b8bd" strokeWidth="1.5" />
        <rect x="132" y="106" width="52" height="7" rx="3.5" fill="#9aa1ab" />
        <rect x="132" y="122" width="68" height="5" rx="2.5" fill="#c4c8cc" />
        <rect x="132" y="134" width="60" height="5" rx="2.5" fill="#c4c8cc" />
      </g></g>
      <g className="li-doc-b"><g transform="rotate(7 250 130)">
        <rect x="204" y="78" width="100" height="124" rx="9" fill="#ffffff" stroke="#c4c8cc" strokeWidth="1.5" />
        <rect x="218" y="94" width="40" height="30" rx="5" fill="#bfe0f8" />
        <path d="M222 120 l10 -12 l8 8 l6 -6 l10 10z" fill="#0f66a8" />
        <rect x="218" y="134" width="70" height="5" rx="2.5" fill="#d5d9de" />
        <rect x="218" y="146" width="56" height="5" rx="2.5" fill="#d5d9de" />
      </g></g>

      {/* glass front panel */}
      <path d="M78 150 h264 a10 10 0 0 1 9.8 12 l-18 118 a12 12 0 0 1 -11.8 10 H98 a12 12 0 0 1 -11.8 -10 l-18 -118 A10 10 0 0 1 78 150z"
        fill="url(#lg-glass)" stroke="#1686d9" strokeWidth="2" />
      <path d="M92 164 h236" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.9" />

      {/* center badge: cloud upload */}
      <circle className="li-pulse" cx="210" cy="222" r="40" fill="url(#lg-blue)" opacity="0.55" />
      <circle cx="210" cy="222" r="31" fill="url(#lg-core)" stroke="#bfe0f8" strokeWidth="5" />
      <path d="M196 229 h-3 a10 10 0 0 1 -1 -20 a14 14 0 0 1 27 -3 a9 9 0 0 1 8 15 a8 8 0 0 1 -5 8 h-3"
        fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path className="li-arrow" d="M210 236 v-17 M203 225 l7 -7 l7 7" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />

      {/* orbit ring (front half) */}
      <path d="M372 156 A170 52 -10 0 1 48 214" fill="none" stroke="#9aa1ab" strokeWidth="1.8" />
      <circle r="4.5" fill="#ffffff" stroke="#1686d9" strokeWidth="2">
        <animateMotion className="li-orbit" dur="9s" repeatCount="indefinite" path="M48 214 A170 52 -10 0 1 372 156 A170 52 -10 0 1 48 214" />
      </circle>

      {/* floating token: document */}
      <g className="li-float-a"><g transform="translate(318 46) rotate(14)">
        <ellipse cx="0" cy="3" rx="19" ry="20" fill="#0d9488" />
        <ellipse cx="0" cy="0" rx="19" ry="20" fill="url(#lg-teal)" stroke="#0d9488" strokeWidth="1.5" />
        <path d="M-6 -9 h8 l5 5 v13 h-13z" fill="#ffffff" />
        <path d="M-3 0 h7 M-3 4 h7" stroke="#0ea5a4" strokeWidth="1.6" strokeLinecap="round" />
      </g></g>

      {/* floating token: image (tilted coin) */}
      <g className="li-float-b"><g transform="translate(350 252) rotate(-28)">
        <ellipse cx="4" cy="2" rx="17" ry="27" fill="#c2410c" />
        <ellipse cx="0" cy="0" rx="17" ry="27" fill="url(#lg-orange)" stroke="#fed7aa" strokeWidth="3" />
        <rect x="-8" y="-9" width="16" height="18" rx="3" fill="none" stroke="#ffffff" strokeWidth="2" />
        <path d="M-6 6 l4 -5 l3 3 l2 -2 l4 4" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinejoin="round" />
      </g></g>

      {/* floating token: folder */}
      <g className="li-float-c"><g transform="translate(52 292) rotate(-12)">
        <ellipse cx="2" cy="3" rx="22" ry="21" fill="#4f46e5" />
        <ellipse cx="0" cy="0" rx="22" ry="21" fill="#ffffff" stroke="#6366f1" strokeWidth="3" />
        <circle cx="0" cy="0" r="14" fill="url(#lg-violet)" />
        <path d="M-8 -5 h6 l2 2 h8 v10 h-16z" fill="#ffffff" />
      </g></g>
    </svg>
  );
}

const AppleMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.37 12.62c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.27-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.66zM14.1 5.87c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28z" /></svg>
);
const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
  </svg>
);

export default function LoginView() {
  const { state, api } = useDrive();
  const me = useMe();
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [tab, setTab] = useState('email');
  const [email, setEmail] = useState(state.remember && me ? me.email : '');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [cc, setCc] = useState('+63');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(state.remember ?? true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  // Why the last session ended (inactivity / ended from another device), shown once.
  const [signoutReason] = useState(() => { try { return sessionStorage.getItem(SIGNOUT_REASON_KEY) || ''; } catch { return ''; } });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);
  const pwRef = useRef(null);
  const phoneRef = useRef(null);
  // Second step when 2FA is on: the 6-digit code from the authenticator app.
  const [step, setStep] = useState('password');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeFails, setCodeFails] = useState(0);
  const codeRef = useRef(null);

  useEffect(() => { (email ? pwRef : emailRef).current?.focus(); }, []); // eslint-disable-line
  useEffect(() => { document.title = `${t('Sign in')} · Bishnoi One WorkDrive`; }, [t]);

  const switchTab = (k) => {
    setTab(k); setErrors({}); setFormError(''); setNote('');
    setTimeout(() => (k === 'email' ? emailRef : phoneRef).current?.focus(), 0);
  };

  const submit = (ev) => {
    ev.preventDefault();
    if (busy) return;
    setFormError(''); setNote('');
    if (tab === 'phone') {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 7) { setErrors({ phone: t('Enter a valid phone number') }); phoneRef.current?.focus(); return; }
      setErrors({});
      setFormError(t('Phone sign-in isn’t enabled for your organization yet. Sign in with your email instead.'));
      return;
    }
    const e = {};
    if (!email.trim()) e.email = t('Enter your email address');
    else if (!EMAIL_RE.test(email.trim())) e.email = t('Enter a valid email address');
    if (!password) e.password = t('Enter your password');
    else if (password.length < MIN_PASSWORD) e.password = t('Password must be at least {n} characters', { n: MIN_PASSWORD });
    setErrors(e);
    if (e.email) { emailRef.current?.focus(); return; }
    if (e.password) { pwRef.current?.focus(); return; }
    setBusy(true);
    // Simulated network round-trip.
    setTimeout(() => {
      const account = state.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!account || account.id !== state.meId) {
        setBusy(false);
        setFormError(account
          ? t('Sign-in for this account isn’t available in this demo. Use the demo account.')
          : t('We couldn’t find an account with that email address.'));
        emailRef.current?.focus();
        return;
      }
      checkPassword(state, password).then((ok) => {
        if (!ok) {
          setBusy(false);
          setErrors({ password: t('Wrong password. Try again.') });
          api.logEvent('Sign-in failed', account.email, 'Wrong password');
          pwRef.current?.focus();
          return;
        }
        if (twoFactorOn(state)) {
          setBusy(false); setStep('code'); setCode(''); setCodeError('');
          setTimeout(() => codeRef.current?.focus(), 0);
          return;
        }
        finishSignIn();
      });
    }, 650);
  };

  /** Signed in. If the organization requires 2FA and it isn't set up yet, go straight to setting it up. */
  const finishSignIn = () => {
    const mustSetUp = twoFactorMissing(state);
    api.signIn({ remember });
    navigate(mustSetUp ? '/settings/security?setup=2fa' : next, { replace: true });
  };

  const submitCode = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    if (codeFails >= 5) { setCodeError(t('Too many wrong codes. Wait 30 seconds and try again.')); return; }
    if (!/^\d{6}$/.test(code)) { setCodeError(t('Enter the 6-digit code')); codeRef.current?.focus(); return; }
    setBusy(true);
    const ok = await verifyTotp(securityOf(state).totpSecret, code);
    setBusy(false);
    if (ok) { finishSignIn(); return; }
    const fails = codeFails + 1;
    setCodeFails(fails);
    if (fails >= 5) setTimeout(() => setCodeFails(0), 30_000);
    setCode('');
    setCodeError(t('That code isn’t right. Check your authenticator app and try again.'));
    api.logEvent('Sign-in failed', email.trim(), 'Wrong two-factor code');
    codeRef.current?.focus();
  };

  const fillDemo = () => {
    setTab('email');
    setEmail(me?.email || '');
    setPassword('demo1234');
    setErrors({}); setFormError(''); setNote('');
  };

  const sso = (name) => { setFormError(''); setNote(t('{name} sign-in isn’t connected for your organization yet. Use your email and password.', { name })); };

  const invalid = (name) => ({
    'aria-invalid': !!errors[name] || undefined,
    'aria-describedby': errors[name] ? `${name}-err` : undefined,
  });

  return (
    <div className="login-page">
      <aside className="login-hero">
        <div className="login-hero-inner">
          <DriveIllustration label={t('Files stored in a WorkDrive folder')} />
          <h2>{withNodes(t('Join {brand} WorkDrive'), { brand: <span className="login-accent">Bishnoi One</span> })}</h2>
          <div className="login-stats">
            <div><strong>100 GB</strong><span>{t('Max team storage')}</span></div>
            <div><strong>20+</strong><span>{t('Previewable file types')}</span></div>
            <div><strong>{t('6 Roles')}</strong><span>{t('Access levels')}</span></div>
          </div>
        </div>
      </aside>

      <main className="login-main">
        <div className="login-form-wrap">
          <div className="login-mobile-brand"><img src="/logo.png" alt="" /><span>Bishnoi One <strong>WorkDrive</strong></span></div>
          <h1>{t('Sign in to WorkDrive')}</h1>

          {step === 'code' ? (
            <form onSubmit={submitCode} noValidate className="login-code-step">
              <p className="login-code-help">{t('Open your authenticator app and enter the 6-digit code for WorkDrive.')}</p>
              <div className="login-field">
                <input ref={codeRef} className="login-input login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  placeholder="123456" aria-label={t('Authentication code')} value={code} aria-invalid={!!codeError} aria-describedby={codeError ? 'code-err' : undefined}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setCodeError(''); }} />
                {codeError && <span id="code-err" className="login-err">{codeError}</span>}
              </div>
              <button type="submit" className="login-submit" disabled={busy}>
                {busy ? <><Loader2 size={16} className="spin" /> {t('Checking…')}</> : t('Verify')}
              </button>
              <p className="login-alt"><button type="button" className="login-link" onClick={() => { setStep('password'); setPassword(''); setTimeout(() => pwRef.current?.focus(), 0); }}>{t('Back to sign in')}</button></p>
            </form>
          ) : (<>
          <div className="login-tabs" role="tablist" aria-label={t('Sign-in method')}>
            {[['email', t('Email')], ['phone', t('Phone')]].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => switchTab(k)}>
                {label}
                {tab === k && <svg className="login-squiggle" viewBox="0 0 40 6" aria-hidden="true"><path d="M1 4 Q 8 0 15 3 T 29 3 T 39 2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>}
              </button>
            ))}
          </div>

          {formError && <div className="login-alert" role="alert"><AlertCircle size={16} /><span>{formError}</span></div>}
          {!formError && signoutReason && (
            <div className="login-alert info" role="status"><Info size={16} /><span>{signoutReason === 'idle'
              ? t('You were signed out after {n} minutes of inactivity, as required by your organization.', { n: state.org.policies.sessionTimeout })
              : t('This session was signed out from another device or by your administrator.')}</span></div>
          )}
          {note && <div className="login-note" role="status"><Info size={15} /><span>{note}</span></div>}

          <form onSubmit={submit} noValidate>
            {tab === 'email' ? (
              <>
                <div className="login-field">
                  <input ref={emailRef} type="email" className="login-input" autoComplete="username" inputMode="email"
                    placeholder={t('Please enter your email address')} aria-label={t('Email address')} value={email}
                    onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors({ ...errors, email: undefined }); }} {...invalid('email')} />
                  {errors.email && <span id="email-err" className="login-err">{errors.email}</span>}
                </div>
                <div className="login-field">
                  <span className="login-pw">
                    <input ref={pwRef} type={showPw ? 'text' : 'password'} className="login-input" autoComplete="current-password"
                      placeholder={t('Please enter your password')} aria-label={t('Password')} value={password}
                      onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors({ ...errors, password: undefined }); }} {...invalid('password')} />
                    <button type="button" className="login-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t('Hide password') : t('Show password')} aria-pressed={showPw}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                  {errors.password && <span id="password-err" className="login-err">{errors.password}</span>}
                </div>
              </>
            ) : (
              <div className="login-field">
                <span className={`login-phone ${errors.phone ? 'bad' : ''}`}>
                  <span className="login-cc">
                    <select value={cc} onChange={(e) => setCc(e.target.value)} aria-label={t('Country code')}>
                      {COUNTRY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={12} />
                  </span>
                  <input ref={phoneRef} type="tel" className="login-input bare" autoComplete="tel-national" inputMode="tel"
                    placeholder={t('Please enter Phone Number')} aria-label={t('Phone number')} value={phone}
                    onChange={(e) => { setPhone(e.target.value); if (errors.phone) setErrors({}); }} {...invalid('phone')} />
                </span>
                {errors.phone && <span id="phone-err" className="login-err">{errors.phone}</span>}
              </div>
            )}

            <button type="button" className="login-more" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
              {t('Sign-in options')} <ChevronDown size={13} className={moreOpen ? 'flip' : ''} />
            </button>
            {moreOpen && (
              <div className="login-more-body">
                <label className="check-row"><input type="checkbox" className="cb" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('Keep me signed in')}</label>
                <button type="button" className="login-link" onClick={() => setNote(t('Passwords are managed by your organization. Ask your WorkDrive admin to reset yours.'))}>{t('Forgot password?')}</button>
              </div>
            )}

            {/* Links set by the admin (Admin Console → Organization); without them the line is left out. */}
            {state.org.termsUrl && state.org.privacyUrl && (
              <p className="login-terms">
                {withNodes(t('By signing in you agree to the {agreement} and {privacy}'), {
                  agreement: <a className="login-u" href={state.org.termsUrl} target="_blank" rel="noreferrer">{t('User Agreement')}</a>,
                  privacy: <a className="login-u" href={state.org.privacyUrl} target="_blank" rel="noreferrer">{t('Privacy Policy')}</a>,
                })}
              </p>
            )}

            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? <><Loader2 size={16} className="spin" /> {t('Signing in…')}</> : t('Sign In')}
            </button>
          </form>

          <p className="login-alt">
            {t('New to WorkDrive?')} <button type="button" className="login-link" onClick={fillDemo}>{t('Use demo account')}</button>
          </p>

          <div className="login-divider"><span>{t('Or sign in with')}</span></div>
          <div className="login-sso">
            <button type="button" onClick={() => sso('Apple')} aria-label={t('Sign in with {name}', { name: 'Apple' })}><AppleMark /></button>
            <button type="button" onClick={() => sso('Google')} aria-label={t('Sign in with {name}', { name: 'Google' })}><GoogleMark /></button>
          </div>
          </>)}
        </div>
      </main>
    </div>
  );
}

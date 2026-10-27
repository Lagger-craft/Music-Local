import { useState, type FormEvent } from 'react';

interface LoginScreenProps {
  onLogin: (username: string, password: string) => Promise<string | null>;
}

/** Retro login card: same plastic body, cassette window and LCD as the deck. */
export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await onLogin(username, password);
    if (message) setError(message);
    setBusy(false);
  };

  return (
    <main className="layout layout-center">
      <section className="deck login-deck" aria-label="Login">
        <div className="brand">
          <span>Tape-o-matic 3000</span>
          <span>Stereo / Dolby-ish</span>
        </div>

        <div className="cassette" aria-hidden="true">
          <div className="reel" />
          <div className="reel slow" />
          <div className="tape" />
        </div>

        <div className="lcd">
          <div className="now">STOP &#9632; INSERT CREDENTIALS</div>
          <div className="marquee-static">
            Local tape library — single user access only ...
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
            {busy ? 'POWERING ON...' : 'POWER ON'}
          </button>
        </form>
      </section>
    </main>
  );
}

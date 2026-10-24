'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

export default function SettingsPage() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const loadMe = useCallback(async () => {
    const res = await fetch('/api/auth/me');
    if (res.status === 401) {
      setUnauthorized(true);
      return;
    }
    const body = (await res.json()) as { hasPersonalKey?: boolean };
    setHasKey(Boolean(body.hasPersonalKey));
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const res = await fetch('/api/me/key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: keyInput })
    });
    if (res.status === 201) {
      setNotice('Personal key saved — it will be used for your AI features.');
      setKeyInput('');
      await loadMe();
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? `Save failed (${res.status})`);
  }

  async function handleClear() {
    setError(null);
    setNotice(null);
    const res = await fetch('/api/me/key', { method: 'DELETE' });
    if (res.ok) {
      setNotice('Personal key removed — the owner key will be used.');
      await loadMe();
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? `Remove failed (${res.status})`);
  }

  if (unauthorized) {
    return (
      <main>
        <h1>Settings</h1>
        <p>
          Please <a href="/login">log in</a> first.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Settings</h1>
      <p>Bring your own Groq key. It is stored encrypted and used only for your account&apos;s AI features.</p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {hasKey === null ? <p>Loading…</p> : hasKey ? <p>Personal key configured.</p> : <p>Using the default key.</p>}

      <form onSubmit={handleSave} aria-label="Save personal key">
        <label htmlFor="llm-key">Groq API key</label>
        <input
          id="llm-key"
          type="password"
          required
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          autoComplete="off"
          placeholder="gsk_…"
        />
        <button type="submit">Save key</button>
      </form>

      <button type="button" onClick={() => void handleClear()} disabled={hasKey !== true}>
        Remove personal key
      </button>
    </main>
  );
}

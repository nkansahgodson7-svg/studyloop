'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';

interface NotebookRow {
  id: number;
  title: string;
  createdAt: string;
}

export default function NotebooksPage() {
  const [notebooks, setNotebooks] = useState<NotebookRow[] | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const loadNotebooks = useCallback(async () => {
    const res = await fetch('/api/notebooks');
    if (res.status === 401 || res.status === 403) {
      setUnauthorized(true);
      return;
    }
    if (res.ok) {
      setNotebooks((await res.json()) as NotebookRow[]);
    }
  }, []);

  useEffect(() => {
    void loadNotebooks();
  }, [loadNotebooks]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const res = await fetch('/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title })
    });
    if (res.status === 201) {
      setTitle('');
      await loadNotebooks();
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? `Create failed (${res.status})`);
  }

  async function handleDelete(id: number) {
    setError(null);
    const res = await fetch(`/api/notebooks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadNotebooks();
      return;
    }
    setError(`Delete failed (${res.status})`);
  }

  if (unauthorized) {
    return (
      <main>
        <h1>Notebooks</h1>
        <p>
          Please <a href="/login">log in</a> first.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Notebooks</h1>
      {error ? <p role="alert">{error}</p> : null}

      <form onSubmit={handleCreate} aria-label="Create notebook">
        <label htmlFor="nb-title">New notebook title</label>
        <input
          id="nb-title"
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Organic Chemistry"
        />
        <button type="submit">Create</button>
      </form>

      {notebooks === null ? (
        <p>Loading…</p>
      ) : notebooks.length === 0 ? (
        <p>No notebooks yet — create your first one above.</p>
      ) : (
        <ul aria-label="Your notebooks">
          {notebooks.map((nb) => (
            <li key={nb.id}>
              <Link href={`/notebooks/${nb.id}`}>{nb.title}</Link>
              <button type="button" onClick={() => void handleDelete(nb.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <p>
        <a href="/settings">Settings</a>
      </p>
    </main>
  );
}

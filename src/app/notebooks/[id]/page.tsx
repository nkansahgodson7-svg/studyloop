'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface NotebookRow {
  id: number;
  title: string;
}

export default function NotebookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [notebook, setNotebook] = useState<NotebookRow | 'loading' | 'missing'>('loading');

  const loadNotebook = useCallback(async () => {
    const listRes = await fetch('/api/notebooks');
    if (listRes.status === 401 || listRes.status === 403) {
      setNotebook('missing');
      return;
    }
    if (listRes.ok) {
      const all = (await listRes.json()) as NotebookRow[];
      const found = all.find((nb) => nb.id === Number(id));
      setNotebook(found ?? 'missing');
    }
  }, [id]);

  useEffect(() => {
    void loadNotebook();
  }, [loadNotebook]);

  if (notebook === 'missing') {
    return (
      <main>
        <h1>Not found</h1>
        <p>
          <Link href="/notebooks">Back to notebooks</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{notebook === 'loading' ? 'Loading…' : notebook.title}</h1>
      {notebook === 'loading' ? null : (
        <p>
          <Link href="/notebooks">All notebooks</Link>
        </p>
      )}
      <p>Sources, chat, cards and quizzes for this notebook will appear here.</p>
    </main>
  );
}

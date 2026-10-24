'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface AdminUserRow {
  id: number;
  email: string;
  role: string;
  disabled: boolean;
  createdAt: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    if (res.status === 401 || res.status === 403) {
      setForbidden(true);
      return;
    }
    if (res.ok) {
      setUsers((await res.json()) as AdminUserRow[]);
    } else {
      setError(`Could not load users (${res.status})`);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });
    if (res.status === 201) {
      setNotice(`Created ${email}`);
      setEmail('');
      setPassword('');
      await loadUsers();
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? `Create failed (${res.status})`);
  }

  async function toggleDisabled(user: AdminUserRow) {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: !user.disabled })
    });
    if (res.ok) {
      setNotice(`${user.email} ${user.disabled ? 'enabled' : 'disabled'}`);
      await loadUsers();
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? `Update failed (${res.status})`);
  }

  if (forbidden) {
    return (
      <main>
        <h1>Admin</h1>
        <p>
          Admins only. <a href="/login">Log in</a> with an admin account.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Admin — Users</h1>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      <form onSubmit={handleCreate} aria-label="Create user">
        <label htmlFor="new-email">Email</label>
        <input
          id="new-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="new-password">Password (min 12 chars)</label>
        <input
          id="new-password"
          type="text"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <label htmlFor="new-role">Role</label>
        <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit">Create user</button>
      </form>

      <table>
        <caption>Users</caption>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>{user.disabled ? 'disabled' : 'active'}</td>
              <td>
                <button type="button" onClick={() => void toggleDisabled(user)}>
                  {user.disabled ? 'Enable' : 'Disable'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

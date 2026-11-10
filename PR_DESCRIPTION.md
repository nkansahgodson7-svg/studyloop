## Security and performance hardening

Fixes from a security and performance review. 170 tests pass, typecheck is clean, and a production build runs.

### Security
- **Login throttling:** failed logins are limited per account (10 per 15 min, any IP) and per IP (30), and unknown emails take the same time as wrong passwords. Throttling is stored in the database, so it survives restarts and works across instances.
- **Demo account:** no longer created with a hardcoded password. It is only created when `DEMO_PASSWORD` is set.
- **Passwords:** minimum length is now 10. The login form no longer enforces a minimum, so existing users can still sign in. Hashing uses explicit scrypt parameters, and old hashes are upgraded on the next login.
- **LLM key encryption (v2):** the AES key is derived with scrypt. Existing v1 values still decrypt.
- **Chat errors:** provider error text is logged on the server and no longer sent to the browser.
- **Prompt injection:** source excerpts are delimited and marked as untrusted. This lowers the risk but does not remove it.
- **Limits:** at most 100 notebooks per user and 100 sources per notebook.
- **Headers:** added CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy.
- **Dependencies and repo hygiene:** upgraded `vitest` (clears the critical `tinypool` advisory) and untracked `.opencode/`.
- **`TRUST_PROXY_HOPS`:** new setting that reads the client IP from the trusted end of `X-Forwarded-For`.

### Performance
- **Notebook list query:** no longer multiplies rows across sources, cards and reviews.
- **Ingestion:** source chunks are inserted in batches, not one round trip each.
- **YouTube:** the client is reused and caption fetches have a timeout.
- **Chat:** a client disconnect now cancels the LLM request.
- **Indexes:** added the missing ones, including `notebooks(user_id)` and `reviews(due)`.
- **Fonts:** Inter and Fraunces are self-hosted, replacing the render-blocking Google Fonts `@import`.

### Before merging
- Run `npm run db:migrate`. It creates the `rate_limits` table and the new indexes. Without it, login returns 500.
- Check the app in a browser, since the CSP is enforced. In particular check the PDF viewer, the service worker and the fonts.
- If production already has `demo@studyloop.app` with the old password, change or delete it.
- Make sure `ENCRYPTION_SECRET` is a long random value.
- If your host appends to `X-Forwarded-For`, set `TRUST_PROXY_HOPS` (leave it unset on Vercel).

### Known gaps
- `postcss` advisory (via Next): the fix requires Next 16, which is a breaking upgrade.
- `public/mock/index.html` still loads Google Fonts, and the new CSP blocks them there.
- An attacker who knows an email can lock that account for 15 minutes. That is the usual trade-off against brute force.

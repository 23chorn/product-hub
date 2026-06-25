# Windows Server Deployment (internal network, single port, plain HTTP)

How to run Product Hub on a Windows Server box and reach it from other machines on
the company network via `http://<server-ip>:<port>` — no domain name, no TLS cert.

## Architecture

The backend (Express) serves both the API and the built frontend from one port.
There's no separate frontend port and no CORS to configure — the browser only ever
talks to one origin. This is different from local dev, where Vite (5173) and the
backend (3001) run as two separate processes; that split is dev-only and unaffected
by anything here.

## One-time setup on the server

1. **Install Node.js 18+** (check with `node -v`).

2. **Get the code onto the server** — clone the repo or copy the working tree.
   Keep the whole repo (not just a build output folder): a few things at runtime
   read from `agents/`, `context/`, `db/`, and `app/backend/src/demo/fixtures/`
   directly from source, not from the compiled `dist/`.

3. **Create `.env` at the repo root** (copy `.env.example` and fill in real values).
   The settings that matter specifically for this kind of deployment:

   ```env
   PORT=5173
   NODE_ENV=production
   FRONTEND_URL=http://<server-ip>:5173   # same origin the app is served on
   JWT_SECRET=<a long random string>       # don't leave the default in prod
   COOKIE_SECURE=false                     # plain HTTP — see note below
   ```

   `PORT=5173` is just this server's `.env` setting — it's not a hardcoded default
   in the code (the app falls back to 3001 if `PORT` is unset). Don't copy this
   value into a local dev `.env`: Vite's dev server already hardcodes 5173 in
   `vite.config.ts`, and dev runs the backend (3001) and Vite (5173) as two
   separate processes at once — pointing the dev backend at 5173 too would make
   them fight over the same port. This only applies to the single-process
   production setup described here.

   Plus your real AI provider credentials (`AI_PROVIDER`, `ANTHROPIC_API_KEY` or
   `AWS_*`) and any integrations you use (Airtable, Azure DevOps).

   **Why `COOKIE_SECURE=false`:** browsers refuse to store/send cookies marked
   `secure` over plain HTTP. Since this is an internal network without a TLS
   cert, the login cookie has to be issued without that flag or every login
   would silently fail. If you later put this behind HTTPS (e.g. an internal
   reverse proxy with a company-issued cert), set `COOKIE_SECURE=true`.

4. **Install dependencies and build everything** (from the repo root):

   ```powershell
   npm install
   npm run build
   ```

   This builds `app/shared`, compiles the backend to `app/backend/dist/`, and
   builds the frontend to `app/frontend/dist/` (consumed automatically by the
   backend's static file serving — no separate step needed).

5. **Open the port in Windows Firewall** (PowerShell, as Administrator):

   ```powershell
   New-NetFirewallRule -DisplayName "Product Hub" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
   ```

6. **Start the server:**

   ```powershell
   npm start
   ```

   Visit `http://<server-ip>:5173` from any machine on the company network.

## Keeping it running

`npm start` runs in the foreground and dies if the terminal closes or the
machine reboots. For something that stays up, wrap it as a Windows Service with
[NSSM](https://nssm.cc/):

```powershell
nssm install ProductHub "C:\Program Files\nodejs\node.exe" "app\backend\dist\app\backend\src\server.js"
nssm set ProductHub AppDirectory "C:\path\to\product-hub"
nssm start ProductHub
```

`AppDirectory` matters — `.env`, `db/`, `context/`, etc. are all resolved relative to
the repo root, so the service needs to start with that as its working directory.

## Redeploying after a code change

```powershell
git pull
npm install
npm run build
nssm restart ProductHub    # or just re-run `npm start` if not using a service
```

## Data that lives on the server (back this up)

- `db/product-ops.db` — SQLite database (workflows, users, artifacts metadata)
- `data/` — session artifacts written to disk
- `app/backend/logs/` — daily app logs

None of these are in source control (gitignored) — they're specific to this
deployment and won't come back from a `git pull`.

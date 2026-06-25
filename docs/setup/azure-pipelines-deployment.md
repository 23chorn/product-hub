# Automated Deploys via Azure Pipelines

How to wire up `azure-pipelines/deploy.yml` so pushing to `main` automatically
builds and deploys to the Windows Server, instead of someone RDP'ing in to run
`git pull`, `npm install`, `npm run build`, and restart the service by hand.

Read [windows-server-deployment.md](windows-server-deployment.md) first — this
assumes the server is already set up that way (repo cloned, `.env` in place,
app wrapped as an NSSM service) and just automates the "Redeploying after a
code change" section of that doc.

## How it works

Azure Pipelines runs the job on a **self-hosted agent installed on the deploy
server itself**, not a Microsoft-hosted cloud agent. That's the key design
choice here: the app's working copy on the server is a persistent directory —
`db/product-ops.db`, `data/`, `logs/`, `context/*.md`, and `.env` all live
inside it, are gitignored, and must survive every deploy. A normal pipeline
checkout into a fresh `_work` folder would give you a clean tree with none of
that. So the pipeline skips the built-in checkout (`checkout: none`) and
instead pulls in place inside the existing repo directory via PowerShell —
`git fetch` + `git reset --hard origin/main`. A hard reset only touches
tracked files, so the gitignored runtime state is never touched — but for that
same reason, **never add `git clean -fdx` to this pipeline**; that would wipe
the database, session data, logs, and any context files edited via the UI.

## One-time setup

### 1. Install a self-hosted agent on the deploy server

In Azure DevOps: **Organization settings → Agent pools → Add pool** → name it
`ProductHub-Server` (matches the `pool:` name in `deploy.yml` — change both if
you'd rather use an existing pool). Then **New agent** and follow the Windows
instructions to download and configure the agent on the server itself:

```powershell
.\config.cmd
# Server URL: https://dev.azure.com/{org}
# Authentication: PAT (scope: Agent Pools — Read & manage)
# Pool: ProductHub-Server
# Run as a service: Yes
```

Run as a service under an account that has:
- Permission to read/write the repo directory (`$(deployPath)` in `deploy.yml`)
- Permission to restart the NSSM service (simplest: add the account to
  Administrators; otherwise grant it explicitly with `sc.exe sdset` on the
  service)

### 2. Let the agent pull non-interactively

The pipeline runs `git fetch`/`git reset` as a service account with no
terminal to type a password into, so a credential prompt will just hang the
job. Generate an Azure DevOps PAT scoped to **Code → Read** for this repo,
then set the existing working copy's remote to embed it:

```powershell
cd C:\apps\product-hub   # the existing working copy, same path as deployPath
git remote set-url origin https://{PAT}@dev.azure.com/{org}/{project}/_git/{repo}
```

(Alternatively, run `git pull` by hand once under that same service account
and cache the credential via Git Credential Manager — either works; the PAT
remote is simpler to reason about for an unattended job.)

### 3. Set `deployPath` for this server

Edit `azure-pipelines/deploy.yml` — `deployPath` must match the exact path
used as `AppDirectory` when the NSSM service was created. If you're deploying
to more than one server, copy `deploy.yml` per environment (e.g.
`deploy.staging.yml`) with its own `deployPath`, `serviceName`, pool, and
trigger branch — there's deliberately no parameterization for that here since
this repo only documents a single server today.

### 4. Create the pipeline in Azure DevOps

**Pipelines → New pipeline → Azure Repos Git → (this repo) → Existing Azure
Pipelines YAML file** → `/azure-pipelines/deploy.yml`. Save it.

## What happens on every push to `main`

1. Pull latest `main` in place (hard reset — see warning above)
2. `npm install`
3. `npm run build` — rebuilds `app/shared`, the backend, and the frontend, in
   that order (same as the root build script)
4. `nssm restart ProductHub`
5. Health check: hits `healthCheckUrl` and fails the pipeline if it doesn't
   get back HTTP 200, so a broken deploy shows up red in Azure DevOps instead
   of silently leaving the site down

## Rollback

There's no automated rollback — keep this simple and handle it the same way
you would have before the pipeline existed:

```powershell
cd C:\apps\product-hub
git reset --hard <last-good-sha>
npm install && npm run build
nssm restart ProductHub
```

## Troubleshooting

**Pipeline queues but never picks up a job** — the self-hosted agent isn't
running, or it's registered to the wrong pool. Check the agent's Windows
service status on the deploy server and the pool name in `deploy.yml`.

**`git` step fails with an auth prompt / hangs** — the PAT remote isn't set,
or the PAT expired. Re-run the `git remote set-url` step from setup with a
fresh PAT.

**`nssm restart` fails or is silently a no-op** — confirm the agent's service
account actually has rights to control the named Windows service, and that
`serviceName` in `deploy.yml` matches what you passed to `nssm install`.

**Health check fails right after a real, working deploy** — the service may
need longer than 5 seconds to come back up under load; bump the `Start-Sleep`
and `-TimeoutSec` values in the health check step.

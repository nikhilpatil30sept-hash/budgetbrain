# BudgetBrain on AWS

A second environment next to Render: the same Docker image, deployed to **Amazon ECS Express Mode** (Fargate behind an HTTPS Application Load Balancer), defined in **Terraform**, deployed and torn down from **GitHub Actions** by a least-privilege deploy user, and checked by **deployment tests** that run against the live URL after every deploy. Render stays the main production deployment.

```
GitHub Actions (manual: deploy / destroy)
   │  deploy user's access key (GitHub environment secret)
   ▼
ECR image ──► ECS Express Mode service (1 Fargate task, Node 24, non-root)
                 ▲
   HTTPS ──► Application Load Balancer (ECS-managed certificate)
                 │
   Secrets: SSM Parameter Store ──► container env      Data: Turso (budgetbrain-aws)
   Logs: CloudWatch /ecs/budgetbrain                   Budget: email alerts
```

## What's where

| Path | What it is |
|---|---|
| `Dockerfile`, `.dockerignore` | Two-stage image: builds server and client, then ships only `server/dist`, `client/dist` and the server's production dependencies. Runs as a non-root user. |
| `infra/bootstrap/bootstrap.yaml` | CloudFormation, created once by hand: the GitHub Actions deploy user and its least-privilege policy, Terraform state bucket, ECR repository, monthly cost budget. Everything that must survive a destroy. |
| `infra/terraform/` | The app environment: ECS cluster and Express Mode service, IAM task and infrastructure roles, CloudWatch log group. |
| `.github/workflows/aws.yml` | Manual workflow: **deploy** (build, push, apply, test, roll back on failure) or **destroy**. |
| `.github/workflows/ci.yml` | On every push: builds the image and runs the deployment tests against the container (`docker-smoke`), and validates and security-scans the infrastructure code (`infra-checks`). |
| `e2e/cloud/`, `e2e/playwright.cloud.config.ts` | The deployment tests, BB-C1 to BB-C9. |

## Deployment tests (BB-C1 to BB-C9)

They target what a deploy can break even when every unit, integration and e2e test passed.

| ID | Check | Runs on |
|---|---|---|
| BB-C1 | `/api/health` answers from the live process and reports the expected database (`turso` on AWS), so a missing secret can't silently fall back to a throwaway SQLite file | container + AWS |
| BB-C2 | TLS certificate valid for the hostname (chain and name), more than 14 days left, TLS 1.2+ | AWS |
| BB-C3 | Plain HTTP never serves the app: it redirects to HTTPS, refuses, or nothing is listening | AWS |
| BB-C4 | Security headers (CSP, HSTS, nosniff, frame options, no `X-Powered-By`) survive the load balancer | container + AWS |
| BB-C5 | The built React app and its JS bundle are served; deep links fall back to `index.html` | container + AWS |
| BB-C6 | API errors stay JSON (401) and never fall through to the HTML app | container + AWS |
| BB-C7 | Session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS; a token replayed after logout is rejected | container + AWS |
| BB-C8 | Sign up, log out, log in through the browser with no script errors or CSP violations | container + AWS |
| BB-C9 | A spoofed `X-Forwarded-For` header can't reset the login rate limit behind the load balancer | AWS |

Two details worth knowing:

- **The auth rate limit is real in production** (20 requests per 15 minutes per IP) and the suite needs about 12. If a previous run used up the window, `global-setup.ts` waits for it to reset instead of failing, because a failure would trigger a rollback for a reason unrelated to the new version.
- **BB-C9 only means something behind a real proxy.** Without one, `trust proxy = 1` makes Express believe whatever `X-Forwarded-For` the client sends, so each made-up address gets a fresh limit. Locally that's easy to show: three logins with three made-up addresses all report `RateLimit-Remaining: 19`. Behind the load balancer, which appends the real client address, the count has to go down.

## Why a deploy user instead of GitHub OIDC

The first design signed GitHub Actions in to AWS with OIDC: short-lived credentials, nothing stored. This account belongs to an AWS Organization whose service control policies deny `iam:CreateOpenIDConnectProvider` (and every region except `us-east-2`), so the bootstrap stack failed on the OIDC provider. A read-only `iam simulate-principal-policy` check confirmed everything else this setup needs is allowed in `us-east-2`.

The fallback keeps the blast radius small:

- **No console access.** The `budgetbrain-github-deploy` user has no password.
- **Least privilege.** Its policy (via the `budgetbrain-deployers` group) covers this app's ECR repository, ECS, its log group, `/budgetbrain/*` parameters, the state bucket and IAM roles named `budgetbrain-*`. It can't launch EC2 instances or touch other resources.
- **Stored in one place.** The access key exists only as secrets of the GitHub `aws` environment, which only `main` can use.
- **Rotation.** Make a new key and delete the old one every 90 days, or deactivate the key whenever the environment is destroyed and you're not using it.

On an account without that restriction, OIDC is the better choice.

## One-time setup

You do these steps in the browser. Nothing here needs AWS keys on your Mac.

1. **AWS account.** Create one at aws.amazon.com and pick the **Free plan**. Turn on MFA for how you sign in. Work in **US East (Ohio) us-east-2**: this account's organization policy blocks every other region.

2. **A separate Turso database for AWS.** The deployment tests create a few throwaway accounts on every run, so keep them out of the Render production database:
   ```bash
   turso db create budgetbrain-aws
   turso db show budgetbrain-aws --url        # → TURSO_DATABASE_URL
   turso db tokens create budgetbrain-aws     # → TURSO_AUTH_TOKEN
   ```
   The app creates its tables on first start.

3. **Bootstrap stack.** CloudFormation → **Create stack** → *With new resources* → *Upload a template file* → `infra/bootstrap/bootstrap.yaml`. Stack name `budgetbrain-bootstrap`, enter your email for `BudgetEmail`, keep the other defaults. Tick the IAM acknowledgement and submit. When it shows `CREATE_COMPLETE`, open the **Outputs** tab.

4. **Access key for the deploy user.** IAM → *Users* → `budgetbrain-github-deploy` → *Security credentials* → **Create access key** → use case *Third-party service* (or *Application running outside AWS*) → **Create access key**. The secret is shown once: copy both values straight into GitHub in the next step, then close the page. Don't save them anywhere else.

5. **GitHub settings** for the `budgetbrain` repository:
   - *Settings → Environments → New environment* named **`aws`**. Under *Deployment branches and tags*, choose *Selected branches* and add `main`.
   - In that environment, add **secrets**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and optionally `GEMINI_API_KEY` (without it the app runs with AI features off).
   - *Settings → Secrets and variables → Actions → Variables*, add **repository variables** from the stack outputs: `AWS_REGION` (`us-east-2`) and `TF_STATE_BUCKET`.

6. **Merge to `main`.** GitHub only lists a manually-run workflow once its file is on the default branch.

## Deploy, test, destroy

- **Deploy:** *Actions → AWS deploy → Run workflow* → branch `main`, action `deploy`. The first run takes roughly 15 minutes (ECS creates the load balancer and certificate). The run summary shows the URL, the image scan counts and the test results; the HTML test report is attached as an artifact.
- **Roll back:** automatic when the deployment tests fail: the workflow re-applies the last image that passed (kept in Parameter Store as `/budgetbrain/aws/last-good-image-tag`). The very first deploy has nothing to roll back to. If the new task never passes the load balancer's health check, Terraform's apply fails before the tests run; check the service's *Deployments* tab in the ECS console to confirm the previous version is still serving.
- **Destroy:** same workflow, action `destroy`. It removes the service, cluster, roles and logs, waits for ECS to finish removing the load balancer, then checks that no load balancer is left running. The ECR images, secrets, state bucket and budget stay, so the next deploy is one click.

## Cost

While deployed, roughly **US$1.30 a day (about $35–45 a month)**: the load balancer (~$18/month) and its public IP addresses (~$7), one Fargate task at 0.25 vCPU / 0.5 GB (~$10), and the task's public IP (~$4). Once destroyed, close to nothing: a few cents a month for stored images. These are estimates; the Billing console is the real number.

The Free plan's credits cover this, but they're finite and the Free plan itself ends after 6 months, so **destroy the environment when you're not demoing or testing it**. The budget in the bootstrap stack emails you at 50% and 80% of the monthly limit, and when the forecast passes 100%.

If AWS reports that a service isn't available on the Free plan, the error says so. Upgrading to a paid plan can't be undone, so check the *Credits* page in Billing before deciding.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Could not load credentials` or `InvalidClientTokenId` at *Sign in to AWS* | The job isn't running in the `aws` environment, the environment doesn't allow the branch you picked, or the `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` secrets are missing, mistyped or deactivated. |
| `explicit deny in a service control policy` | The account's organization policy blocked the action. Check the region is `us-east-2`; anything else, send the full message. |
| `AccessDenied` for an action without "service control policy" | The deploy user's policy is missing a permission. Add the action to `DeployPolicy` in `bootstrap.yaml` and update the stack. |
| `Add the TURSO_DATABASE_URL secret...` | The secret is missing from the `aws` environment (repository-level secrets aren't used). |
| BB-C1 fails with `local-file` instead of `turso` | The Turso secret didn't reach the container. Check the parameter exists under `/budgetbrain/aws/` in Systems Manager → Parameter Store. |
| Tests pause with "waiting ... for the window to reset" | Expected after back-to-back deploys; see the rate-limit note above. |
| Destroy ends with "Load balancer(s) still running" | ECS didn't finish its cleanup. Delete the load balancer in EC2 → Load Balancers to stop the charge, then run destroy again. |

## Known limits

- **One task only.** Rate limits live in process memory, so two tasks would each count separately and halve their effect. Scaling out needs a shared store (e.g. Redis) first.
- **Password-reset emails** aren't configured on AWS (no `RESEND_API_KEY`), so reset links are written to the CloudWatch logs instead.
- **The image scan reports but doesn't block** a deploy; most findings come from the Node base image and are fixed by rebuilding on a newer one.

# Azure Deployment — Business Requirements Assessment

> Source: synthesized from `Docs/02 frontend/Project_Requirements_Document.md`, `Docs/04 security/user authentication.md`, `Docs/06 server/pseudonymisation-module.md`, `Docs/06 server/running-the-server.md`, `compose.yaml`, and the current state of the `frontend/`, `backend/`, and `database(FE)/` trees.
>
> Use case scope: deploy both backend and frontend to Azure. One use case requires storing model weights and Docker images with **restricted packages** for **federated learning** and **differential privacy**.

---

## 1. Compute & Hosting (8 services to host)

| Service | Workload | Suggested Azure target |
|---|---|---|
| `frontend` (Next.js, port 3000) | Stateless web | Azure Container Apps or App Service |
| `transcription-orchestrator`, `audio_submission`, `database`, `pseudonymisation-orchestrator` | Stateless FastAPI | Azure Container Apps |
| `transcription-service-2` (Whisper large-v3-turbo, torch+CUDA) | **GPU inference** | Azure Container Apps GPU / AKS w/ NC-series |
| `gliner-service` (NER, PII detection) | CPU-light, must be VNet-isolated | Container Apps in private VNet |
| `retraining-pipeline` (LoRA + Opacus DP-SGD + future FL) | **GPU training, batch** | Azure Machine Learning compute (NC/ND-series) |

---

## 2. Storage

- **Model weights & LoRA adapters** (`backend/retraining-pipeline/adapters/*.safetensors`, ~46 MB today, will grow): **Azure ML Model Registry** *or* **Azure Blob Storage with private endpoint**, versioned, immutable, tagged with `data_zone` (red/green).
- **HF model cache** (~1.5 GB Whisper base + GliNER): Premium File Share, *or* pre-baked into the container image to avoid cold-start downloads in the red zone.
- **Audio files** (raw, CID-bearing): Blob Storage container with **Lifecycle Management policy enforcing 7-day auto-delete** + immutable access logs (PDPA requirement).
- **Databases**: migrate `users.db` + `platform.db` (SQLite under `database(FE)/`) to **Azure Database for PostgreSQL Flexible Server**. SQLite on a single mounted volume will not survive horizontal scaling, App Service restarts, or backup/DR policy.
- **Pseudonymisation spans** (`pseudonymisation_spans.original_text`, encrypted at rest): keep in Postgres column with **Azure Key Vault**-managed key + key rotation policy. Audit-only access.

---

## 3. Federated Learning + Differential Privacy (flagged use case)

- **Azure Container Registry (Premium SKU)** with content trust + private endpoint — host base images that include your restricted packages (Opacus, Flower/PySyft, internal wheels) baked in.
- **Azure Artifacts feed** (private PyPI mirror) — so build agents inside the secure subnet can resolve restricted packages without hitting public PyPI.
- **Customer-managed keys (CMK)** on the registry + model store — DP-trained weights inherit the sensitivity of the training data.
- **Azure ML private workspace** with managed VNet for the FL coordinator + DP training jobs.
- **Network isolation**: registry, weight store, and training compute all on the same private VNet; no public egress from training nodes.
- **Per-model `data_zone` tag** (red/green) on every artifact in the model registry, so green-zone consumers cannot pull red-zone weights.
- **Unlearning protocol** documented and rehearsable before any DP-trained weight is published — required because trained weights are treated as PII.

---

## 4. Security & Compliance (PDPA + UBS red-zone)

- **Two-zone segmentation**:
  - **Red Zone** (VNet A): ASR, CID-containing data, raw audio, transcription services.
  - **Green Zone** (VNet B): ML training inputs (CID-stripped), embeddings, synthetic data.
  - Peering only via the approved orchestrator path; default-deny otherwise.
- **Azure Front Door + WAF** in front of `frontend`; everything else private.
- **Entra ID (Azure AD)** for SSO. **Blocker**: replace the mock JWT auth — the backend has no real auth today (frontend uses hardcoded user + localStorage fake JWT).
- **Azure Key Vault** for `JWT_SECRET`, `HF_TOKEN`, DB credentials, Fernet keys, and the CMK referenced by ACR + Blob.
- **7-day deletion automation**: Azure Function (timer trigger) → deletes raw audio + writes to a `DELETION_LOG` table (auditable, immutable).
- **Diagnostic logs → Log Analytics**, retained per UBS audit policy.
- **mTLS** between `pseudonymisation-orchestrator` and `gliner-service` (currently a shared-secret header in dev).

---

## 5. CI/CD & Identity

- **GitHub Actions (or Azure DevOps)** → ACR → Container Apps / AML, using **OIDC federated identity** (no long-lived secrets in the pipeline).
- **Managed identities** on every Azure service for Key Vault / Blob / Postgres access.
- Separate pipelines for *standard images* (public PyPI OK) and *restricted images* (private feed, signed, content-trust-enforced).

---

## 6. Observability

- **Application Insights** for FastAPI + Next.js (request traces, exceptions, distributed tracing across services).
- **Azure Monitor alerts** on:
  - 7-day retention SLA breach risk
  - Model drift (WER regression beyond threshold)
  - GPU saturation on training/inference nodes
  - Failed pseudonymisation runs
- TensorBoard / WandB endpoints reachable only from the ML VNet.

---

## 7. Critical gaps to close *before* deployment

1. **No real backend auth** — FastAPI endpoints are currently unguarded. Implement signed-JWT validation + role guards (User / Admin / ML Engineer) before any cloud exposure.
2. **SQLite must go** — migrate `users.db` and `platform.db` to Postgres; rewrite the seeding scripts in `database(FE)/seed/` to target Postgres.
3. **No `data_zone` tagging** on training jobs / model weights in the schema — required for two-zone enforcement and for the FL/DP use case.
4. **Opacus / Flower not yet in `requirements.txt`** — the DP+FL story is documented but unimplemented; pin versions before baking the restricted ACR image so the image build is reproducible.
5. **HF model download at runtime** — will not work in a network-isolated red zone; pre-bake into the image or pre-stage to Blob + mount. See §10 for the one-time upload procedure.
6. **Commercial-user access tiers** (`max_uploads_per_day`, `max_storage_mb`) referenced in the PRD but not modeled — needed before exposing the upload path publicly.

---

## 8. Suggested next step

Pick the deployment target tier first:

- **Azure Container Apps + Azure ML** → lowest-friction path, recommended unless UBS mandates AKS.
- **AKS** → only if UBS policy requires it (more ops overhead, more flexibility).

Once chosen, the follow-on artifacts are:

- Bicep / Terraform skeleton for the two-VNet topology + ACR + Key Vault + Postgres + AML workspace.
- Migration plan for SQLite → Postgres (schema, seed, cutover).
- Restricted-package ACR base-image Dockerfile (Opacus + Flower + internal wheels, signed).
- Azure Function for 7-day audio deletion + `DELETION_LOG` schema.

---

## 9. Redis cache — local dev and Azure setup

### 9.1 What we'd use Redis for

Redis is not strictly required today, but it unblocks several items already in `fix-triage-frontend-vs-backend.md`:

- **F5 (rate limiting on `/auth/login`)** — `frontend/src/proxy.js` currently uses an in-memory token bucket. That works for one Next.js instance and breaks the moment we run two replicas behind Azure Container Apps' default scale-out. Redis replaces the `Map` with a shared sliding-window counter.
- **F8 (CSRF token storage)** — server-issued double-submit tokens need a place to live that survives a request and can be revoked.
- **F22 (per-user privacy budget ledger)** — fast atomic decrement on each training-round ingest; persisted to Postgres async.
- **Session caching for `getCurrentUserFromCookie`** — currently re-reads `users.db` on every request; trivially Redis-cacheable with a short TTL.
- **Rate limits on the upload + transcription orchestrator endpoints**, not just login.

Treat Redis as the next stateful primitive after Postgres in the deployment plan.

### 9.2 Local dev setup (Windows host)

This machine has Docker Desktop installed (CLI version 28.3.2) but the engine is stopped. WSL2 distros (`Ubuntu`, `Ubuntu-22.04`) are also installed but stopped. No native Redis or Memurai is installed. Three viable paths, in order of recommendation:

#### Option A — Docker Compose integration (recommended)

Add a `redis` service to `compose.yaml`. This is the cleanest fit because every other backend service already lives there, and team members get Redis automatically via `docker compose up`.

```yaml
# compose.yaml — append under `services:`
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

# under `volumes:` at the bottom of the file
  redis_data:
```

Then have the `frontend` service depend on it and inject the URL:

```yaml
  frontend:
    depends_on:
      # …existing entries…
      redis:
        condition: service_healthy
    environment:
      # …existing entries…
      - REDIS_URL=redis://redis:6379
```

Bring it up:

```powershell
docker compose up -d redis
docker compose exec redis redis-cli ping   # → PONG
```

#### Option B — Standalone Docker container (quickest one-off)

If you want Redis up for a single dev session without touching `compose.yaml`:

```powershell
# 1. Start Docker Desktop (one-time, GUI app):
& "C:\Program Files\Docker\Docker\Docker Desktop.exe"

# 2. Once the whale icon in the system tray is steady (≈ 30–60 s), pull and run:
docker run -d --name austin-redis -p 6379:6379 `
  -v austin-redis-data:/data `
  redis:7-alpine `
  redis-server --appendonly yes

# 3. Smoke test:
docker exec -it austin-redis redis-cli ping   # → PONG

# Stop / remove later:
docker stop austin-redis
docker rm austin-redis
```

The named volume (`austin-redis-data`) means the AOF append-only file survives container removal.

#### Option C — WSL2 Ubuntu (no Docker required)

If Docker Desktop isn't desirable (license, RAM cost):

```powershell
wsl -d Ubuntu     # boot the existing distro
```

Then inside WSL:

```bash
sudo apt update && sudo apt install -y redis-server
sudo service redis-server start
redis-cli ping    # → PONG
```

WSL2 forwards `localhost:6379` to the Windows host automatically, so the Next.js dev server hits the same address as the Docker option.

#### Wiring the FE to use it

Once Redis is up, replace the in-memory bucket in `frontend/src/proxy.js` with a Redis-backed limiter. The minimal change:

```js
// frontend/package.json — add deps
//   "@upstash/ratelimit": "^2.x",
//   "ioredis": "^5.x"

// frontend/src/proxy.js — replace LOGIN_BUCKET / rateLimitedLogin
import Redis from 'ioredis';
import { Ratelimit } from '@upstash/ratelimit';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const loginLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(8, '60 s'),
    prefix: 'austin:rl:login',
});

async function rateLimitedLogin(request) {
    const ip = ipFromRequest(request);
    const { success, reset } = await loginLimiter.limit(ip);
    return success ? { limited: false } : { limited: true, retryAfter: Math.ceil((reset - Date.now()) / 1000) };
}
```

(`@upstash/ratelimit` works with any Redis-protocol server, not just Upstash's hosted offering.)

### 9.3 Azure setup

Pick the Redis flavour first; the rest is mostly the same.

#### Service tier

| Tier | When to use | Notes |
|---|---|---|
| **Azure Cache for Redis — Standard / Premium** | Default for this project. Premium gives VNet integration, geo-replication, persistence (RDB / AOF), zone redundancy. | UBS red-zone deploys need **Premium** at minimum (VNet support starts there). |
| **Azure Managed Redis** (newer SKU) | Better price/perf, supports private endpoints natively, Redis Enterprise feature set. Worth comparing against Premium at procurement time. | Replacing some Cache for Redis tiers; check Microsoft's current GA matrix before committing. |
| **Self-hosted Redis on AKS** | Only if UBS mandates AKS for *everything* and rules out PaaS Redis. Higher ops burden. | Use the Bitnami helm chart with Sentinel for HA. |

#### Reference Bicep (Premium, VNet-injected, TLS-only, Entra ID auth)

```bicep
// infra/redis.bicep
param location string = resourceGroup().location
param namePrefix string
param subnetId string                        // dedicated /29+ subnet in the red-zone VNet
param logAnalyticsWorkspaceId string

resource redis 'Microsoft.Cache/redis@2024-11-01' = {
  name: '${namePrefix}-redis'
  location: location
  properties: {
    sku: {
      name: 'Premium'
      family: 'P'
      capacity: 1                            // P1 = 6 GB; bump to P2/P3/P4 as the FL ledger grows
    }
    enableNonSslPort: false                  // refuse plain 6379, only TLS 6380
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'          // private endpoint only
    redisVersion: '7.4'
    redisConfiguration: {
      'maxmemory-policy': 'allkeys-lru'
      'aof-backup-enabled': 'true'
      'aad-enabled': 'true'                  // Entra ID auth (no shared access keys)
    }
    subnetId: subnetId                       // VNet injection
  }
  zones: ['1', '2', '3']                     // zone redundancy
}

resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: redis
  name: 'redis-to-loganalytics'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [{ categoryGroup: 'audit', enabled: true }, { categoryGroup: 'allLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}
```

#### Network isolation

- **Subnet placement:** dedicated `/29` subnet inside the **Red Zone** VNet (the one carrying CID-bearing audio + transcription traffic). Cache for Redis Premium consumes 4–10 IPs depending on capacity tier.
- **Private endpoint** instead of VNet injection if you need to share one Redis instance across multiple VNets — but for the two-zone model in §4, prefer two separate Redis instances (one per zone) so red-zone keys can never end up cached in green-zone memory.
- **NSG rules:** allow inbound 6380/TCP from the Container Apps subnet and the AML training subnet only; deny all other inbound.
- **Front Door / WAF do not front Redis.** It is never internet-reachable.

#### Auth

- Disable shared access keys entirely (`'aad-enabled': 'true'` plus a deployment-time deletion of the access keys via `az redis update --redis-configuration access-keys=disabled`).
- Each consumer (Container Apps revision, AML compute, Function) authenticates via its **managed identity** assigned the `Data Contributor` role on the cache.
- The Node.js / Python clients exchange the managed-identity token for a Redis ACL user; `ioredis` 5.4+ and `redis-py` 5.0+ both support the OAuth2 / Entra ID flow natively.

#### Encryption

- **In transit:** TLS 1.2 minimum (set above), client must verify the server cert.
- **At rest:** enabled by default for Premium; for **customer-managed keys (CMK)** add a `Microsoft.Cache/redis/encryption` block referencing the same Key Vault used by ACR + Postgres.
- **Backups:** RDB snapshot to Storage Account daily; AOF for crash recovery. Snapshot storage account uses the same CMK.

#### Wiring from the apps

Inject `REDIS_URL` and the managed-identity client id into each consumer:

```yaml
# Container Apps (per-revision env)
- name: REDIS_HOST
  value: <prefix>-redis.redis.cache.windows.net
- name: REDIS_PORT
  value: "6380"
- name: REDIS_TLS
  value: "true"
- name: AZURE_CLIENT_ID
  value: <managed-identity-client-id>
```

The Next.js side (with `ioredis`):

```js
import Redis from 'ioredis';
import { DefaultAzureCredential } from '@azure/identity';

const credential = new DefaultAzureCredential();
async function getRedis() {
    const token = await credential.getToken('https://redis.azure.com/.default');
    return new Redis({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        username: process.env.AZURE_CLIENT_ID,
        password: token.token,                 // refresh before expiry
        tls: { servername: process.env.REDIS_HOST },
    });
}
```

Token refresh (Entra ID tokens last ~1 hour) needs a small wrapper that reissues the connection on `AUTH` failure or proactively at ~50 min.

#### Sizing (first-pass)

Workloads, sized small because they're all metadata, not bulk data:

| Use | Approx working set | Notes |
|---|---|---|
| Login + upload rate limits | ≪ 10 MB | One sliding-window counter per active IP. |
| CSRF tokens | < 100 MB | TTL ≈ 12 h, one per session. |
| Privacy budget ledger | < 100 MB | One key per user; could spill to Postgres. |
| Session/user cache | < 100 MB | TTL ≈ 5 min, evicted by LRU. |

A **P1 (6 GB)** instance is well over-provisioned for current scope and is the smallest Premium tier with VNet integration. Re-evaluate at P2 only if the privacy ledger grows beyond ≈ 1 M users.

#### Observability

- Diagnostic settings → Log Analytics (audit, all logs, all metrics) — included in the Bicep above.
- Azure Monitor alerts on:
  - `usedmemorypercentage` ≥ 80 %
  - `serverLoad` ≥ 80 % for 5 min (CPU saturation)
  - `connectedclients` change > 50 % over 5 min (connection storm — often misconfigured client retry loops)
  - `cachemissrate` rising trend (cache poisoning or TTL too aggressive)
- Application Insights captures Redis call latency via the `ioredis` / `redis-py` instrumentation packages.

#### Pre-prod checklist

- [ ] Premium tier, P1 minimum.
- [ ] `enableNonSslPort: false`, `minimumTlsVersion: '1.2'`.
- [ ] `publicNetworkAccess: 'Disabled'`, VNet-injected into the red-zone subnet.
- [ ] Shared access keys disabled; Entra ID auth enabled; each consumer has a managed identity.
- [ ] Diagnostic settings → Log Analytics.
- [ ] Backups configured (RDB daily + AOF).
- [ ] CMK (same Key Vault as ACR / Postgres).
- [ ] Two instances if running the two-zone model — one red, one green; never cross-pollinate keys.

### 9.4 What's NOT to use Redis for

- **The audit trail.** `audit_event` rows are compliance evidence; they belong in the durable Postgres store, not a cache that can be evicted by `allkeys-lru`.
- **Pseudonymisation spans.** Encrypted at rest in Postgres per §2; same reasoning.
- **Long-lived secrets.** That's Key Vault's job.
- **Anything that needs to survive a region-wide Redis outage.** Any Redis-stored value should be reconstructible from a durable source within the SLO window.

---

## 10. One-time model weights upload to Azure Blob

Today the base ASR weights live under `backend/server/pretrained_weights/{vendor}/{model}/` (Whisper base, Qwen3-ASR-1.7B, MERaLiON-2-10B-ASR, Voxtral Mini 4B) — checked into the repo via git LFS, in HuggingFace `safetensors` format. Loaders in `backend/server/model_interface.py` try the local path first and fall back to `huggingface_hub.snapshot_download()` (auth via `HF_TOKEN` from `backend/.env`, gated by `MODEL_SIZE_THRESHOLD_GB=17`). LoRA adapters live separately under `backend/retraining-pipeline/adapters/{name}/` (~6–8 MB each) with `base_model_name_or_path` recorded in `adapter_config.json`.

That fallback download path **will not function inside the red-zone VNet** (no public egress to `huggingface.co`). Largest single artifact today is MERaLiON-2-10B-ASR at ~16 GB, so the weights have to land in Blob Storage *before* any compute revision starts. This is a sysadmin-authorized, one-time operation per model version — repeated only when a base model is upgraded or a new vendor weight is introduced.

### 10.1 Process (sysadmin-authorized, engineer-executed)

1. **Provision the landing zone.** Sysadmin creates a dedicated **Azure Storage Account** (Blob, Hot tier, RA-GRS) inside the red-zone subscription with `publicNetworkAccess: Disabled` and a **private endpoint** into the red-zone VNet. Containers: `model-weights/` (immutable, versioned, CMK-encrypted) and `adapters/` (versioned, append-only). Lifecycle policies mirror §2 — these blobs are *not* subject to the 7-day audio deletion rule.
2. **Grant time-boxed permissions.** Sysadmin issues either a **user-delegation SAS token** (preferred — short TTL, scoped to `Write,Create` on the specific container, IP-pinned to the engineer's staging host) or assigns the engineer's Entra ID principal the **Storage Blob Data Contributor** RBAC role on the container only. No account keys, ever. Permission revoked immediately after the upload window closes.
3. **Execute the transfer.** From a secure staging host (jump box or developer laptop on the corporate VPN), use **AzCopy** or **Azure Storage Explorer** over HTTPS:

   ```powershell
   # Example: stage Whisper base + MERaLiON-2-10B to the red-zone account
   azcopy login --tenant-id <tenant>            # Entra ID device-code flow
   azcopy copy `
     "C:\Users\ChunChunMaru\Desktop\Repos\AUSTIN-Lang\backend\server\pretrained_weights\*" `
     "https://<account>.blob.core.windows.net/model-weights/v2026-04-27/" `
     --recursive=true --put-md5 --check-md5 FailIfDifferent
   ```

   `--put-md5` + `--check-md5` give per-blob integrity verification end-to-end. For the 16 GB MERaLiON shard, AzCopy's parallel block upload keeps this to minutes over a corporate uplink.
4. **Mount into compute.** Once uploaded, the weights are exposed to runtime compute as a local-looking volume:
   - **Azure ML jobs** (training / `retraining-pipeline`): register the container as a **datastore**, then mount via `Input(type='uri_folder', path='azureml://datastores/model_weights/paths/v2026-04-27/')`. Files appear at `/mnt/model_weights/...` inside the job.
   - **Azure Container Apps / AKS** (inference, `transcription-service-2`, `gliner-service`): mount via **Azure Files (NFS / SMB) backed by the same storage account** at `/app/pretrained_weights/`, then point `MODEL_ID` at the local path so `from_pretrained()` resolves locally and never reaches the hub. `HF_HOME` set to the mounted directory ensures HF caches are read-only-friendly.

### 10.2 Versioning + zone discipline

- **Immutable blob versioning** on `model-weights/`; each upload goes under a date- or hash-prefixed virtual directory (`v2026-04-27/`, `sha256-…/`). Never overwrite in place — Azure ML revisions reference the path, and silent mutation breaks reproducibility for DP/FL audits.
- **`data_zone` blob index tag** (`red` | `green`) on every artifact, mirroring §3. Green-zone compute mounts only `data_zone=green` blobs via SAS scoping.
- **Adapter uploads** follow the same pattern but go to the `adapters/` container, tagged with `base_model_version` so the inference service can refuse to load an adapter against an incompatible base.
- **CI step** (separate from the sysadmin-authorized base-model upload): the retraining pipeline pushes new adapters to `adapters/` automatically using its workload identity — adapters are small and frequent, base weights are large and rare.

### 10.3 What this replaces

- The git-LFS copies under `backend/server/pretrained_weights/` stay in the repo for *local dev only*. Cloud builds neither bake the weights into the image nor pull from LFS at deploy time.
- `backend/server/utils/preload.py`'s `huggingface_hub.snapshot_download()` fallback is disabled in red-zone images (env flag), so a missing local file fails fast instead of silently attempting a public-internet download that the firewall would drop.
- `HF_TOKEN` is no longer required at runtime in the red zone (only for the engineer's one-time pull from HF on the staging host *before* AzCopy upload). It stays in Key Vault for the green zone / training pipeline only.

# RoadSafe AI — Admin Moderation Console (`/admin`)

The RoadSafe AI public driver experience remains completely login-free. Administrators and moderators access a separate, protected console at `/admin` (lazy-loaded so it adds zero bytes to the public JavaScript bundle).

## Setup & Creating the First Admin

Admin accounts live in PostgreSQL (`admin_users` table) with bcrypt-hashed passwords (`cost = 12`). There are **no hardcoded or demo credentials** in the codebase.

Create the first admin or moderator account using the CLI script:

```bash
cd backend/node-api

# Option 1: Interactive prompt
npx ts-node scripts/create-admin.ts

# Option 2: Environment variables
ADMIN_EMAIL="admin@yourdomain.com" \
ADMIN_PASSWORD="YourStrongPassword123!" \
ADMIN_ROLE="admin" \
npx ts-node scripts/create-admin.ts
```

## Roles & Permissions

| Role | Capabilities |
| :--- | :--- |
| **`moderator`** | View dashboard & live SSE feed, filter/search hazard queue, inspect hazard details & vote history, confirm/reject/clear/expire/edit/re-snap/delete hazards, create official hazards on the map, flag/shadow-ban/block abusive devices, view audit log, export CSV/GeoJSON. |
| **`admin`** | Everything a `moderator` can do, plus modifying global moderation & threshold settings (`GET/PUT /api/v1/admin/settings`). |

## Security Architecture

- **Authentication**: Short-lived (2-hour) JWT signed with `ADMIN_JWT_SECRET` (or `JWT_SECRET`), stored in an `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookie (`roadsafe_admin_token`).
- **CSRF Protection**: Double-submit token pattern (`roadsafe_csrf` cookie + `x-csrf-token` request header) enforced on all state-changing `/api/v1/admin/*` requests (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Login Rate Limiting & Lockout**: Tracks failed login attempts per `IP + email`; 5 consecutive failures lock out login attempts for 15 minutes (`HTTP 429`).
- **Public API Isolation**:
  - Public `GET /api/v1/hazards` excludes `rejected` reports and reports from `isShadowBanned` devices.
  - Public endpoints strip full `deviceId` values and expose only a truncated `deviceShortId`.
- **Append-Only Audit Log**: Every admin login, hazard moderation/edit/delete, device flag/ban, and settings change is recorded in `admin_audit_log` with `adminId`, `adminEmail`, `action`, `targetType`, `targetId`, `beforeJson`, `afterJson`, `ipAddress`, and `createdAt`.

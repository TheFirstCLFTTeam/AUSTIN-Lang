# User Authentication

## Overview

Authentication is currently implemented as a **frontend-only mock** for development/demo purposes. The backend exposes no protected endpoints — all API routes are open. A real backend auth system has not yet been built.

---

## Current Implementation

### Frontend (`frontend/src/`)

#### `services/api.js` — Auth Logic

The core of the auth system lives here. It implements:

- A **hardcoded user** for demo login:

  ```js
  { id: "u1", email: "test@example.com", password: "password123", name: "Test User" }
  ```

- A **fake JWT** generated client-side via `btoa()` and stored in `localStorage`
- The following exported helpers:

| Function | Description |
|---|---|
| `login(email, password)` | Validates credentials against the mock user list, stores a fake token in `localStorage` |
| `logout()` | Removes the token from `localStorage` |
| `isAuthenticated()` | Returns `true` if a token exists in `localStorage` |
| `getToken()` | Returns the raw token string from `localStorage` |

All file API functions (`uploadAudio`, `fetchSubmittedFiles`, etc.) call an internal `requireAuth()` guard that throws if the user is not authenticated.

---

#### `components/ProtectedRoute.jsx` — Route Guard

Wraps all routes that require authentication. Unauthenticated users are redirected to `/login`.

```jsx
// Usage in App.js
<Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
  ...
</Route>
```

---

#### `pages/LoginPage.jsx` — Login UI

A login form that collects email and password, calls `login()` from `api.js`, and navigates to `/` on success. Displays an inline error message on failure.

---

#### `components/Layout.jsx` — Logout

The navbar includes a **Logout** button that calls `logout()` and redirects to `/login`.

---

#### `context/AuthContext.jsx` — Auth Context (Unused)

An `AuthContext` and `AuthProvider` exist but are **not wired up** in `App.js`. Auth state is managed entirely through `localStorage` via `api.js` instead.

---

## Route Structure

| Path | Protected | Component |
|---|---|---|
| `/login` | No | `LoginPage` |
| `/` | Yes | `HomePage` |
| `/upload` | Yes | `UploadPage` |
| `/files` | Yes | `SubmittedFilesPage` |
| `/files/:id` | Yes | `FileDetailPage` |

---

## Backend

The `backend/User authentication/` directory exists but is **empty**. No backend authentication is implemented. All FastAPI endpoints in `backend/server/main.py` and `database/main.py` are publicly accessible with no token validation.

---

## Limitations & What Needs to Be Built

| Area | Current State | What's Needed |
|---|---|---|
| Credentials | Hardcoded in `api.js` | User database with hashed passwords |
| Token | Fake base64 string | Real signed JWT (e.g. via `python-jose`) |
| Token validation | None | Backend middleware to verify JWT on each request |
| User management | None | Registration, roles, session management |
| `AuthContext` | Declared but unused | Wire up to replace `localStorage` checks |
| Backend endpoints | Fully open | Auth guards / dependencies on protected routes |

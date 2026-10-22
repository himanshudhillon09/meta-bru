# Account Security and Profile Editing Design

**Date:** 2026-10-22
**Status:** Approved
**Branch:** `feat/account-security`

## Goal

Add editable profile email, self-service password changes, admin-issued temporary passwords, forced password changes at next login, session invalidation for other devices, and password-confirmed credential reveal on the Profile page.

## Scope

- Profile name remains editable.
- Profile email becomes editable and requires the current password.
- A user can change their own password from Profile.
- An admin can reset any other user's password from User Management.
- An admin reset generates a temporary password that is shown once.
- A reset user must change the temporary password at next login.
- Changing or resetting a password invalidates other logged-in sessions. The current self-service session receives a fresh token.
- Saved integration secrets can be revealed from Profile after confirming the account password.
- Existing passwords are never viewable. No reversible password storage is introduced.

“Admin for all” means an admin can reset any individual user's password, not a bulk reset of every account.

## Security Model

### Password storage

Passwords remain one-way bcrypt hashes. The server never returns an existing password, and no plaintext password copy is stored.

### Session invalidation

The user document gains:

```ts
tokenVersion: number;        // default 0
mustChangePassword: boolean; // default false
```

JWTs include `tokenVersion`. `protect` rejects a token whose version does not match the user's current version.

- Self-service password change: increment `tokenVersion`, invalidating every other session, then return a fresh token for the current session.
- Admin password reset: increment the target user's `tokenVersion`, invalidating all of that user's sessions. The user signs in again with the temporary password.
- Existing tokens without a `tokenVersion` claim are treated as version `0`, so deploying this change does not immediately sign everyone out.
- The frontend clears the stale session and routes to login when a request returns `401`, so other devices do not remain on a broken screen.

### Forced password change

When `mustChangePassword` is true, `protect` only permits:

```text
GET   /api/auth/me
PATCH /api/auth/password
GET   /api/auth/logout
```

All other protected endpoints return:

```json
{
  "success": false,
  "code": "PASSWORD_CHANGE_REQUIRED",
  "message": "You must change your password before continuing."
}
```

### Credential reveal

Saved secrets remain AES-256-GCM encrypted at rest. A dedicated endpoint returns them only after the authenticated user confirms their current password:

```text
POST /api/auth/credentials/reveal
```

The response contains only the secret values, not the non-secret identifiers:

```ts
{
  meta: { appSecret: string } | null;
  cloudinary: { apiKey: string; apiSecret: string } | null;
  gemini: { apiKey: string } | null;
}
```

The endpoint is rate-limited and sends `Cache-Control: no-store`. Secrets are held in React state only for the lifetime of the Profile page and are cleared by a “Lock” action or page navigation.

## Backend Changes

### User model

File: `backend/src/models/userModel.ts`

Add `tokenVersion` and `mustChangePassword` with safe defaults.

### Password generation

New file: `backend/src/services/passwordService.ts`

```ts
export function generateTemporaryPassword(length = 16): string;
```

Uses cryptographically secure randomness and an unambiguous alphabet. The generated password is long enough to satisfy the existing 6–128 character policy.

### Auth controller

File: `backend/src/controllers/authController.ts`

New helpers:

- `publicUser(user)` returns the safe user shape, including `mustChangePassword`.
- `generateToken(id, tokenVersion)` includes the version claim.

Changes:

- `registerUser` returns a token with version `0` and `mustChangePassword: false`.
- `loginUser` returns `mustChangePassword` and a token with the current `tokenVersion`.
- `getMe` returns `mustChangePassword`.
- `updateProfile` accepts editable `email` and optional `currentPassword`.
  - Email is trimmed, lowercased, validated, and checked for uniqueness.
  - If the email changes, the current password is required and verified.
  - Name, timezone, and brand-only updates do not require the password.
- New `changePassword`:
  - Requires `currentPassword` and `newPassword`.
  - Verifies the current password.
  - Rejects a new password equal to the current password.
  - Sets the new password, clears `mustChangePassword`, increments `tokenVersion`, saves, and returns a fresh token plus the safe user.
- New `resetUserPassword`:
  - Admin-only.
  - Rejects resetting the admin's own account through this endpoint.
  - Generates a temporary password.
  - Sets it, sets `mustChangePassword = true`, increments `tokenVersion`, and saves.
  - Returns the temporary password once in the response.
- `getUsers` selects only safe user fields and includes `mustChangePassword`.

### Credential service and controller

Files:

- `backend/src/services/credentialService.ts`
- `backend/src/controllers/credentialController.ts`

Add `getRevealedCredentials(userId)` to the service. It reads the encrypted store and returns only the secrets.

Add `revealCredentials` to the controller. It verifies the current password before returning secrets and sets `Cache-Control: no-store`.

### Middleware

File: `backend/src/middlewares/authMiddleware.ts`

- Compare the JWT `tokenVersion` with the user's current version.
- Enforce the `mustChangePassword` allowlist.
- Return `PASSWORD_CHANGE_REQUIRED` for blocked routes.

### Rate limiting

File: `backend/src/middlewares/rateLimiters.ts`

Add a per-user `passwordLimiter` for:

- `PATCH /api/auth/profile`
- `PATCH /api/auth/password`
- `POST /api/auth/credentials/reveal`

### Routes

File: `backend/src/routes/authRoutes.ts`

```text
PATCH /api/auth/profile                  protect, passwordLimiter
PATCH /api/auth/password                 protect, passwordLimiter
POST  /api/auth/credentials/reveal       protect, passwordLimiter
PATCH /api/auth/users/:id/password       protect, authorize('admin')
```

## Frontend Changes

### Shared password input

New file: `frontend/src/components/PasswordInput.tsx`

A controlled password input with an accessible show/hide button.

### Password change form

New file: `frontend/src/components/PasswordChangeForm.tsx`

Fields:

- Current password
- New password
- Confirm new password

Behavior:

- Validates all fields client-side.
- Enforces the 6–128 character policy.
- Requires the new password and confirmation to match.
- Calls `authApi.changePassword`.
- Returns the new token and user to the parent on success.

### Forced password change page

New file: `frontend/src/app/change-password/page.tsx`

- Minimal centered layout, separate from the normal app shell.
- Explains that an administrator reset the password.
- Uses `PasswordChangeForm` with “Temporary password” as the current-password label.
- On success, stores the fresh token/user and routes to `/dashboard`.

### Auth context

File: `frontend/src/context/AuthContext.tsx`

- Add `mustChangePassword` to the `User` type.
- Add `updateSession(token, user)` to update both localStorage and context.
- Redirect users with `mustChangePassword` to `/change-password`.
- Redirect users without the flag away from `/change-password`.
- Add `/change-password` to the private paths.

### Profile page

File: `frontend/src/app/settings/page.tsx`

Account section:

- Name remains editable.
- Email becomes an email input.
- A current-password field appears only when the email differs from the saved email.
- Saving an email change without the password shows a client-side error.

Password section:

- A separate card below the profile form.
- Uses `PasswordChangeForm`.
- On success, updates the session token and shows a notice that other sessions were signed out.

Credential reveal:

- Every secret input gets an eye button:
  - Meta App Secret
  - Cloudinary API key
  - Cloudinary API secret
  - Gemini API key
- The first eye click opens a password-confirmation modal.
- After confirmation, saved secrets become available for the page session.
- Eye buttons then toggle visibility per field.
- A “Lock revealed secrets” action clears the revealed values and hides them again.
- Saving without editing a revealed field leaves the stored secret unchanged.

New component:

`frontend/src/components/PasswordPromptModal.tsx`

Used for credential reveal re-authentication. It contains a password field, show/hide support, error display, and submit/cancel controls.

### Admin user management

File: `frontend/src/components/Dashboards.tsx`

- Add `mustChangePassword` to `AdminUser`.
- Add a “Reset password” action to desktop and mobile rows.
- Disable the action for the admin's own row.
- Show a “Password reset required” badge when the flag is true.

New component:

`frontend/src/components/PasswordResetModal.tsx`

Two states:

1. Confirmation:
   - User name/email
   - Warning that all sessions will be signed out and the temporary password is shown only once.
2. Result:
   - Temporary password, masked by default
   - Eye/reveal toggle
   - Copy button
   - Warning that the user must change it at next login
   - Done button

The temporary password is discarded when the modal closes.

### API client and types

Files:

- `frontend/src/lib/apiClient.ts`
- `frontend/src/lib/types.ts`

Add:

```ts
authApi.changePassword({ currentPassword, newPassword })
authApi.resetUserPassword(userId)
authApi.revealCredentials(currentPassword)
```

Extend `updateProfile` with `email` and `currentPassword`.

Add `RevealedCredentials` and `mustChangePassword` types.

## Error Handling

- Incorrect current password: `400 INVALID_CURRENT_PASSWORD`
- Missing current password for an email change: `400 CURRENT_PASSWORD_REQUIRED`
- Duplicate email: `409 EMAIL_IN_USE`
- New password equals current password: `400 PASSWORD_UNCHANGED`
- Forced change required: `403 PASSWORD_CHANGE_REQUIRED`
- Admin resetting own password through the admin endpoint: `400 USE_PROFILE_PASSWORD_CHANGE`
- Credential reveal without a configured secret: return `null` for that provider.

## Testing

### Automated

- New unit tests for `generateTemporaryPassword`:
  - Correct default length
  - Only allowed characters
  - Two calls produce different values
- Existing backend test suite must remain green.
- Backend TypeScript build.
- Frontend production build and lint.

### Manual

1. Change name only without a password.
2. Change email with a missing, wrong, and correct current password.
3. Try a duplicate email.
4. Change own password and confirm:
   - Current session remains signed in with the new token.
   - A second browser session is signed out.
5. Admin resets a user:
   - Temporary password is shown once.
   - Target user's existing sessions are rejected.
   - Target user must change the password before using the app.
6. Admin cannot reset their own password from User Management.
7. Reveal integration secrets:
   - Wrong password shows an error.
   - Correct password reveals saved secrets.
   - Eye buttons toggle visibility.
   - Lock hides the secrets again.
8. Saving a profile or credential form after reveal does not overwrite an unedited secret.

## Acceptance Criteria

- Profile name and email are editable; email changes require the current password.
- Users can change their own password from Profile.
- Other sessions expire when a password is changed; the current session stays signed in.
- Admins can reset any other user's password and see the temporary password once.
- Reset users are forced to change the password before continuing.
- Admins cannot view existing passwords.
- All saved integration secrets can be revealed from Profile after password confirmation.
- Secrets remain encrypted at rest and are not returned by normal credential-status APIs.

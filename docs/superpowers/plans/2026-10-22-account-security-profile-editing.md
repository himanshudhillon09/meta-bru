# Account Security and Profile Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable profile email, self-service password changes, admin-issued temporary passwords with forced change, other-session invalidation, and password-confirmed credential reveal.

**Architecture:** Passwords stay bcrypt-hashed. A `tokenVersion` on the user invalidates old JWTs while allowing the current self-service session to receive a fresh token. A `mustChangePassword` flag forces reset users through a dedicated page. A password-confirmed reveal endpoint returns decrypted integration secrets only on explicit request.

**Tech Stack:** Express 5, Mongoose, Zod, bcryptjs, JWT, Next.js 16, React 19, Tailwind.

---

### Task 1: Add temporary password generation

**Files:**
- Create: `backend/src/services/passwordService.ts`
- Test: `backend/src/services/passwordService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTemporaryPassword } from './passwordService.js';

test('generates a 16-character temporary password', () => {
    const password = generateTemporaryPassword();
    assert.equal(password.length, 16);
    assert.match(password, /^[A-HJ-NP-Za-km-z2-9]+$/);
});

test('generates different passwords on each call', () => {
    assert.notEqual(generateTemporaryPassword(), generateTemporaryPassword());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL because `passwordService.ts` does not exist.

- [ ] **Step 3: Implement the service**

```ts
import { randomInt } from 'node:crypto';

const ALPHABET =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTemporaryPassword(length = 16): string {
    let result = '';
    for (let index = 0; index < length; index += 1) {
        result += ALPHABET[randomInt(ALPHABET.length)];
    }
    return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS, including the existing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/passwordService.ts backend/src/services/passwordService.test.ts
git commit -m "feat: add secure temporary password generation"
```

### Task 2: Add session-version and forced-change fields

**Files:**
- Modify: `backend/src/models/userModel.ts`

- [ ] **Step 1: Add fields after `isActive`**

```ts
tokenVersion: {
    type: Number,
    default: 0
},
mustChangePassword: {
    type: Boolean,
    default: false
},
```

- [ ] **Step 2: Build the backend**

Run: `cd backend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/userModel.ts
git commit -m "feat: add token version and forced password change fields"
```

### Task 3: Enforce token versions and forced password changes

**Files:**
- Modify: `backend/src/middlewares/authMiddleware.ts`

- [ ] **Step 1: Compare the token version after loading the user**

```ts
const presentedVersion =
    typeof decoded.tokenVersion === 'number' ? decoded.tokenVersion : 0;
const currentVersion =
    typeof req.user.tokenVersion === 'number' ? req.user.tokenVersion : 0;

if (presentedVersion !== currentVersion) {
    res.status(401).json({
        success: false,
        message: 'Session expired. Please sign in again.',
    });
    return;
}
```

- [ ] **Step 2: Enforce the forced-change allowlist**

```ts
if (req.user.mustChangePassword) {
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
    const allowed =
        (req.method === 'GET' && path === '/api/auth/me') ||
        (req.method === 'PATCH' && path === '/api/auth/password') ||
        (req.method === 'GET' && path === '/api/auth/logout');

    if (!allowed) {
        res.status(403).json({
            success: false,
            code: 'PASSWORD_CHANGE_REQUIRED',
            message: 'You must change your password before continuing.',
        });
        return;
    }
}
```

- [ ] **Step 3: Build the backend**

Run: `cd backend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add backend/src/middlewares/authMiddleware.ts
git commit -m "feat: invalidate old sessions and enforce password changes"
```

### Task 4: Add profile email, password change, and admin reset endpoints

**Files:**
- Modify: `backend/src/controllers/authController.ts`
- Modify: `backend/src/routes/authRoutes.ts`
- Modify: `backend/src/middlewares/rateLimiters.ts`

- [ ] **Step 1: Add safe user serialization and versioned tokens**

```ts
function publicUser(user: any) {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        timezone: user.timezone,
        brandProfile: user.brandProfile || {},
        mustChangePassword: Boolean(user.mustChangePassword),
    };
}

const generateToken = (id: string, tokenVersion = 0) =>
    jwt.sign({ id, tokenVersion }, env.jwtSecret, { expiresIn: '30d' });
```

Use `publicUser` in `getMe`, `updateProfile`, `changePassword`, and `resetUserPassword`. Include `mustChangePassword` in the login/register response and pass `user.tokenVersion ?? 0` to `generateToken`.

- [ ] **Step 2: Extend the profile schema and validation**

```ts
const profileSchema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    email: z.preprocess(
        (value) =>
            typeof value === 'string' ? value.trim().toLowerCase() : value,
        z.email().max(254)
    ).optional(),
    currentPassword: z.string().max(128).optional(),
    timezone: z.string().min(1).max(64).optional(),
    brandProfile: z
        .object({
            niche: z.string().trim().max(200).optional(),
            tone: z.string().trim().max(100).optional(),
            audience: z.string().trim().max(300).optional(),
            keywords: z.string().trim().max(300).optional(),
        })
        .optional(),
});
```

In `updateProfile`, when `parsed.email` differs from `user.email`:

```ts
if (!parsed.currentPassword) {
    throw new AppError(
        400,
        'Enter your current password to change your email.',
        'CURRENT_PASSWORD_REQUIRED'
    );
}

const userWithPassword = await User.findById(req.user.id).select('+password');
if (
    !userWithPassword ||
    !(await (userWithPassword as any).matchPassword(parsed.currentPassword))
) {
    throw new AppError(
        400,
        'Current password is incorrect.',
        'INVALID_CURRENT_PASSWORD'
    );
}

const existing = await User.findOne({
    email: parsed.email,
    _id: { $ne: user._id },
});
if (existing) {
    throw new AppError(409, 'Email is already in use.', 'EMAIL_IN_USE');
}

user.email = parsed.email;
```

Handle duplicate-key races around `user.save()` with:

```ts
try {
    await user.save();
} catch (error: any) {
    if (error?.code === 11000) {
        throw new AppError(409, 'Email is already in use.', 'EMAIL_IN_USE');
    }
    throw error;
}
```

- [ ] **Step 3: Add self-service password change**

```ts
const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(6).max(128),
});

export const changePassword = async (req: Request, res: Response) => {
    const parsed = parseBody(passwordChangeSchema, req);
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }
    if (!(await (user as any).matchPassword(parsed.currentPassword))) {
        throw new AppError(
            400,
            'Current password is incorrect.',
            'INVALID_CURRENT_PASSWORD'
        );
    }
    if (parsed.currentPassword === parsed.newPassword) {
        throw new AppError(
            400,
            'New password must be different from the current password.',
            'PASSWORD_UNCHANGED'
        );
    }

    user.password = parsed.newPassword;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    res.json({
        success: true,
        token: generateToken(user._id.toString(), user.tokenVersion),
        user: publicUser(user),
    });
};
```

- [ ] **Step 4: Add admin password reset**

```ts
export const resetUserPassword = async (req: any, res: Response) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
        throw new AppError(400, 'Invalid user ID', 'INVALID_USER_ID');
    }
    if (req.params.id.toLowerCase() === String(req.user.id).toLowerCase()) {
        throw new AppError(
            400,
            'Use your own Profile to change your password.',
            'USE_PROFILE_PASSWORD_CHANGE'
        );
    }

    const user = await User.findById(req.params.id);
    if (!user) {
        throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    const temporaryPassword = generateTemporaryPassword();
    user.password = temporaryPassword;
    user.mustChangePassword = true;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    res.json({
        success: true,
        temporaryPassword,
        user: publicUser(user),
    });
};
```

- [ ] **Step 5: Select safe fields for the admin user list**

```ts
const users = await User.find({})
    .select(
        'name email role isActive timezone mustChangePassword createdAt updatedAt'
    )
    .sort({ createdAt: -1 });
```

- [ ] **Step 6: Add the rate limiter**

```ts
export const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: {
        success: false,
        message: 'Too many password attempts. Try again in a few minutes.',
    },
});
```

- [ ] **Step 7: Wire the routes**

```ts
router.patch('/profile', protect, passwordLimiter, updateProfile);
router.patch('/password', protect, passwordLimiter, changePassword);
router.patch(
    '/users/:id/password',
    protect,
    authorize('admin'),
    resetUserPassword
);
```

- [ ] **Step 8: Build and test**

Run: `cd backend && npm run build && npm test`
Expected: build and all tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/controllers/authController.ts backend/src/routes/authRoutes.ts backend/src/middlewares/rateLimiters.ts
git commit -m "feat: add profile email, password change, and admin reset"
```

### Task 5: Add password-confirmed credential reveal

**Files:**
- Modify: `backend/src/services/credentialService.ts`
- Modify: `backend/src/controllers/credentialController.ts`
- Modify: `backend/src/routes/authRoutes.ts`

- [ ] **Step 1: Add the service method**

```ts
export async function getRevealedCredentials(userId: string) {
    const store = await readStore(userId);
    return {
        meta: store.meta ? { appSecret: store.meta.appSecret } : null,
        cloudinary: store.cloudinary
            ? {
                  apiKey: store.cloudinary.apiKey,
                  apiSecret: store.cloudinary.apiSecret,
              }
            : null,
        gemini: store.gemini ? { apiKey: store.gemini.apiKey } : null,
    };
}
```

- [ ] **Step 2: Add the controller**

```ts
const revealSchema = z.object({
    currentPassword: z.string().min(1).max(128),
});

export async function revealCredentials(req: Request, res: Response): Promise<void> {
    const parsed = parseBody(revealSchema, req);
    const user = await User.findById(req.user.id).select('+password');

    if (!user || !(await (user as any).matchPassword(parsed.currentPassword))) {
        throw new AppError(
            400,
            'Current password is incorrect.',
            'INVALID_CURRENT_PASSWORD'
        );
    }

    const credentials = await getRevealedCredentials(req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, credentials });
}
```

- [ ] **Step 3: Add the route**

```ts
router.post(
    '/credentials/reveal',
    protect,
    passwordLimiter,
    revealCredentials
);
```

- [ ] **Step 4: Build and test**

Run: `cd backend && npm run build && npm test`
Expected: build and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/credentialService.ts backend/src/controllers/credentialController.ts backend/src/routes/authRoutes.ts
git commit -m "feat: reveal encrypted credentials after password confirmation"
```

### Task 6: Add frontend auth types, client methods, and session handling

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/apiClient.ts`
- Modify: `frontend/src/context/AuthContext.tsx`
- Modify: `frontend/src/app/login/page.tsx`

- [ ] **Step 1: Add types**

```ts
export interface User {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive?: boolean;
    timezone?: string;
    brandProfile?: BrandProfile;
    mustChangePassword?: boolean;
}

export interface RevealedCredentials {
    meta: { appSecret: string } | null;
    cloudinary: { apiKey: string; apiSecret: string } | null;
    gemini: { apiKey: string } | null;
}
```

- [ ] **Step 2: Add API methods**

```ts
updateProfile: (data: {
    name?: string;
    email?: string;
    currentPassword?: string;
    timezone?: string;
    brandProfile?: BrandProfile;
}) => api.patch('/auth/profile', data),

changePassword: (data: {
    currentPassword: string;
    newPassword: string;
}) => api.patch('/auth/password', data),

resetUserPassword: (userId: string) =>
    api.patch(`/auth/users/${userId}/password`),

revealCredentials: (currentPassword: string) =>
    api.post('/auth/credentials/reveal', { currentPassword }),
```

- [ ] **Step 3: Add `updateSession` to AuthContext**

```ts
updateSession: (token: string, userData: User) => void;
```

```ts
const updateSession = (token: string, userData: User) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
};
```

Use it in `login` and expose it in the provider value.

- [ ] **Step 4: Route based on the forced-change flag**

```ts
const login = (token: string, userData: User) => {
    updateSession(token, userData);
    router.push(
        userData.mustChangePassword ? '/change-password' : '/dashboard'
    );
};
```

In the redirect effect:

```ts
if (user && isPublicPath) {
    router.push(
        user.mustChangePassword ? '/change-password' : '/dashboard'
    );
} else if (!user && isPrivatePath(pathname)) {
    router.push('/login');
} else if (
    user &&
    user.mustChangePassword &&
    pathname !== '/change-password'
) {
    router.push('/change-password');
} else if (
    user &&
    !user.mustChangePassword &&
    pathname === '/change-password'
) {
    router.push('/dashboard');
}
```

Add `/change-password` to `PRIVATE_PATHS`.

- [ ] **Step 5: Pass the flag from login**

```ts
authLogin(data.token as string, {
    id: data._id,
    name: data.name,
    email: data.email,
    role: data.role,
    isActive: data.isActive,
    timezone: data.timezone,
    brandProfile: data.brandProfile,
    mustChangePassword: Boolean(data.mustChangePassword),
});
```

- [ ] **Step 6: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/apiClient.ts frontend/src/context/AuthContext.tsx frontend/src/app/login/page.tsx
git commit -m "feat: add password-aware auth session handling"
```

### Task 7: Add password input, change form, and forced-change page

**Files:**
- Create: `frontend/src/components/PasswordInput.tsx`
- Create: `frontend/src/components/PasswordChangeForm.tsx`
- Create: `frontend/src/app/change-password/page.tsx`

- [ ] **Step 1: Create `PasswordInput`**

```tsx
'use client';

import React, { useState } from 'react';

interface PasswordInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    autoComplete?: string;
    required?: boolean;
    className?: string;
    id?: string;
}

export function PasswordInput({
    value,
    onChange,
    placeholder,
    autoComplete = 'current-password',
    required,
    className = '',
    id,
}: PasswordInputProps) {
    const [visible, setVisible] = useState(false);

    return (
        <div className="relative">
            <input
                id={id}
                type={visible ? 'text' : 'password'}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                autoComplete={autoComplete}
                required={required}
                className={`${className} pr-12`}
            />
            <button
                type="button"
                onClick={() => setVisible((current) => !current)}
                aria-label={visible ? 'Hide password' : 'Show password'}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
                {visible ? 'Hide' : 'Show'}
            </button>
        </div>
    );
}
```

- [ ] **Step 2: Create `PasswordChangeForm`**

```tsx
'use client';

import React, { useState } from 'react';
import { authApi } from '@/lib/apiClient';
import type { User } from '@/lib/types';
import { PasswordInput } from './PasswordInput';

interface PasswordChangeFormProps {
    onSuccess: (data: { token: string; user: User }) => void;
    currentPasswordLabel?: string;
}

export function PasswordChangeForm({
    onSuccess,
    currentPasswordLabel = 'Current password',
}: PasswordChangeFormProps) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const inputClass =
        'mt-2 w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50';

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');

        if (newPassword.length < 6 || newPassword.length > 128) {
            setError('New password must be between 6 and 128 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('New password and confirmation do not match.');
            return;
        }
        if (newPassword === currentPassword) {
            setError('New password must be different from the current password.');
            return;
        }

        setSaving(true);
        try {
            const data: any = await authApi.changePassword({
                currentPassword,
                newPassword,
            });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            onSuccess(data);
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not change password');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-5">
            <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    {currentPasswordLabel}
                </label>
                <PasswordInput
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    autoComplete="current-password"
                    className={inputClass}
                    required
                />
            </div>
            <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    New password
                </label>
                <PasswordInput
                    value={newPassword}
                    onChange={setNewPassword}
                    autoComplete="new-password"
                    className={inputClass}
                    required
                />
            </div>
            <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                    Confirm new password
                </label>
                <PasswordInput
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                    className={inputClass}
                    required
                />
            </div>
            {error ? (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                    {error}
                </div>
            ) : null}
            <button
                type="submit"
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all"
            >
                {saving ? 'Saving...' : 'Change password'}
            </button>
        </form>
    );
}
```

- [ ] **Step 3: Create the forced-change page**

```tsx
'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { useAuth } from '@/context/AuthContext';

export default function ChangePasswordPage() {
    const { user, updateSession } = useAuth();
    const router = useRouter();

    if (!user) return null;

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-[24px] border border-white/10 bg-slate-900/70 p-8 shadow-2xl">
                <h1 className="text-2xl font-extrabold text-white">
                    Set a new password
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                    An administrator reset your password. Enter the temporary
                    password and choose a new one before continuing.
                </p>
                <div className="mt-6">
                    <PasswordChangeForm
                        currentPasswordLabel="Temporary password"
                        onSuccess={(data) => {
                            updateSession(data.token, data.user);
                            router.push('/dashboard');
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PasswordInput.tsx frontend/src/components/PasswordChangeForm.tsx frontend/src/app/change-password/page.tsx
git commit -m "feat: add password change form and forced change page"
```

### Task 8: Add Profile email editing, password card, and credential reveal

**Files:**
- Create: `frontend/src/components/PasswordPromptModal.tsx`
- Modify: `frontend/src/app/settings/page.tsx`

- [ ] **Step 1: Create the re-authentication modal**

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { PasswordInput } from './PasswordInput';

interface PasswordPromptModalProps {
    isOpen: boolean;
    title: string;
    description: string;
    submitLabel: string;
    onClose: () => void;
    onSubmit: (password: string) => Promise<void>;
}

export function PasswordPromptModal({
    isOpen,
    title,
    description,
    submitLabel,
    onClose,
    onSubmit,
}: PasswordPromptModalProps) {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setPassword('');
            setError('');
            setLoading(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setError('');
        try {
            await onSubmit(password);
            onClose();
        } catch (err: any) {
            setError(typeof err === 'string' ? err : 'Could not verify password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
            <form
                onSubmit={submit}
                className="relative w-full max-w-md rounded-[28px] border border-white/10 bg-slate-900/95 p-7 shadow-2xl"
            >
                <h3 className="text-xl font-bold text-white">{title}</h3>
                <p className="mt-2 text-sm text-slate-400">{description}</p>
                <div className="mt-5">
                    <PasswordInput
                        value={password}
                        onChange={setPassword}
                        autoComplete="current-password"
                        required
                        className="w-full bg-slate-950/80 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                </div>
                {error ? (
                    <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                        {error}
                    </div>
                ) : null}
                <div className="mt-6 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-white hover:bg-white/10"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                    >
                        {loading ? 'Checking...' : submitLabel}
                    </button>
                </div>
            </form>
        </div>
    );
}
```

- [ ] **Step 2: Add email state and conditional password**

In `settings/page.tsx`:

- Add `const [email, setEmail] = useState('');`
- Add `const [currentPassword, setCurrentPassword] = useState('');`
- Set email in the `useEffect` from `user.email`.
- Compute:

```ts
const emailChanged =
    email.trim().toLowerCase() !== (user?.email || '').trim().toLowerCase();
```

- In `save`, validate and send:

```ts
if (emailChanged && !currentPassword) {
    setError('Enter your current password to change your email.');
    return;
}
const data: any = await authApi.updateProfile({
    name,
    email,
    ...(emailChanged ? { currentPassword } : {}),
    timezone,
    brandProfile: { niche, tone, audience, keywords },
});
```

- Clear `currentPassword` after success.
- Replace the read-only email block with an email input and a conditional current-password field using `PasswordInput`.

- [ ] **Step 3: Add the password card**

```tsx
<section className="mt-6 rounded-3xl border border-white/5 bg-slate-900/40 p-6 sm:p-8 shadow-xl">
    <h2 className="text-lg font-bold text-white">Password</h2>
    <p className="mt-1 mb-6 text-sm text-slate-400">
        Change your password. Other signed-in sessions will be logged out;
        this session will stay active.
    </p>
    <PasswordChangeForm
        onSuccess={(data) => {
            updateSession(data.token, data.user);
            setNotice('Password updated. Other sessions were signed out.');
        }}
    />
</section>
```

Import `PasswordChangeForm` and use `updateSession` from `useAuth`.

- [ ] **Step 4: Add credential reveal state and modal**

Add to `settings/page.tsx`:

```ts
const [revealed, setRevealed] = useState<RevealedCredentials | null>(null);
const [revealOpen, setRevealOpen] = useState(false);
const [revealTarget, setRevealTarget] = useState<
    'meta' | 'cloudinaryKey' | 'cloudinarySecret' | 'gemini' | null
>(null);
const [showMetaSecret, setShowMetaSecret] = useState(false);
const [showCloudApiKey, setShowCloudApiKey] = useState(false);
const [showCloudApiSecret, setShowCloudApiSecret] = useState(false);
const [showGeminiKey, setShowGeminiKey] = useState(false);
```

Add:

```ts
const openReveal = (target: typeof revealTarget) => {
    if (revealed) {
        if (target === 'meta') setShowMetaSecret((value) => !value);
        if (target === 'cloudinaryKey') setShowCloudApiKey((value) => !value);
        if (target === 'cloudinarySecret') setShowCloudApiSecret((value) => !value);
        if (target === 'gemini') setShowGeminiKey((value) => !value);
        return;
    }
    setRevealTarget(target);
    setRevealOpen(true);
};

const revealSecrets = async (password: string) => {
    const data: any = await authApi.revealCredentials(password);
    setRevealed(data.credentials);
    if (revealTarget === 'meta') setShowMetaSecret(true);
    if (revealTarget === 'cloudinaryKey') setShowCloudApiKey(true);
    if (revealTarget === 'cloudinarySecret') setShowCloudApiSecret(true);
    if (revealTarget === 'gemini') setShowGeminiKey(true);
};

const lockSecrets = () => {
    setRevealed(null);
    setShowMetaSecret(false);
    setShowCloudApiKey(false);
    setShowCloudApiSecret(false);
    setShowGeminiKey(false);
};
```

Use `PasswordPromptModal` with `open={revealOpen}`, and `onSubmit={revealSecrets}`.

Update secret input values:

```tsx
value={
    showMetaSecret
        ? metaAppSecret || revealed?.meta?.appSecret || ''
        : metaAppSecret
}
type={showMetaSecret ? 'text' : 'password'}
```

Do the same for Cloudinary key/secret and Gemini key.

Add an eye button overlay to each secret input. Disable it when the corresponding credential is not configured. When `revealed` is null, the button calls `openReveal(...)`; otherwise it toggles visibility.

Add a “Lock revealed secrets” button near the integration heading when `revealed` is set.

- [ ] **Step 5: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PasswordPromptModal.tsx frontend/src/app/settings/page.tsx
git commit -m "feat: add profile email editing and credential reveal"
```

### Task 9: Add admin password reset UI

**Files:**
- Create: `frontend/src/components/PasswordResetModal.tsx`
- Modify: `frontend/src/components/Dashboards.tsx`

- [ ] **Step 1: Create `PasswordResetModal`**

The component receives:

```ts
interface PasswordResetModalProps {
    target: { _id: string; name: string; email: string };
    onClose: () => void;
    onResetComplete: () => Promise<void> | void;
}
```

It has two views:

1. Confirmation with the target name/email and a warning that all sessions will be signed out and the temporary password is shown once.
2. Result with the temporary password in a read-only input, an eye toggle, a copy button, and a “Done” button.

On reset:

```ts
const data: any = await authApi.resetUserPassword(target._id);
setTemporaryPassword(data.temporaryPassword);
await onResetComplete();
```

Use `PasswordInput` or a local read-only password input for the result. Clear state on close.

- [ ] **Step 2: Add state to `AdminDashboard`**

```ts
const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
```

Render the modal:

```tsx
{resetTarget ? (
    <PasswordResetModal
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onResetComplete={load}
    />
) : null}
```

- [ ] **Step 3: Add the action to desktop and mobile rows**

Add a “Reset password” button next to the status button. Disable it when `item._id === user.id`. Add a “Password reset required” badge when `item.mustChangePassword` is true.

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PasswordResetModal.tsx frontend/src/components/Dashboards.tsx
git commit -m "feat: add admin password reset workflow"
```

### Task 10: Final verification and documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document account security**

Add a short README section covering:

- Email changes require the current password.
- Self-service password changes sign out other sessions.
- Admin temporary passwords are shown once and force a change at next login.
- Integration secrets can be revealed only after password confirmation.

- [ ] **Step 2: Run backend verification**

Run:

```bash
cd backend
npm run build
npm test
```

Expected: build succeeds and all tests pass.

- [ ] **Step 3: Run frontend verification**

Run:

```bash
cd frontend
npm run build
npm run lint
```

Expected: build and lint succeed.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document account security features"
```

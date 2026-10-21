import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { User } from '../models/userModel.js';

dotenv.config();

/**
 * Creates the first admin account on a fresh database, or promotes an existing
 * account. Run once from the deployment shell:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='strong-password' npm run seed:admin
 *
 * The password is only changed when RESET_ADMIN_PASSWORD=true.
 */
async function seedAdmin(): Promise<void> {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    const name = (process.env.ADMIN_NAME || '').trim();
    const resetPassword = process.env.RESET_ADMIN_PASSWORD === 'true';

    if (!email || (!password && resetPassword)) {
        throw new Error(
            'ADMIN_EMAIL and ADMIN_PASSWORD are required (RESET_ADMIN_PASSWORD=true also requires ADMIN_PASSWORD).'
        );
    }
    if (password && password.length < 6) {
        throw new Error('ADMIN_PASSWORD must be at least 6 characters.');
    }

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        throw new Error('MONGODB_URI is required.');
    }

    await mongoose.connect(mongoUri, {
        dbName: process.env.DB_NAME || 'meta-bru',
    });

    let user = await User.findOne({ email }).select('+password');

    if (!user) {
        if (!password) {
            throw new Error(
                `No user exists for ${email}. Provide ADMIN_PASSWORD to create the admin account.`
            );
        }

        user = await User.create({
            name: name || 'Administrator',
            email,
            password,
            role: 'admin',
            isActive: true,
        });

        console.log(`Created admin account: ${user.email}`);
    } else {
        user.role = 'admin';
        user.isActive = true;
        if (name) user.name = name;

        if (resetPassword) {
            user.password = password;
        }

        await user.save();
        console.log(
            `Promoted existing account to admin: ${user.email}${
                resetPassword ? ' (password reset)' : ''
            }`
        );
    }

    await mongoose.disconnect();
}

seedAdmin().catch(async (error) => {
    console.error('Admin seed failed:', error instanceof Error ? error.message : error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});

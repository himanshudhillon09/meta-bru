import multer from 'multer';
import { AppError } from '../utils/errors.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const uploadImageMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (_req, file, callback) => {
        if (!ALLOWED_TYPES.includes(file.mimetype)) {
            callback(
                new AppError(
                    400,
                    'Unsupported image type. Use JPEG, PNG, or WebP.',
                    'UNSUPPORTED_MEDIA_TYPE'
                )
            );
            return;
        }
        callback(null, true);
    },
}).single('file');

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';

dotenv.config();

// Connect to Database
connectDB();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
    res.json({ message: 'Welcome to the Meta-Bru API' });
});

app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/login', (req: Request, res: Response) => {
    const { email, password } = req.body;

    // Simple mock logic
    if (email && password) {
        res.json({
            success: true,
            message: 'Login successful',
            user: { email, name: 'Demo User' },
            token: 'mock-jwt-token'
        });
    } else {
        res.status(400).json({
            success: false,
            message: 'Email and password are required'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

import express from 'express';
import {
    createPost,
    deletePost,
    listPosts,
    publishNow,
    retryPost,
    shareStory,
    updatePost,
} from '../controllers/postController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.post('/', createPost);
router.get('/', listPosts);
router.patch('/:id', updatePost);
router.delete('/:id', deletePost);
router.post('/:id/publish-now', publishNow);
router.post('/:id/retry', retryPost);
router.post('/:id/story', shareStory);

export default router;

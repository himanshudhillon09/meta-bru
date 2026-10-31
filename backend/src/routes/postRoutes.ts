import express from 'express';
import {
    clearActivity,
    createPost,
    deletePost,
    getPost,
    listPosts,
    publishNow,
    publishToInstagramLater,
    retryPost,
    shareStory,
    updatePost,
} from '../controllers/postController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(protect);

router.post('/', createPost);
router.post('/activity/clear', clearActivity);
router.get('/', listPosts);
router.get('/:id', getPost);
router.patch('/:id', updatePost);
router.delete('/:id', deletePost);
router.post('/:id/publish-now', publishNow);
router.post('/:id/retry', retryPost);
router.post('/:id/story', shareStory);
router.post('/:id/instagram', publishToInstagramLater);

export default router;

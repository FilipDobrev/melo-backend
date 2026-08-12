import { Router } from 'express';
import { authRouter } from './auth.routes';
import { categoryRouter } from './category.routes';
import { commentRouter } from './comment.routes';
import { feedRouter } from './feed.routes';
import { postRouter } from './post.routes';
import { productRouter } from './product.routes';
import { recipeRouter } from './recipe.routes';
import { userRouter } from './user.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/recipes', recipeRouter);
apiRouter.use('/posts', postRouter);
apiRouter.use('/posts', commentRouter);
apiRouter.use('/feed', feedRouter);

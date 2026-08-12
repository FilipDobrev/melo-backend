import { getUserId } from '../middleware/auth';
import type { CursorPagination, Page } from '../lib/pagination';
import * as feedService from '../services/feed.service';
import type { PostResponse } from '../services/post.service';
import type { TypedRequest, TypedResponse } from '../types/http';

export async function getFeed(
  req: TypedRequest<void, CursorPagination>,
  res: TypedResponse<Page<PostResponse>>,
): Promise<void> {
  const page = await feedService.getFeed(getUserId(req), { cursor: req.query.cursor, limit: req.query.limit });
  res.status(200).json(page);
}

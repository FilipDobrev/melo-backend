import type { CursorPagination, Page } from '../lib/pagination';
import * as feedService from '../services/feed.service';
import type { PostResponse } from '../services/post.service';
import type { AuthorizedRequest, TypedResponse } from '../types/http';

export async function getFeed(
  req: AuthorizedRequest<void, CursorPagination>,
  res: TypedResponse<Page<PostResponse>>,
): Promise<void> {
  const page = await feedService.getFeed(req.userId, { cursor: req.query.cursor, limit: req.query.limit });
  res.status(200).json(page);
}

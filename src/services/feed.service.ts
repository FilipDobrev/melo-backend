import type { CursorPagination, Page } from '../lib/pagination';
import { toPage } from '../lib/pagination';
import * as feedRepository from '../repositories/feed.repository';
import { attachReactions, type PostResponse } from './post.service';

/** Posts from the accounts the user follows, newest first. */
export async function getFeed(userId: string, pagination: CursorPagination): Promise<Page<PostResponse>> {
  const rows = await feedRepository.listFeed({
    followerId: userId,
    cursor: pagination.cursor,
    limit: pagination.limit,
  });
  const page = toPage(rows, pagination.limit);
  const items = await attachReactions(page.items, userId);
  return { items, nextCursor: page.nextCursor };
}

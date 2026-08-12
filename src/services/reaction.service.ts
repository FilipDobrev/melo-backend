import { NotFoundError } from '../lib/errors';
import * as postRepository from '../repositories/post.repository';
import * as reactionRepository from '../repositories/reaction.repository';
import { EMPTY_REACTION_SUMMARY, type ReactionSummary } from '../repositories/reaction.repository';

export async function upsertReaction(
  postId: string,
  userId: string,
  emoji: string,
): Promise<ReactionSummary> {
  const post = await postRepository.findOwnerId(postId);
  if (!post) throw new NotFoundError('Post not found');

  await reactionRepository.upsert(postId, userId, emoji);

  const summaries = await reactionRepository.summariesForPosts([postId], userId);
  return summaries.get(postId) ?? EMPTY_REACTION_SUMMARY;
}

export async function removeReaction(postId: string, userId: string): Promise<void> {
  const post = await postRepository.findOwnerId(postId);
  if (!post) throw new NotFoundError('Post not found');

  await reactionRepository.remove(postId, userId);
}

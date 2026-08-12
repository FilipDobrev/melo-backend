import { describe, expect, it } from 'vitest';
import { Unit } from '@prisma/client';
import { BadRequestError } from '../../lib/errors';
import { EMPTY_REACTION_SUMMARY, type ReactionSummary } from '../../repositories/reaction.repository';
import type { PostCardRow } from '../../repositories/post.repository';
import { toPostResponse, validateImageKeyOwnership } from '../post.service';

function buildRow(overrides: Partial<PostCardRow> = {}): PostCardRow {
  return {
    id: 'post-1',
    caption: 'hello',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ownerId: 'owner-1',
    owner: { id: 'owner-1', username: 'chef', profileImage: null },
    images: [{ id: 'img-1', storageKey: 'posts/owner-1/a.jpg' }],
    recipe: null,
    _count: { comments: 0 },
    ...overrides,
  };
}

describe('validateImageKeyOwnership', () => {
  it('accepts keys under the caller prefix', () => {
    expect(() =>
      validateImageKeyOwnership(['posts/owner-1/a.jpg', 'posts/owner-1/b.png'], 'owner-1'),
    ).not.toThrow();
  });

  it('rejects a key that belongs to a different user', () => {
    expect(() => validateImageKeyOwnership(['posts/someone-else/a.jpg'], 'owner-1')).toThrow(
      BadRequestError,
    );
  });

  it('rejects when only one of several keys is foreign', () => {
    expect(() =>
      validateImageKeyOwnership(['posts/owner-1/a.jpg', 'posts/owner-2/b.jpg'], 'owner-1'),
    ).toThrow(BadRequestError);
  });
});

describe('toPostResponse', () => {
  it('maps a post without a recipe to a null recipe summary', () => {
    const row = buildRow();
    const response = toPostResponse(row, EMPTY_REACTION_SUMMARY);

    expect(response.recipe).toBeNull();
    expect(response.author).toEqual({ id: 'owner-1', username: 'chef', profileImage: null });
    expect(response.images).toEqual([{ id: 'img-1', url: expect.stringContaining('posts/owner-1/a.jpg') }]);
    expect(response.commentCount).toBe(0);
  });

  it('computes recipe nutrition from ingredients when a recipe is attached', () => {
    const row = buildRow({
      recipe: {
        id: 'recipe-1',
        title: 'Omelette',
        ingredients: [
          {
            quantity: 200,
            unit: Unit.GRAM,
            product: {
              name: 'Egg',
              caloriesPer100g: 150,
              proteinPer100g: 13,
              carbsPer100g: 1,
              fatPer100g: 11,
              densityGPerMl: null,
              gramsPerPiece: null,
            },
          },
        ],
      },
    });

    const response = toPostResponse(row, EMPTY_REACTION_SUMMARY);

    expect(response.recipe).toEqual({
      id: 'recipe-1',
      title: 'Omelette',
      nutrition: { calories: 300, protein: 26, carbs: 2, fat: 22 },
    });
  });

  it('passes the reaction summary through unchanged', () => {
    const reactions: ReactionSummary = { total: 3, byEmoji: { '❤️': 2, '😂': 1 }, mine: '❤️' };
    const response = toPostResponse(buildRow(), reactions);

    expect(response.reactions).toEqual(reactions);
  });
});

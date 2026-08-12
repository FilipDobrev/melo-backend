import { z } from 'zod';

/// Emoji is stored and compared as-is; we only bound its length rather than
/// validating it is a genuine unicode emoji grapheme.
export const putReactionSchema = z.object({
  emoji: z.string().trim().min(1).max(8),
});
export type PutReactionInput = z.infer<typeof putReactionSchema>;

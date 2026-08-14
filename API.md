# Melo API v1

Base path: `/api/v1`. JSON only. Auth via `Authorization: Bearer <accessToken>`.

Error shape: `{ "error": { "code": string, "message": string, "details"?: unknown, "requestId"?: string } }`
Codes: `BAD_REQUEST` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `VALIDATION_FAILED` 422, `INTERNAL` 500.
`requestId` is only present on 5xx responses (4xx is the caller's own fault, nothing to correlate).
It also matches the `X-Request-Id` header on every response, and the id in the server's log line
for that request - hand it to support to find the exact log entry.

## Health

Not under `/api/v1`, and not rate limited.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Liveness. 200 `{ "status": "ok" }` as long as the process is up. Never touches the database. |
| GET | `/health/ready` | Readiness. Runs `SELECT 1` against Postgres. 200 `{ "status": "ok" }`, or 503 `{ "status": "error", "message": string }` if the database is unreachable. |

Point container/orchestrator liveness probes at `/health` and readiness probes at `/health/ready`.
A database blip should make an instance temporarily unready, not restart it.

## Rate limiting

All limiters return 429 with the same error envelope, `code: "TOO_MANY_REQUESTS"`.
Every limiter's window and ceiling is environment-configurable, see `.env.example`.

- Whole API (`/api/v1/**`): 300 requests/minute per IP by default.
- `/auth/register`, `/auth/login`: 10 attempts per 15 minutes per IP by default.
- `POST /posts/images/upload-url`, `POST /recipes/images/upload-url`,
  `POST /users/me/avatar/upload-url`: 10 requests per 5 minutes per IP by default -
  tighter because each call mints write access to object storage.

**Note on testing**: The integration test suite sets its own higher ceilings (see `tests/integration/env.ts`)
to accommodate many requests from localhost without triggering the limiter. Manual testing of the running app
exercises the real production limits and confirms the limiter behaves correctly under realistic load.

Paginated shape: `{ "items": T[], "nextCursor": string | null }`.
Paginated query params: `?cursor=<uuid>&limit=<1..50>` (default 20).

## Auth
| Method | Path | Auth | Body / Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | no | `{ username, email, password }` -> `{ user, accessToken, refreshToken }` |
| POST | `/auth/login` | no | `{ email, password }` -> same as register |
| POST | `/auth/refresh` | no | `{ refreshToken }` -> `{ accessToken, refreshToken }` (rotates) |
| POST | `/auth/logout` | yes | `{ refreshToken }` -> 204 |

Refresh tokens are single use and rotate: refreshing revokes the token you
presented and returns a new one. Presenting a token that was already revoked is
treated as evidence of theft or replay, not an ordinary error, so every active
refresh token for that user is revoked and all their sessions end. The response
is still a plain 401, identical to any other invalid token, so an attacker
learns nothing. An expired token is an ordinary rejection and does not end
other sessions.

## Users
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/users/me` | yes | own profile incl. email |
| PATCH | `/users/me` | yes | `{ username?, profileImage? }` |
| POST | `/users/me/avatar/upload-url` | yes | `{ contentType, contentLength }` -> `{ uploadUrl, storageKey }`, key under `avatars/<userId>/` |
| GET | `/users/:userId` | optional | public profile + counts + `isFollowing` |
| GET | `/users?search=` | optional | paginated user discovery |
| POST | `/users/:userId/follow` | yes | 204, 409 on duplicate, 400 on self |
| DELETE | `/users/:userId/follow` | yes | 204 |
| GET | `/users/:userId/followers` | optional | paginated |
| GET | `/users/:userId/following` | optional | paginated |
| GET | `/users/:userId/posts` | optional | paginated |
| GET | `/users/:userId/recipes` | optional | paginated |

`profileImage` in requests accepts a storage key obtained from the upload-url
endpoint above (must be under the caller's own `avatars/<userId>/` prefix, or
400) or, TRANSITIONALLY, a plain http(s) URL - the legacy form written
directly by the current frontend, kept working only until it is rebuilt to
use the upload flow. In every response (`/users/me`, public profiles, and
author/owner summaries embedded in posts, recipes, comments and follower
lists) `profileImage` is always a resolved, fetchable URL, or `null`.

An avatar key is verified against storage the same way post and recipe image
keys are: the object must exist, be within the size limit, have an allowed
content type, and have bytes matching that type. A key that was never uploaded
is rejected with 400. The legacy URL form is not a storage object and is not
checked.

## Products
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/products?search=` | optional | paginated |
| GET | `/products/:productId` | optional | |
| POST | `/products` | yes | `{ name, caloriesPer100g, proteinPer100g, carbsPer100g, fatPer100g, densityGPerMl?, gramsPerPiece? }` |

## Categories
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/categories` | no | full seeded list, not paginated |

## Recipes
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/recipes` | yes | `{ title, description, instructions, ingredients: [{ productId, quantity, unit }], categorySlugs: string[], imageKey? }`. Also saves the recipe to the author's own cookbook |
| GET | `/recipes?search=&categorySlugs=a,b&sort=` | optional | paginated. `sort` = `newest` (default), `oldest`, `popular` (most cookbook saves) |
| GET | `/recipes/:recipeId` | optional | full detail + computed `nutrition` + `isSaved` |
| PATCH | `/recipes/:recipeId` | yes, owner | any subset of create fields (incl. `imageKey`); ingredients replace wholesale in a transaction |
| DELETE | `/recipes/:recipeId` | yes, owner | 204 |
| POST | `/recipes/:recipeId/save` | yes | save to cookbook, 409 on duplicate |
| DELETE | `/recipes/:recipeId/save` | yes | 204 |
| GET | `/users/me/cookbook?categorySlugs=` | yes | paginated saved recipes |
| POST | `/recipes/images/upload-url` | yes | `{ contentType, contentLength }` -> `{ uploadUrl, storageKey }` presigned PUT, key under `recipes/<userId>/`. Same contract as `/posts/images/upload-url` |
| GET | `/recipes/image-presets` | no | `[{ slug, label, url }]`, the built-in image choices |

Every recipe has a picture. `imageKey` (create/update body) accepts either a
known preset in the form `preset:<slug>` (see `/recipes/image-presets` for
the slug list) or a storage key returned by `/recipes/images/upload-url`,
which must be under the caller's own `recipes/<userId>/` prefix - anything
else is rejected with 400. Omitting `imageKey` (create) or leaving it out of
a PATCH body leaves the recipe on its current image, defaulting to the
`default` preset when none was ever set. Recipe responses (`RecipeSummary`,
`RecipeDetail`, and the cookbook/collection recipe cards) always carry a
resolved `imageUrl`; the raw `imageKey` is never returned.

A non-preset `imageKey` is verified against storage on create and update,
the same way as post `imageKeys`: the object must exist, be within the size
limit, have an allowed content type, and have bytes matching that type. A
key that was never uploaded is rejected with 400. `preset:<slug>` values are
app assets, not storage objects, and are never checked against storage.

## Collections

A collection is a user-owned folder inside the cookbook. Adding a recipe to a
collection also saves it to the cookbook, so the cookbook is always the superset.
Removing it from a collection leaves the cookbook save alone.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/users/me/collections` | yes | full list, not paginated, each with `recipeCount` |
| POST | `/users/me/collections` | yes | `{ name }` -> 201, 409 on duplicate name |
| PATCH | `/users/me/collections/:collectionId` | yes, owner | `{ name }` |
| DELETE | `/users/me/collections/:collectionId` | yes, owner | 204, does not unsave the recipes |
| GET | `/users/me/collections/:collectionId/recipes` | yes, owner | paginated |
| POST | `/users/me/collections/:collectionId/recipes` | yes, owner | `{ recipeId }` -> 204, 409 on duplicate |
| DELETE | `/users/me/collections/:collectionId/recipes/:recipeId` | yes, owner | 204 |

`nutrition` = `{ calories, protein, carbs, fat }`, totals for the whole recipe.
`unit` enum: `GRAM KILOGRAM MILLILITRE LITRE CUP TABLESPOON TEASPOON PIECE`.

## Posts
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/posts/images/upload-url` | yes | `{ contentType, contentLength }` -> `{ uploadUrl, storageKey }` presigned PUT |

`contentLength` and `contentType` are part of the signature. The subsequent PUT
must send exactly those bytes and that content type, or storage rejects it with
a 403 that the API never sees. Measure the file, do not estimate.

Every key in `imageKeys` is verified against storage when the post is created:
the object must actually exist, its size must be within the 10 MB limit, its
stored content type must be one of the allowed image types, and its first
bytes must match that type's magic number. A key that was never uploaded (or
that names bytes that are not really an image) is rejected with 400. This
check only runs when a key is attached, never on read.

`PATCH /posts/:postId` accepts any subset of `{ caption, recipeId, imageKeys }`.
An absent `caption` key leaves it untouched; an explicit `caption: null` clears
it. `recipeId`, when present, must reference an existing recipe (404 if not) -
it stays required on the post, this only changes which recipe it links to.
`imageKeys`, when present, replaces the whole image set wholesale, in the
given order (order defines position) - it is not a diff, so a client must
re-send the storage keys of any existing images it wants to keep alongside
any new ones, and dropping below 1 or exceeding 10 images is rejected. Every
key, including ones already attached to the post, goes through the same
ownership and storage verification as on create.

| POST | `/posts` | yes | `{ caption?, recipeId, imageKeys: string[] }` min 1 image. `recipeId` is required: a post always documents cooking a recipe |
| GET | `/posts/:postId` | optional | detail incl. reaction summary + comment count |
| PATCH | `/posts/:postId` | yes, owner | any subset of `{ caption?, recipeId?, imageKeys? }`. 403 on non-owner, 404 on unknown post or unknown `recipeId` |
| DELETE | `/posts/:postId` | yes, owner | 204 |
| DELETE | `/posts/:postId/images/:imageId` | yes, owner | 204, refuses to remove the last image |
| PUT | `/posts/:postId/reactions` | yes | `{ emoji }` upsert own reaction |
| DELETE | `/posts/:postId/reactions` | yes | 204 |
| GET | `/posts/:postId/comments` | optional | paginated |
| POST | `/posts/:postId/comments` | yes | `{ content }` |
| DELETE | `/posts/:postId/comments/:commentId` | yes, comment author or post owner | 204 |

## Feed
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/feed` | yes | paginated, posts from followed users plus your own, newest first |

Post payload includes: `id, caption, createdAt, author {id, username, profileImage}, images [{id, url, storageKey}], recipe {id, title, nutrition, isSaved}, reactions { total, byEmoji: Record<string, number>, mine: string | null }, commentCount`.
`storageKey` is the raw object key behind `url` (the same value `publicUrlFor` used to build it), returned so a
`PATCH /posts/:postId` caller can re-send the keys of images it wants to keep.

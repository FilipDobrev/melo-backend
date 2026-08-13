# Melo API v1

Base path: `/api/v1`. JSON only. Auth via `Authorization: Bearer <accessToken>`.

Error shape: `{ "error": { "code": string, "message": string, "details"?: unknown } }`
Codes: `BAD_REQUEST` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `VALIDATION_FAILED` 422, `INTERNAL` 500.

Paginated shape: `{ "items": T[], "nextCursor": string | null }`.
Paginated query params: `?cursor=<uuid>&limit=<1..50>` (default 20).

## Auth
| Method | Path | Auth | Body / Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | no | `{ username, email, password }` -> `{ user, accessToken, refreshToken }` |
| POST | `/auth/login` | no | `{ email, password }` -> same as register |
| POST | `/auth/refresh` | no | `{ refreshToken }` -> `{ accessToken, refreshToken }` (rotates) |
| POST | `/auth/logout` | yes | `{ refreshToken }` -> 204 |

## Users
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/users/me` | yes | own profile incl. email |
| PATCH | `/users/me` | yes | `{ username?, profileImage? }` |
| GET | `/users/:userId` | optional | public profile + counts + `isFollowing` |
| GET | `/users?search=` | optional | paginated user discovery |
| POST | `/users/:userId/follow` | yes | 204, 409 on duplicate, 400 on self |
| DELETE | `/users/:userId/follow` | yes | 204 |
| GET | `/users/:userId/followers` | optional | paginated |
| GET | `/users/:userId/following` | optional | paginated |
| GET | `/users/:userId/posts` | optional | paginated |
| GET | `/users/:userId/recipes` | optional | paginated |

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
| POST | `/recipes` | yes | `{ title, description, instructions, ingredients: [{ productId, quantity, unit }], categorySlugs: string[] }`. Also saves the recipe to the author's own cookbook |
| GET | `/recipes?search=&categorySlugs=a,b&sort=` | optional | paginated. `sort` = `newest` (default), `oldest`, `popular` (most cookbook saves) |
| GET | `/recipes/:recipeId` | optional | full detail + computed `nutrition` + `isSaved` |
| PATCH | `/recipes/:recipeId` | yes, owner | any subset of create fields; ingredients replace wholesale in a transaction |
| DELETE | `/recipes/:recipeId` | yes, owner | 204 |
| POST | `/recipes/:recipeId/save` | yes | save to cookbook, 409 on duplicate |
| DELETE | `/recipes/:recipeId/save` | yes | 204 |
| GET | `/users/me/cookbook?categorySlugs=` | yes | paginated saved recipes |

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

| POST | `/posts` | yes | `{ caption?, recipeId, imageKeys: string[] }` min 1 image. `recipeId` is required: a post always documents cooking a recipe |
| GET | `/posts/:postId` | optional | detail incl. reaction summary + comment count |
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
| GET | `/feed` | yes | paginated, posts from followed users, newest first |

Post payload includes: `id, caption, createdAt, author {id, username, profileImage}, images [{id, url}], recipe {id, title, nutrition, isSaved}, reactions { total, byEmoji: Record<string, number>, mine: string | null }, commentCount`.

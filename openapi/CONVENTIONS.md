# OpenAPI conventions

This is the machine-readable contract for the Melo API. `API.md` at the repo
root stays the prose companion — when you add or change an endpoint here,
update `API.md` too. Where the two ever disagree, the code (`src/routes`,
`src/dto/*.dto.ts`, the service response types) is truth; file a fix here and
in `API.md`, don't guess.

## Adding a new endpoint, step by step

1. Read the route in `src/routes/*.routes.ts` for the real method, path,
   middleware (`optionalAuth` vs `authed`, rate limiter) and validated
   params/query/body schemas. Read the matching `src/dto/*.dto.ts` for the
   zod shapes — those are the request contract, not API.md's prose.
2. Read the controller and service to see the actual response shape
   (service response interfaces are the response contract) and every error
   the service can throw for this operation.
3. Work out the path file's location and name (see below) and create it.
4. Reuse everything you can from `components/`. Add a new schema/response/
   parameter/request file only if nothing existing fits — check the
   directory listing first, this document does not enumerate every
   component.
5. Add exactly one line to the `paths:` map in `openapi.yaml`, in the
   correct tag group, uncommenting the placeholder line if one is already
   there for this path.
6. Run `npm run openapi:lint` and `npm run openapi:bundle`. Both must pass.

## File naming

- One file per path (not per operation) under `paths/`. GET/PATCH/DELETE
  on the same URL are three keys (`get:`, `patch:`, `delete:`) in the one
  file — see `paths/posts/postId.yaml` for the pattern.
- Directory = the resource's **tag**, lowercased (`auth`, `users`,
  `products`, `categories`, `recipes`, `collections`, `posts`, `feed`,
  `health`). This is almost always the URL's first path segment.
- Filename = the remaining path segments after the resource root, joined
  with `-`, with `{}` stripped from path parameters. Examples:
  - `/auth/login` → `paths/auth/login.yaml`
  - `/posts/{postId}` → `paths/posts/postId.yaml`
  - `/posts/{postId}/comments/{commentId}` →
    `paths/posts/postId-comments-commentId.yaml`
  - `/users/{userId}/followers` → `paths/users/userId-followers.yaml`
- A path that IS the resource root (nothing left after stripping the first
  segment) is `index.yaml`: `/posts` → `paths/posts/index.yaml`,
  `/categories` → `paths/categories/index.yaml`.
- **Exception**: Collections and the cookbook live under the `/users/me/…`
  URL prefix but belong to the `Collections` and `Recipes` tags
  respectively. File them under the tag's directory, and drop the shared
  `/users/me/collections` (or `/users/me/cookbook`) prefix from the
  filename: `/users/me/collections/{collectionId}/recipes` →
  `paths/collections/collectionId-recipes.yaml`. `openapi.yaml` has a
  comment marking this exception where it applies — follow the existing
  commented-out lines, don't reinvent the mapping.
- Components are one file per schema/response/parameter/request, named
  exactly as the component (`components/schemas/RecipeDetail.yaml`, not
  `recipe-detail.yaml`). The filename becomes the component's name when
  bundled, so get the casing right the first time.

## `components/schemas` vs. inline

Put a shape in `components/schemas` when it is a named domain object with
its own identity (returned from more than one place, or substantial enough
to be worth naming) — e.g. `RecipeSummary`, `Post`, `Comment`. Small,
single-use nested objects that only ever appear embedded in one parent
(e.g. the `author { id, username, profileImage }` summary embedded in
`Post`/`Comment`/`RecipeSummary`) stay inline in the parent schema rather
than becoming their own file — extracting them would add indirection
without adding reuse. If you find yourself repeating the same inline
shape in two schema files, extract it.

Every property needs a `description`. Mark `required` accurately — a
missing-vs-present distinction is often the most important thing a
generated client needs to get right (see the nullable section below).

## Pagination

Every paginated list response is `{ items: T[], nextCursor: string | null }`
(`src/lib/pagination.ts`'s `Page<T>`). The chosen pattern: `PaginationFields`
(`components/schemas/PaginationFields.yaml`) holds the shared `nextCursor`
field, and each paginated response is a small per-resource schema composed
with `allOf`:

```yaml
description: A page of posts.
allOf:
  - $ref: './PaginationFields.yaml'
  - type: object
    required: [items]
    properties:
      items:
        type: array
        items:
          $ref: './Post.yaml'
```

Why a small named schema per resource instead of a shared generic
`Page`-of-anything: OpenAPI 3.1/JSON Schema has no generics, so a truly
generic page type would need `items` re-declared with `unevaluatedProperties`
tricks at every use site anyway. A one-line composition per resource
(`PostPage.yaml`, `RecipeSummaryPage.yaml`, …) is just as short to write,
gives the page type an actual name in generated clients/docs, and keeps the
`allOf` pattern uniform. Name these `<ItemSchema>Page.yaml` and put them
next to the item schema they page over. Every paginated endpoint also uses
the shared `cursor` and `limit` query parameters
(`components/parameters/cursor.yaml`, `limit.yaml`) — don't redeclare them
inline.

## Nullable fields (OpenAPI 3.1)

This is 3.1, not 3.0: nullable is expressed with a type array, not a
`nullable: true` keyword.

```yaml
profileImage:
  type:
    - string
    - 'null'
```

Get absent-vs-null right when the DTO distinguishes them. `PATCH
/posts/{postId}`'s `caption` is the canonical example: omitting the key
leaves the caption untouched, `caption: null` clears it, and a string sets
it. That means `caption` must NOT be in the request schema's `required`
list, and its `type` must include `'null'` — both need to be true at once
for the three-state behaviour to be representable. See
`components/requests/UpdatePostRequest.yaml`. When a DTO uses
`.nullable().optional()` in zod, that is your signal to do the same here.

## Operation IDs

Every operation needs an `operationId`, camelCase, verb-first, matching the
service function name where one exists (`login`, `getPost`, `updatePost`,
`deletePost`). Where an endpoint has no 1:1 service function (e.g. it
composes two calls), name it the way a generated SDK method should read:
`<verb><Resource>[By<Qualifier>]`, e.g. `listUserPosts`,
`addRecipeToCollection`. Keep it unique across the whole document — redocly
lint will fail the bundle otherwise.

## Auth

The document's default `security` is `bearerAuth`. Override per operation:

- Fully public (no auth ever affects the response): `security: []`.
- Optional auth (response is personalised if authenticated, but works
  anonymously — e.g. `GET /posts/{postId}`): `security: [{}, bearerAuth: []]`.
- Required auth: omit `security` and let the document default apply.

## Errors

Every operation should reference the shared response components
(`components/responses/*.yaml`) rather than redeclaring the `Error` schema
inline. Only write a custom `content` block when the description or
example needs to be genuinely specific to that operation (see `404` on
`PATCH /posts/{postId}`, which can mean "unknown post" or "unknown
`recipeId` in the body" — worth spelling out, not worth a new shared
response). Always include `429` and `500` — every route sits behind the
whole-API rate limiter and can hit an unexpected server error.

## Tooling

`npm run openapi:lint` (redocly lint) and `npm run openapi:bundle`
(bundles to `openapi/bundled.yaml`, gitignored — it's generated, don't
edit or commit it) must both pass before you're done.

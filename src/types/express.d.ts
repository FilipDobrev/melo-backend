declare global {
  namespace Express {
    interface Request {
      /// Set by requireAuth. Optional because this augmentation applies to
      /// every request in the app, including public routes. Controllers on
      /// guarded routes read the non-optional `userId` on AuthorizedRequest
      /// instead of reaching for this.
      userId?: string;
    }
  }
}

export {};

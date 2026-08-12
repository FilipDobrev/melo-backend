declare global {
  namespace Express {
    interface Request {
      /// Set by requireAuth. Absent on public routes.
      user?: { id: string };
    }
  }
}

export {};

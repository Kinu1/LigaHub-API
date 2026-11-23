import type { Request, Response, NextFunction } from 'express';
export function communicationsNoStore(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (
    /^\/events\/[^/]+\/communications(?:\/|$)/.test(req.path) ||
    req.path === '/notifications/resend/webhook'
  )
    res.setHeader('Cache-Control', 'no-store');
  next();
}

import { NextFunction, Request, Response } from "express";

type AsyncRoute = (
  request: Request,
  response: Response,
  next: NextFunction
) => Promise<void>;

export function asyncHandler(fn: AsyncRoute) {
  return (request: Request, response: Response, next: NextFunction): void => {
    fn(request, response, next).catch(next);
  };
}

import { NextFunction, Request, Response } from "express";
import { AppError } from "../common/errors";
import { verifyAccessToken } from "../lib/jwt";

export function requireAuth(
  request: Request,
  _response: Response,
  next: NextFunction
): void {
  const authorization = request.headers.authorization;

  if (!authorization) {
    throw new AppError("Authorization header ausente.", 401);
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AppError("Authorization header inválido.", 401);
  }

  request.auth = verifyAccessToken(token);
  next();
}

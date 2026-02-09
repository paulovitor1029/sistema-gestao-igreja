import jwt from "jsonwebtoken";
import { AppError } from "../common/errors";
import { env } from "../config/env";
import { AuthPayload, tenantRoles, TenantRole } from "../types/auth";

type JwtClaims = jwt.JwtPayload & {
  tenantId?: string;
  role?: string;
};

function isTenantRole(value: string): value is TenantRole {
  return tenantRoles.includes(value as TenantRole);
}

export function signAccessToken(payload: AuthPayload): string {
  const options: jwt.SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    subject: payload.userId
  };

  return jwt.sign(
    {
      tenantId: payload.tenantId,
      role: payload.role
    },
    env.JWT_SECRET,
    options
  );
}

export function verifyAccessToken(token: string): AuthPayload {
  let decoded: string | JwtClaims;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (_error) {
    throw new AppError("Token invalido ou expirado.", 401);
  }

  if (typeof decoded === "string") {
    throw new AppError("Token invalido.", 401);
  }

  const userId = decoded.sub;
  const tenantId = decoded.tenantId;
  const role = decoded.role;

  if (!userId || !tenantId || !role || !isTenantRole(role)) {
    throw new AppError("Token invalido.", 401);
  }

  return {
    userId,
    tenantId,
    role
  };
}

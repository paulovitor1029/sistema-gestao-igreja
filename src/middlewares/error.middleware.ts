import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../common/errors";

export function errorMiddleware(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction
): Response {
  if (error instanceof ZodError) {
    return response.status(400).json({
      message: "Dados inválidos.",
      issues: error.flatten()
    });
  }

  if (error instanceof AppError) {
    return response.status(error.statusCode).json({
      message: error.message
    });
  }

  console.error(error);
  return response.status(500).json({
    message: "Erro interno do servidor."
  });
}

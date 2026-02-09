import express from "express";
import helmet from "helmet";
import path from "path";
import { authRoutes } from "./routes/auth.routes";
import { errorMiddleware } from "./middlewares/error.middleware";

export const app = express();
const publicPath = path.resolve(process.cwd(), "public");

app.use(helmet());
app.use(express.json());
app.use(express.static(publicPath));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/auth", authRoutes);
app.use(errorMiddleware);

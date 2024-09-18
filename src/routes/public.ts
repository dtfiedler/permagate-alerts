// router for public routes
import { Router } from "express";

import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const publicRouter = Router();

publicRouter.get("/:file(*)", (req, res) => {
  const filePath = path.join(__dirname, "../public/", req.params.file);
  res.sendFile(filePath);
});

publicRouter.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

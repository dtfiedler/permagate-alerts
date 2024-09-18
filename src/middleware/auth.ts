import { auth } from "express-oauth2-jwt-bearer";
import {
  auth0Audience,
  auth0Domain,
  auth0ClientId,
  auth0ClientSecret,
} from "../config.js";
import { ManagementClient } from "auth0";
import { Response, Request, NextFunction } from "express";

export const auth0: ManagementClient = new ManagementClient({
  domain: auth0Domain!,
  clientId: auth0ClientId!,
  clientSecret: auth0ClientSecret!,
  audience: auth0Audience,
  useMTLS: false,
});

const checkJwt = auth({
  audience: auth0Audience,
  issuerBaseURL: `https://${auth0Domain}`,
});

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // call auth and then set the user id in the context
  checkJwt(req, res, async () => {
    // return unauthorized if no user
    if (!req.auth?.payload) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    return next();
  });
};

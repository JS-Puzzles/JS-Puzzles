import crypto from "node:crypto";
import type { APIGatewayProxyEvent } from "aws-lambda";
import * as cookie from "cookie";
import * as jwt from "jsonwebtoken";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

import { ClientError } from "./lambda-utils.js";

export interface SessionJwtPayload {
  id: string;
  csrf: string;
}

const NOT_LOGGED_IN_ERROR = new ClientError("Not logged in", 401);
const JWT_ALGORITHM: jwt.Algorithm = "ES256";
const SESSION_JWT_COOKIE = "session";

export const requireSecret = async (paramName: string): Promise<string> => {
  const ssmClient = new SSMClient({});
  const { Parameter: parameter } = await ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    }),
  );
  const value = parameter?.Value;
  if (!value) {
    throw new Error(`Secret parameter '${paramName}' not found or empty`);
  }
  return value;
};

let _cachedPrivateKey: string | undefined = undefined;
const getPrivateKey = async () => {
  if (!_cachedPrivateKey) {
    _cachedPrivateKey = await requireSecret("SessionJwtPrivateKey");
  }
  return _cachedPrivateKey;
};

export const generateSessionCookieHeader = async (
  userId: string,
): Promise<Record<"Set-Cookie", string>> => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  const jwt = await generateSessionJwt(userId);
  return {
    "Set-Cookie": cookie.serialize(SESSION_JWT_COOKIE, jwt, {
      path: "/",
      httpOnly: true,
      expires: expiresAt,
    }),
  };
};

export const generateSessionJwt = async (userId: string): Promise<string> => {
  const csrf = crypto.pseudoRandomBytes(12).toString("base64");
  const payload: SessionJwtPayload = { id: userId, csrf };
  return jwt.sign(payload, await getPrivateKey(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: "90d",
  });
};

export const requireAuth = async (
  evt: APIGatewayProxyEvent,
): Promise<SessionJwtPayload> => {
  const cookieHeader = evt.headers["cookie"];
  if (!cookieHeader) throw NOT_LOGGED_IN_ERROR;
  const cookies = cookie.parse(cookieHeader);
  const token = cookies[SESSION_JWT_COOKIE];
  if (!token) throw NOT_LOGGED_IN_ERROR;
  try {
    const payload = jwt.verify(token, await getPrivateKey(), {
      algorithms: [JWT_ALGORITHM],
    }) as SessionJwtPayload;
    return payload;
  } catch (err) {
    throw new ClientError(`Session token: ${err}`);
  }
};

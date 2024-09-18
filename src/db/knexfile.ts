import Knex from "knex";
import * as config from "../config.js";
import path from "path";

import { fileURLToPath } from "url";

// Derive __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// create the knex connection
export const knexConfig: Record<string, Knex.Knex.Config> = {
  local: {
    client: "better-sqlite3",
    connection: {
      filename: path.join(__dirname, "../../data/sqlite/core-local.db"),
    },
    migrations: {
      directory: path.join(__dirname, "./migrations"),
      extension: "ts",
    },
    useNullAsDefault: true,
    debug: config.debugKnex,
  },
  development: {
    client: "better-sqlite3",
    connection: {
      filename: path.join(__dirname, "../../data/sqlite/core-dev.db"),
    },
    migrations: {
      directory: path.join(__dirname, "./migrations"),
      extension: "js",
    },
    useNullAsDefault: true,
    debug: config.debugKnex,
  },
  test: {
    client: "better-sqlite3",
    connection: {
      filename: path.join(__dirname, "../../data/sqlite/core-test.db"),
    },
    migrations: {
      directory: path.join(__dirname, "./migrations"),
      extension: "js",
    },
    useNullAsDefault: true,
    debug: config.debugKnex,
  },
};

export const knex = Knex(knexConfig[config.environment]);

export default knexConfig;

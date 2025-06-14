# Permagate Notification Service

## Table of Contents

<!-- toc -->

- [Table of Contents](#table-of-contents)
- [AR.IO Gateway](#ario-gateway)
- [Getting Started](#getting-started)
  - [Requirements](#requirements)
  - [Running Locally](#running-locally)
- [Authentication](#authentication)
- [Mailgun](#mailgun)
- [Database](#database)
  - [Migrations](#migrations)
- [Docker](#docker)

<!-- tocstop -->

# About

This service acts as a notification service for IO contract events from the [ar.io](https://ar.io) network process. It can be set up to run alongside any [ar.io](https://ar.io) gateway.

## AR.IO Gateway

In order to integrate with an ar.io gateway, you must update the `WEBHOOK_SERVERS` environment variable with the url that the gateway can send webhook requests to. You can read more about setting up a gateway here. Additionally, it is recommended the gateway have the following environment variables configured `ARNS_UNBUNDLE_FILTER=XXX` `ANS_104_UNBUNDLE_FILTER` and `ANS_104_INDEX_FILTER` set to the following.

Example (permagate.io .env)

```shell
ANS_104_UNBUNDLE_FILTER=
ANS_104_INDEX_FILTER=
WEBHOOK_SERVERS_URL=
WEBHOOK_INDEX_FILTER=
```

# Developers

## Getting Started

### Requirements

- `nvm`
- `node` (>=18)
- `yarn`
- `sqlite3`
- `docker`

All should be easy to install on a Mac via `homebrew` (e.g. `brew install <name>`). Refer to their documentation if any issues.

### Running Locally

- `cp .env.example .env` - creates a local environment file, update the values as necessary
- `yarn start` - runs the service in watch mode
- `yarn build` - builds the service

## Authentication

[Auth0](https://auth0.com/) is used to authenticate users. The [auth0](https://www.npmjs.com/package/auth0) package is used to interact with the Auth0 API. The backend service validates tokens from the frontend and parses out the included `email` claim to identify the user (note: we will replace this in the future). Auth0 requires the following environment variables:

- `AUTH0_DOMAIN` - the domain for the Auth0 API
- `AUTH0_IDENTIFIER` - the `issuer` for the Auth0 API that is included in all JWT
- `AUTH0_NAMESPACE` - the namespace for the Auth0 API that is included in all JWT, used to identify special claims on the JWT (e.g. `email`)
- `AUTH0_CLIENT_ID` - the client ID for the Auth0 API
- `AUTH0_CLIENT_SECRET` - the client secret for the Auth0 API
- `AUTH0_CALLBACK_URL` - the callback URL for the Auth0 API (e.g. `http://localhost:3000/auth/callback`)

## Mailgun

The service uses [Mailgun](https://www.mailgun.com/) to send emails. The following environment variables should be set:

- `MAILGUN_API_KEY` - the API key for Mailgun
- `MAILGUN_DOMAIN` - the domain for Mailgun
- `MAILGUN_FROM` - the email address to send from

## Market Data

If you would like notification emails to display the current USD value of
`$ARIO`, provide a CoinMarketCap API key via the `MARKET_CAP_API_KEY` environment
variable. When set, the service will fetch the latest exchange rate and include
approximate conversions in relevant messages.

## Database

The service uses a SQLite database store user data. The database is stored in the `data` directory. The database schema is defined in [src/db/schema.sql](./src/db/schema.ts). [Knex](https://knexjs.org/guide/#node-js) is used to perform database migrations and queries.

### Migrations

- `yarn knex migrate:latest` - runs the latest migration
- `yarn knex migrate:rollback` - rolls back the latest migration
- `yarn knex migrate:make <name>` - creates a new migration

## Docker

The image can be built and run using Docker.

- `docker build -t permagate-alerts .` - builds the docker image
- `docker run -p 3000:3000 --env-file .env -v ${PWD}/data:/usr/src/app/data permagate-alerts` - runs the docker image and attaches the data directory

Alternatively, the service can be run using `docker-compose`.

- `docker-compose up` - runs the service using `docker-compose` and defaults to using the .env file for environment variables

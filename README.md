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

The service depends on the ar.io gateway GraphQL endpoint (defaulting to `https://arweave-search.goldsky.com`) which provides indexed data from the ARIO contract for querying contract events and state.

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

The service uses magic link authentication. Users receive an email with a secure link that allows them to authenticate without passwords. The authentication is handled by the service itself using secure tokens.

## AWS SES

The service uses [AWS SES (Simple Email Service)](https://aws.amazon.com/ses/) to send emails including magic link authentication emails and notifications. The following environment variables should be set:

- `AWS_REGION` - the AWS region for SES
- `AWS_ACCESS_KEY_ID` - the AWS access key ID
- `AWS_SECRET_ACCESS_KEY` - the AWS secret access key
- `SES_FROM_EMAIL` - the email address to send from (must be verified in AWS SES)

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

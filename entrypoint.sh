#!/bin/sh

# Create DB directory if necessary
mkdir -p data/sqlite

mkdir -p /usr/src/app/dist/db/migrations

# Run database migrations
/nodejs/bin/node /usr/src/app/dist/migrate.js

# make our temp directory
mkdir -p /usr/src/app/dist/public/temp

# Run the application
exec /nodejs/bin/node /usr/src/app/dist/app.js

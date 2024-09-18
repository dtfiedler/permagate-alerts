#!/usr/bin/env sh

exec /nodejs/bin/node -e 'require("http").get("http://localhost:3000/healthcheck", (res) => { if(res.statusCode !== 200) process.exit(1); }).on("error", (err) => { process.exit(1); })'

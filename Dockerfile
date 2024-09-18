ARG NODE_VERSION=20.15.0
ARG NODE_VERSION_SHORT=20

FROM node:${NODE_VERSION}-bullseye-slim AS builder

# Needed for some dev deps
RUN apt-get update && apt-get install -y git

# Build
WORKDIR /usr/src/app
COPY . .
RUN yarn && yarn build

# Extract dist
FROM gcr.io/distroless/nodejs${NODE_VERSION_SHORT}-debian11
WORKDIR /usr/src/app

# Add shell
COPY --from=busybox:1.35.0-uclibc /bin/sh /bin/sh
COPY --from=busybox:1.35.0-uclibc /bin/mkdir /bin/mkdir

# Copy build files
COPY --from=builder /usr/src/app .

# Setup port
EXPOSE 3000
HEALTHCHECK CMD /bin/sh healthcheck.sh

# Add labels
LABEL org.opencontainers.image.title="permagate.io Notification Service"

ENTRYPOINT [ "/bin/sh", "entrypoint.sh" ]

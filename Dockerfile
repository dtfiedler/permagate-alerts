ARG NODE_VERSION=22.14.0
ARG NODE_VERSION_SHORT=22

FROM node:${NODE_VERSION}-bookworm-slim AS builder

# Needed for some dev deps
RUN apt-get update && apt-get install -y git

# Skip puppeteer download
ENV PUPPETEER_SKIP_DOWNLOAD=true
# (optional extra coverage)
ENV PUPPETEER_SKIP_CHROME_DOWNLOAD=true

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

FROM debian:bookworm-slim

ARG GSH_RELEASE_VERSION=dev
ARG GSH_BUILD_SHA=unknown
ENV GSH_RELEASE_VERSION=${GSH_RELEASE_VERSION}
ENV GSH_BUILD_SHA=${GSH_BUILD_SHA}
LABEL org.opencontainers.image.version="${GSH_RELEASE_VERSION}"
LABEL org.opencontainers.image.revision="${GSH_BUILD_SHA}"

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    lib32gcc-s1 \
    lib32stdc++6 \
    libc6-i386 \
    libcurl3-gnutls \
    libcurl4 \
    libstdc++6 \
    libgcc-s1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /game
ENV GAME_ROOT=/game

# Game binaries are installed by SteamCMD into the mounted volume; panel supplies Cmd at run time.
ENTRYPOINT ["/bin/sh", "-c", "exec \"$@\"", "--"]

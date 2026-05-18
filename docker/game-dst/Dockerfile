FROM debian:bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    lib32gcc-s1 \
    lib32stdc++6 \
    libc6-i386 \
    libcurl4 \
    libstdc++6 \
    libgcc-s1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /game
ENV GAME_ROOT=/game

# Game binaries are installed by SteamCMD into the mounted volume; panel supplies Cmd at run time.
ENTRYPOINT ["/bin/sh", "-c", "exec \"$@\"", "--"]

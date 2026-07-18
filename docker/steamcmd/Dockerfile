FROM debian:bookworm-slim

ARG GSH_RELEASE_VERSION=dev
ARG GSH_BUILD_SHA=unknown
ARG STEAMCMD_ARCHIVE_URL=https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
ARG STEAMCMD_ARCHIVE_SHA256=

LABEL org.opencontainers.image.title="Game Server Hub SteamCMD runtime"
LABEL org.opencontainers.image.description="SteamCMD runtime used by Game Server Hub game and Workshop installers"
LABEL org.opencontainers.image.source="https://github.com/GameServerHub/game-server-hub"
LABEL org.opencontainers.image.version="${GSH_RELEASE_VERSION}"
LABEL org.opencontainers.image.revision="${GSH_BUILD_SHA}"

RUN dpkg --add-architecture i386 \
  && apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libc6-i386 \
    lib32gcc-s1 \
    lib32stdc++6 \
    libcurl4:i386 \
  && useradd --create-home --uid 1000 --shell /bin/bash steam \
  && install -d -o steam -g steam /home/steam/steamcmd \
  && curl --fail --location --retry 3 --retry-delay 2 --output /tmp/steamcmd.tar.gz "${STEAMCMD_ARCHIVE_URL}" \
  && if [ -n "${STEAMCMD_ARCHIVE_SHA256}" ]; then echo "${STEAMCMD_ARCHIVE_SHA256}  /tmp/steamcmd.tar.gz" | sha256sum --check --strict; fi \
  && tar --extract --gzip --file /tmp/steamcmd.tar.gz --directory /home/steam/steamcmd \
  && chown -R steam:steam /home/steam/steamcmd \
  && for attempt in 1 2 3; do \
    if su -s /bin/sh steam -c '/home/steam/steamcmd/steamcmd.sh +quit'; then break; fi; \
    if [ "${attempt}" = 3 ]; then exit 1; fi; \
    sleep 5; \
  done \
  && rm -rf /var/lib/apt/lists/* /tmp/steamcmd.tar.gz

USER steam
WORKDIR /home/steam/steamcmd
CMD ["/bin/true"]

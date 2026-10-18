# G-T16 proxy (D-06, D-08): Caddy with the caddy-ratelimit plugin, pinned to a commit.
FROM caddy:2.10.0-builder AS build
RUN xcaddy build v2.10.0 --with github.com/mholt/caddy-ratelimit@5625512f24f6f59d6f64fb3aafe5eecff0b286db

FROM caddy:2.10.0
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile

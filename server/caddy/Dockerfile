# Caddy with the forward-proxy plugin: an HTTPS proxy (TLS to the proxy, so the network in between only sees
# this server's name) with a certificate from Let's Encrypt, obtained and renewed by Caddy itself.
#
# Everything here is pinned. This image holds the built-in proxy's password, so a rebuild must not pull whatever a tag
# or a branch points to that day. Images: tag + digest; Dependabot (.github/dependabot.yml) proposes new ones. The
# plugin: a commit, because forwardproxy has no Go-style version tags ("1.0.1" is not "v1.0.1"). Without a version,
# xcaddy builds from master. Dependabot can't bump it: to update, take the newest commit from
# https://github.com/caddyserver/forwardproxy/commits/master and rebuild.
FROM caddy:2.11.9-builder@sha256:3fddbec729442a56b942d4c9eaef1df80893dbf2cf5b86701bfae6aad1408eeb AS builder
RUN xcaddy build --with github.com/caddyserver/forwardproxy@0aab84dad4fc2830789f34e27b4d7bc22a40889e

FROM caddy:2.11.9@sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
# Caddy defaults to root; run as the unprivileged caddy user (uid 101) instead.
# NET_BIND_SERVICE (added in docker-compose) lets it bind ports 80/443.
USER caddy

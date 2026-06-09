# Pinned image for the data pipeline: curl + docker-cli are baked in, so a
# container (re)start needs no package-mirror access at runtime. run.sh stays
# bind-mounted by docker-compose.yml so it remains live-editable.
FROM alpine:3.21
RUN apk add --no-cache curl docker-cli

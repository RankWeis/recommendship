# PowerSync with our config baked in, for Fly. Locally, docker compose mounts the same files.
FROM journeyapps/powersync-service:1.27.0
COPY docker/powersync/service.yaml docker/powersync/sync-config.yaml /config/
ENV POWERSYNC_CONFIG_PATH=/config/service.yaml NODE_OPTIONS=--max-old-space-size=800
CMD ["start", "-r", "unified"]

-- Local development only: roles PowerSync uses to read the replication stream
-- and to keep its own bucket storage. On Neon these are created by hand
-- (see docs/deploy.md) with real passwords.
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'powersync';

CREATE ROLE powersync_storage_user WITH LOGIN PASSWORD 'powersync';
CREATE DATABASE powersync_storage OWNER powersync_storage_user;

-- PowerSync replicates exactly the tables in a publication named `powersync`.
-- Only synced tables are listed: invites and Better Auth's tables stay server-side.
-- The replication role itself (with its password) is created outside migrations:
-- by docker/postgres/init.sql locally, and by hand on Neon (see docs/deploy.md).
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
		CREATE PUBLICATION powersync FOR TABLE app_user, category, recommender, item, recommendation;
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powersync_role') THEN
		GRANT SELECT ON app_user, category, recommender, item, recommendation TO powersync_role;
	END IF;
END $$;

-- Initialize roles and test databases for VinOps
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinops_owner') THEN
    CREATE ROLE vinops_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinops_app') THEN
    CREATE ROLE vinops_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinops_worker') THEN
    CREATE ROLE vinops_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinops_app_user') THEN
    CREATE ROLE vinops_app_user WITH LOGIN PASSWORD 'vinops_password';
  END IF;
END
$$;

GRANT vinops_owner TO postgres;
GRANT vinops_app TO postgres;
GRANT vinops_worker TO postgres;
GRANT vinops_app TO vinops_app_user;
GRANT vinops_worker TO vinops_app_user;

SELECT 'CREATE DATABASE vinops' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'vinops')\gexec
SELECT 'CREATE DATABASE vinops_mega001_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'vinops_mega001_test')\gexec
SELECT 'CREATE DATABASE vinops_mega001_i4_worker_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'vinops_mega001_i4_worker_test')\gexec
SELECT 'CREATE DATABASE vinops_mega002_i1_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'vinops_mega002_i1_test')\gexec
SELECT 'CREATE DATABASE vinops_mega002_i2_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'vinops_mega002_i2_test')\gexec

CREATE DATABASE dazza_identity;
\connect dazza_identity
CREATE TABLE profiles (
    identity_hash char(64) PRIMARY KEY,
    username varchar(30) NOT NULL UNIQUE CHECK (username ~ '^[a-z][a-z0-9_]{2,29}$'),
    display_name varchar(80) NOT NULL,
    matrix_user_id text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- Synapse owns and migrates its own relational schema in the synapse database.
-- Do not duplicate messages, devices, keys, memberships or receipts here.

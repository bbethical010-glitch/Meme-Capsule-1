-- 009_add_api_password_to_users.sql
-- Adds dedicated API key encryption password hash column to cat_users.
-- Enables judges to protect their personal AI provider keys when sharing account credentials with colleagues.

ALTER TABLE cat_users ADD COLUMN api_password_hash TEXT;

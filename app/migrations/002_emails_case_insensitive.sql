-- Sign-in already matched emails case-insensitively; enrollment didn't, so two accounts could
-- differ only by case. Store lower-case and enforce uniqueness that way.

UPDATE users SET email = lower(email);

ALTER TABLE users DROP CONSTRAINT users_email_key;
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

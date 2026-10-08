CREATE TABLE IF NOT EXISTS debate_state (
 id integer PRIMARY KEY CHECK (id = 1),
 version integer NOT NULL DEFAULT 0,
 data jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS debate_images (
 id uuid PRIMARY KEY,
 mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
 data text NOT NULL CHECK (length(data) <= 2800000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS debate_login_limits (
 key text PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 1,
 window_start timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS debate_presence (
 screen integer PRIMARY KEY CHECK (screen BETWEEN 0 AND 99),
 seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

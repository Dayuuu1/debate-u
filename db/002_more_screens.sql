-- 0: moderador, 1-8: tótems, 99: vista general. Amplía bases creadas con la versión de 3 tótems.
ALTER TABLE debate_presence DROP CONSTRAINT IF EXISTS debate_presence_screen_check;
ALTER TABLE debate_presence ADD CONSTRAINT debate_presence_screen_check CHECK (screen BETWEEN 0 AND 99);

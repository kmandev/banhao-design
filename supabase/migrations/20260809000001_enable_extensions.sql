-- BANHAO — enable required Postgres extensions
--
-- PostGIS is enabled now, ahead of the geospatial work it will serve (driver
-- matching, delivery distance, the Admin live map). Enabling it early keeps the
-- migration ordering simple; it costs nothing until used.

create extension if not exists "uuid-ossp";
create extension if not exists postgis;

comment on extension postgis is
  'Geospatial support for driver matching and delivery distance. See ai/RESEARCH/DATABASE_COMPARISON.md.';

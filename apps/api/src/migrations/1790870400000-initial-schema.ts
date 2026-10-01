import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1790870400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE albums (
      id uuid PRIMARY KEY,
      name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
      description varchar(2000) NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(`CREATE TABLE photos (
      id uuid PRIMARY KEY,
      album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      original_name varchar(255) NOT NULL,
      mime varchar(40) NOT NULL,
      size integer NOT NULL CHECK (size > 0),
      width integer NOT NULL CHECK (width > 0),
      height integer NOT NULL CHECK (height > 0),
      original_path text NOT NULL UNIQUE,
      thumbnail_path text NOT NULL UNIQUE,
      position bigint GENERATED ALWAYS AS IDENTITY,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX photos_album_position ON photos(album_id, position)');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE photos');
    await q.query('DROP TABLE albums');
  }
}

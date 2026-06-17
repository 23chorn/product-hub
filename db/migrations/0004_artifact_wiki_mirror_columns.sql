-- Wiki sync is a one-way mirror, not a primary content store. Previously syncArtifactToWiki()
-- overwrote external_system/external_path/external_url, severing the mongodb/disk pointer and
-- making several read paths treat the artifact as "wiki-only" even though file_path (disk) was
-- still intact underneath. Split the wiki pointer into its own columns so reads stay
-- mongo -> disk -> wiki (last resort), and backfill existing wiki-synced rows accordingly.
ALTER TABLE artifacts ADD COLUMN wiki_path TEXT;
--> statement-breakpoint
ALTER TABLE artifacts ADD COLUMN wiki_url TEXT;
--> statement-breakpoint
UPDATE artifacts
SET wiki_path = external_path,
    wiki_url = external_url,
    external_system = NULL,
    external_path = NULL,
    external_url = NULL
WHERE external_system = 'azure_wiki';

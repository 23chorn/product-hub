-- Knowledge Studio repos can live in an Azure DevOps project other than the
-- globally configured AZURE_DEVOPS_PROJECT (e.g. tracking a repo from a
-- separate "xCube-Web" project). NULL means "use the configured project".
ALTER TABLE kb_repos ADD COLUMN project text;

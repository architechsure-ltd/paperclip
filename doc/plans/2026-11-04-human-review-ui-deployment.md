# Human review UI deployment plan

## Scope and compatibility

This change adds authenticated human review decisions to the task detail page and both Decisions views. It uses the existing issue execution policy and issue update endpoint. It does not add a database migration or change stored table schemas. The optional escalation fields are additive JSON state, so the current ATS database remains compatible.

The observed ATS deployment uses the existing compose-based Paperclip control-plane stack. Before staging, record the current server image reference and resolved digest from the compose host. Do not change the ATS instance, database, containers, or compose files without explicit owner authorization.

## Immutable image build

Build only from the reviewed commit on `codex/human-review-ui`:

```sh
docker build --pull --no-cache -t <approved-registry>/paperclip:<git-sha> .
docker push <approved-registry>/paperclip:<git-sha>
docker buildx imagetools inspect <approved-registry>/paperclip:<git-sha>
```

Record the resulting `sha256:` manifest digest in the deployment change record. Pin staging and production to `<approved-registry>/paperclip@sha256:<digest>`. Do not deploy a mutable tag.

## Backup and staging

1. Obtain owner authorization for infrastructure writes.
2. Record the current application image digest, compose revision, Paperclip source version, database version, and health state.
3. Create and verify the normal database backup or repository checkpoint through the established local-shell-to-SSH route.
4. Deploy the candidate digest to an isolated staging stack with a representative, non-confidential fixture.
5. Confirm health, migration status, authentication, and normal issue access before review testing.
6. Exercise Approve and Request changes from task detail, classic Decisions, and coordinator Decisions.
7. Confirm a blank comment cannot submit, the comment and transition commit together, changes return to the original Engineer, and resubmission returns to the same reviewer.
8. Confirm another user and an agent cannot decide the stage. Confirm stale and duplicate decisions return a conflict without changing the issue.
9. Confirm the existing stalled-review actions still work.
10. Confirm issue dependencies, evidence, comments, and activity history remain present.

## Deployment

After staging acceptance and explicit owner approval, update only the Paperclip application image reference in the ATS compose configuration to the reviewed digest. Keep the database and persistent volumes unchanged. Apply the compose change through the established SSH route. Verify the health endpoint, authenticated UI, background processing, and the operator checks below.

## Rollback

1. Stop further review decisions if acceptance fails.
2. Restore the exact previously recorded application image digest in the compose configuration.
3. Reapply the compose stack without deleting volumes or recreating the database.
4. Verify health, authentication, issue reads, Decisions, and background processing.
5. Restore the database backup only if an independently confirmed data-integrity fault requires it and the owner explicitly authorizes that destructive boundary. This change has no schema migration, so normal rollback is application-only.

## Operator verification

- The displayed version and image digest match the approved release record.
- An authorized current reviewer sees both decision actions on all three UI surfaces.
- Both actions require a comment and preserve it with the transition.
- Request changes returns the same issue to its original Engineer.
- Resubmission returns to the intended reviewer.
- Unauthorized, stale, and duplicate requests fail without changing state.
- Stalled-review recovery remains available.
- Existing dependencies, evidence, comments, and audit history are intact.

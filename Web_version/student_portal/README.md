# GradVoice Student Portal

This is the hosted companion to the offline ceremony application. It has its own database and storage; it never opens or synchronizes the ceremony laptop's SQLite database.

## Current scope

- Staff imports a GradVoice portal roster ZIP.
- Each imported student receives an invitation token for development/testing.
- Students use the token to edit their profile, submit an audio recording, generate Google TTS candidates, listen to candidates, and select a pronunciation.
- Staff can review submissions and approve or reject them.

The development token flow is not production authentication. Before deployment, replace it with college SSO or an approved passwordless identity provider, enable HTTPS, use PostgreSQL/object storage, configure backups, and configure Google Application Default Credentials on the portal server.

## Run locally

```bash
./setup.sh
./start.sh
```

Open http://127.0.0.1:8022. The staff token defaults to `dev-staff-token` for local development only; set `PORTAL_STAFF_TOKEN` before using the staff endpoints.

## Package workflow

1. Export a roster ZIP from the local ceremony app.
2. Upload the ZIP to the portal's staff import endpoint.
3. Deliver each returned invitation token to the matching student.
4. Students submit pronunciation audio through the portal.
5. Staff review submissions through the staff API.
6. The next slice will export approved submissions as a ceremony package for local import.

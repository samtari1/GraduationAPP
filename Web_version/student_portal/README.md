# GradVoice Student Portal

This is the hosted companion to the offline ceremony application. It has its own database and storage; it never opens or synchronizes the ceremony laptop's SQLite database.

## Current scope

- Staff imports a GradVoice portal roster ZIP.
- Each imported student receives an invitation token for development/testing.
- Students use the token to edit their profile, submit an audio recording, generate Google TTS candidates, listen to candidates, and select a pronunciation.
- Staff can review submissions and approve or reject them.
- Staff can sign in at `/staff/login`, import local roster packages, review submissions, and download an approved package for the local app.
- Staff can select an imported ceremony to view its roster, profile completion, uploaded recordings, generated pronunciation candidates, and selected audio.

The development token flow is not production authentication. Before deployment, replace it with college SSO or an approved passwordless identity provider, enable HTTPS, use PostgreSQL/object storage, configure backups, and configure Google Application Default Credentials on the portal server.

## Run locally

```bash
./setup.sh
./start.sh
```

Open http://127.0.0.1:8022 for student access, or http://127.0.0.1:8022/staff/login for staff access. The first startup creates the default database account `admin` / `admin`. Change that password from the staff dashboard immediately. The legacy `PORTAL_STAFF_TOKEN` remains available for API scripts.

The server listens on all interfaces by default so it can be reached from another machine or cloud load balancer. Configure the listener with environment variables when needed:

```bash
PORTAL_HOST=0.0.0.0 PORTAL_PORT=8022 ./start.sh
```

For a cloud deployment, expose the portal through HTTPS on the public domain, proxy the public HTTPS traffic to `127.0.0.1:8022` (or the internal `PORTAL_PORT` you choose), and allow only the proxy/security group to reach the application port. Do not expose the development database or the internal application port publicly when a reverse proxy is available. The frontend uses same-origin `/api`, `/assets`, and `/media` paths, so no local-app port or CORS configuration is required.

## Package workflow

1. Export a roster ZIP from the local ceremony app.
2. Upload the ZIP to the portal's staff import endpoint.
3. Deliver each returned invitation token to the matching student.
4. Students submit pronunciation audio through the portal.
5. Staff sign in at `/staff/login`, review submissions, and approve the desired audio.
6. Staff select the ceremony in the dashboard and click **Download approved package**.
7. On the local app, preview and import the downloaded ZIP through the ceremony portal-package controls.

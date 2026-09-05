# QuantenTunnel — Updated dashboard photos + automatic 6-digit User ID

This build includes the existing QuantenTunnel changes plus:

- Six dashboard slideshow photos, rotating globally every 24 hours before Recent Activity.
- Automatic unique 6-digit User IDs for every user.
- Existing users are assigned a permanent 6-digit User ID automatically on the first API initialization after deployment.
- New users receive a permanent 6-digit User ID automatically at registration.
- The User ID is shown on the user dashboard and Profile page.
- Admin Users view also shows each user's User ID.

## Deployment

Replace the current project files with this ZIP, commit the changes in GitHub Desktop, and push to `main`. Vercel should then create a new deployment.

The existing `POSTGRES_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` environment variables remain required.

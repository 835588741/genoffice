# App Review Release Checklist

- [ ] Deploy the updated Lightyu API service and run the email-login and delete-account smoke requests.
- [ ] Create or confirm an App Store Connect review mailbox and put its credentials in Review Notes.
- [ ] Submit `JD13200`, `JD23000`, and `JD55000` with the same build.
- [ ] Build a new MAS archive with a unique build number.
- [ ] Confirm the packaged app contains the signed native authentication helper.
- [ ] Confirm the account page works with email code, Apple, and Lightyu authorization.
- [ ] Record the account deletion flow using `account-deletion-demo-script.md`.
- [ ] Upload the recording and paste `2026-09-resubmission-notes.md` into App Store Connect Review Notes.
- [ ] Submit the new version for review only after the build, IAP items, and review material are all attached.

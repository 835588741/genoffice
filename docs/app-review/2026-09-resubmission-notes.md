# AiOffice macOS App Review Resubmission Notes

## Review build

- App: AiOffice for macOS
- Bundle ID: `com.luanqing.aioffice`
- Build: fill in the uploaded build number
- Review contact: fill in the support contact used in App Store Connect

## Sign-in instructions

AiOffice now provides an in-app account page. From the home screen, click the account button in the lower-left corner.

Supported sign-in methods:

1. Email verification code: enter an email address, click **Send verification code**, then enter the code and click **Email sign in / Sign up**. The email form is rendered inside AiOffice and does not open the default browser.
2. Sign in with Apple: click **Sign in with Apple**. Authentication is presented by macOS `ASWebAuthenticationSession`, then the result returns to AiOffice.
3. Lightyu API authorization: click **Lightyu API authorization**. This is the existing Lightyu API authorization flow, presented in the macOS system authentication session, and returns to AiOffice after authorization.

For review, use the App Store Connect test account listed in the **Review Notes** account field. The email verification code can be delivered to that test mailbox. No paid subscription is required to sign in.

## Account deletion

While signed in, open the lower-left account button, select **Account**, click **Delete account**, enter `删除账号`, and click **Permanently delete**.

The action is completed in the app. It revokes all desktop sessions, removes login identifiers and the desktop AI credential binding, clears pending desktop AI tasks, and anonymizes the account record. Required payment and transaction audit records are retained without login credentials. Local documents remain on the Mac and are not uploaded or deleted by account deletion.

## In-app purchases

The following consumable products are included in this review submission and are submitted for review together with the build:

- `JD13200`
- `JD23000`
- `JD55000`

Open the account page while signed in and choose **Apple in-app purchase**. The products are loaded from StoreKit and the purchase is completed with the App Store sandbox account. The purchase grants the corresponding Lightyu API gold beans after server-side receipt verification. **Restore unfinished transactions** is available on the same page.

## Previous review findings addressed

- Guideline 4.0: email sign-in and registration are now completed inside AiOffice; external authorization is limited to the system authentication session for Apple/Lightyu authorization.
- Guideline 2.1(b): all three in-app purchase products are attached to this version submission.
- Guideline 5.1.1(v): account deletion is available from the signed-in account settings and is completed without contacting support.

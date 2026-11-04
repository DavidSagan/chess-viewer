# Publishing to the Microsoft Store

The Store build is an MSIX package, not an installer exe. The Store signs MSIX packages for free
and handles updates, while an exe would need a paid code-signing certificate and separate hosting.

Each version tag builds `store-package.msix`. Once setup is finished, the tag also submits it to the
Store. Microsoft allows automated submissions only for apps that are already live, so the first
submission is done by hand.

## 1. Reserve the app

1. [Register as a Windows app developer](https://storedeveloper.microsoft.com/). Individual accounts
   are free, but you need a government ID for identity verification.
2. In [Partner Center](https://partner.microsoft.com/dashboard), create a new MSIX app and reserve
   the name "Chess PDF Viewer".
3. Open the app's **Product identity** page and copy these values into `appx` in
   `viewer/package.json`, matching them exactly:

   | Partner Center | `package.json` |
   | --- | --- |
   | Package/Identity/Name | `identityName` |
   | Package/Identity/Publisher | `publisher` |
   | Package/Properties/PublisherDisplayName | `publisherDisplayName` |

## 2. Make the first submission

1. Commit and push those values, then start a release. The Store does not accept versions that start
   with 0, so use 1.0.0 or higher:

   ```bash
   tools/release.sh 1.0.0
   ```

2. From that run's page under
   [Actions](https://github.com/DavidSagan/chess-viewer/actions/workflows/build.yml), download the
   `store-package` artifact and unzip it to get `store-package.msix`.
3. Create a submission in Partner Center and upload the package. You also need to fill in:
   - **Pricing:** set the app to free.
   - **Age rating:** answer the questionnaire.
   - **Store listing:** add a description and at least one screenshot (`docs/app-screenshot.png`).
   - **Restricted capability:** explain why `runFullTrust` is needed: "This is an Electron desktop
     app, which runs as a full-trust process and opens PDF files the user chooses."
   - **Privacy policy:** people can sign in to Lichess inside the app, so a policy URL may be
     required.
4. Submit it and wait for it to pass certification and go live.

## 3. Turn on automatic submissions

1. Link a Microsoft Entra tenant to your Partner Center account, register an application in Entra,
   and add it in Partner Center under **Account settings > User management > Microsoft Entra
   applications** with the Manager role. Microsoft's
   [guide](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/github-actions)
   covers these steps and where to find each ID.
2. Add the credentials as repository secrets. Each command prompts for the value:

   ```bash
   gh secret set AZURE_AD_TENANT_ID
   ```

   ```bash
   gh secret set AZURE_AD_APPLICATION_CLIENT_ID
   ```

   ```bash
   gh secret set AZURE_AD_APPLICATION_SECRET
   ```

   ```bash
   gh secret set SELLER_ID
   ```

3. Set the product ID, which starts with `9` and is on the app's **Product identity** page. This
   variable is what turns on the `store` job:

   ```bash
   gh variable set STORE_PRODUCT_ID --body <product id>
   ```

From then on, `tools/release.sh <version>` also submits the new version. Each version must be higher
than the last one. Certification continues after the job ends, and you can follow it in Partner
Center. Entra client secrets expire, so renew `AZURE_AD_APPLICATION_SECRET` when yours does.

# Privacy Policy – Chapote CM (cm.chapote.fr)

*This is a translation; the French version prevails.*

Last updated: November 24, 2026.

Chapote CM ([cm.chapote.fr](https://cm.chapote.fr)) is Chapote's social media management tool: scheduling and publishing your videos on TikTok, YouTube and Instagram, tracking their statistics and comments, and archiving your content in your own Google Drive. It shares the account and infrastructure of [chapote.fr](https://chapote.fr). This policy describes the data processed by Chapote CM, in accordance with the **GDPR** (Regulation (EU) 2016/679) and the French Data Protection Act (loi Informatique et Libertés).

## 1. Data controller

- **Nathan Provost**, an individual, publisher of the service under the Chapote brand (not yet a company).
- Contact: [nathan.provost78990@gmail.com](mailto:nathan.provost78990@gmail.com).

## 2. Data collected

- **Account**: name, email address, password (stored hashed), space and team, members' roles.
- **Connected social media accounts** (TikTok, YouTube, Instagram): identifier, name, username, picture; **OAuth tokens** issued by each platform.
- **Google Drive connection** (required to publish): email address of the connected Google account, OAuth refresh **token**, identifiers of the folders and files created by Chapote CM.
- **Published content**: videos, covers, titles, captions, hashtags, publishing settings, scheduled dates, links and identifiers of posts returned by the platforms, history.
- **Statistics and comments** on the posts of the connected accounts, where the platform allows it.
- **Technical data**: connection and error logs (without any token or password).

## 3. Purposes and legal basis

This data is used **solely** to provide the service requested by the user: signing in, linking their accounts, scheduling and publishing their content, displaying its tracking (status, statistics, comments) and archiving their content in their Drive.

Legal basis: **performance of the contract** (Article 6(1)(b) GDPR) entered into with the user, and the authorization the user gives each platform (TikTok, Google, Meta) themselves when connecting. Technical logs are based on **legitimate interest** (security of the service, Article 6(1)(f)).

## 4. Google Drive

The Google Drive connection is **required to publish**: videos are stored in the Drive of the owner of the accounts, not with us. It uses only the `https://www.googleapis.com/auth/drive.file` scope.

- **Limited access**: Chapote CM accesses **only the files and folders it has created itself or that you have opened with it**. It does not see the rest of your Drive.
- **Use**: **archiving your own content in your own Drive**. Chapote CM creates the "cm.chapote.fr" folder at the root of your Drive and stores in it, for each post, the video, the caption, the cover and an `infos.json` file (title, date, status and links of the post). These files may be read again by Chapote CM to retry a post that failed.
- **Library (optional)**: if you yourself share a Google Drive folder with Chapote's address, Chapote accesses that folder, and only that folder, with the permission you give it (read or edit), in order to offer you its videos to publish. Remove this sharing in Google Drive to stop.
- **No resale, no sharing with third parties**, no use for advertising or profiling, and **no use to train artificial intelligence models**.
- No person accesses this data, except with your express consent, for security purposes (investigating abuse) or to comply with the law.

cm.chapote.fr's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## 5. Recipients

Data is transmitted only to the platforms required for what the user requests: **TikTok**, **Google / YouTube** and **Meta / Instagram** for posts, and **Google Drive** for archiving. No data is sold or rented.

## 6. Hosting and data protection

- **Hosting**: **OVH SAS** (2 rue Kellermann, 59100 Roubaix, France), servers located **in France**.

These measures protect all your data, including data obtained through Google APIs (Google Drive OAuth token, email address of the connected Google account, identifiers of the Drive folders and files created by Chapote CM):

- **Encryption in transit**: the website and the mobile app communicate with our servers only over HTTPS (TLS); the browser is required to always use HTTPS (HSTS) and the session cookie is sent only over HTTPS. Our servers call the Google, TikTok and Meta APIs only over HTTPS.
- **Encryption at rest**: OAuth tokens (Google Drive, TikTok, YouTube, Instagram) are encrypted in the database (authenticated symmetric encryption). The encryption key is kept outside the database and outside the code. Tokens are never displayed, never transmitted to the browser or the mobile app, and never written to logs.
- **Passwords**: stored only in hashed and salted form (bcrypt), never in plain text.
- **Access control**: every request is checked by the server. A user can access only their own accounts and the account groups shared with them, according to the role given (Admin, Can post, Read-only).
- **Isolation**: uploaded videos and covers are stored in a private folder on the server, never published on the Internet. They are read only by authorized users, or by the platform publishing the video, through a signed link valid for 2 hours. The database is not exposed to the Internet: only the application accesses it.
- **Logs**: tokens, passwords and the content of your files are never written to logs. The access logs of the application and its web servers do not record any URL parameters (OAuth authorization codes, signed links). The only exception: if the application is temporarily unreachable (for example during an update), the web server's error log may record the full URL of a request. These logs are kept for no more than 14 days, and an OAuth authorization code can be used only once and expires quickly.
- **Minimization**: Chapote CM requests only the permissions required for the service. For Google Drive, only `https://www.googleapis.com/auth/drive.file`. Data is kept only for the periods set out in section 7.
- **Incident**: in the event of a personal data breach, the publisher notifies the CNIL within 72 hours and informs the persons concerned where required by law (Articles 33 and 34 GDPR).

Data obtained through Google APIs is **never sold**, nor used for advertising or profiling, nor to **train artificial intelligence or machine learning models**. It is used in accordance with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## 7. Retention periods

- **OAuth tokens** (social media and Google Drive): as long as the account or the Drive is connected; deleted **immediately** upon disconnection from Chapote CM, and as soon as access revoked from the platform is detected.
- **Videos and covers** on our servers: until all their posts are complete (48 more hours in case of failure, to allow a retry), and no more than 7 days while awaiting archiving in your Drive. Files archived in your Drive belong to you and remain there: you manage them yourself.
- **Post history**: 12 months.
- **Collected comments**: no more than 12 months; deleted as soon as the account concerned is disconnected.
- **Account**: until it is deleted; all associated data is then deleted.

## 8. Revoking access and deleting your data

- **Google Drive**: in Chapote CM, Library → "Storage" → **"Remove"**: the token is deleted, and the authorization is revoked with Google as soon as no other storage in your space uses that Google account. You can also remove access from your Google account: [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Files already archived remain in your Drive.
- **Social media**: Accounts page → "Disconnect", or from the platform's settings.
- **Deletion of all your data**: write to [nathan.provost78990@gmail.com](mailto:nathan.provost78990@gmail.com). Deletion is carried out **within 7 days**.

### Instagram

The connection to Instagram goes through the Meta app **"Chapote Publisher"**. To remove access and delete the data linked to an Instagram account:

- **From Chapote CM**: Accounts page → Instagram account → **"Disconnect"**. The access token is deleted immediately and upcoming posts on that account are cancelled.
- **From Instagram**: Settings → **Apps and websites** → "Chapote Publisher" → **Remove**. Meta notifies Chapote CM, which immediately deletes the access token and disconnects the account.
- **Data deletion request**: from Instagram or Facebook, you can request the deletion of the data shared with "Chapote Publisher". Meta then gives you a **confirmation code** and a link to track the status of the request. The account's token, name and picture are deleted immediately; the videos, comments and statistics collected are deleted automatically within the hour.

In all cases, the videos, comments and statistics of a disconnected account are deleted from our servers automatically. Posts already live on Instagram stay on your account: you manage them from Instagram.

## 9. Your rights

You have the right of **access**, **rectification**, **erasure**, **restriction**, **portability** and **objection** regarding your data. To exercise them: [nathan.provost78990@gmail.com](mailto:nathan.provost78990@gmail.com). You may also lodge a complaint with the **CNIL** ([www.cnil.fr](https://www.cnil.fr)).

See also the [Terms of Use](/terms).

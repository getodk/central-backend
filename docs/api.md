FORMAT: 1A

# ODK Central API
[ODK Central Backend](https://github.com/getodk/central-backend) is a RESTful API server that provides key functionality for creating and managing ODK data collection campaigns. It couples with [Central Frontend](https://github.com/getodk/central-frontend), an independent frontend interface, to form [ODK Central](https://github.com/getodk/central), a complete user-installable ODK server solution. While Central Frontend is the primary consumer of the ODK Central API, the API this server provides is fully public and generic: anything that can be done in the user interface can be done directly via the API.

You can read on for a brief overview of the main concepts and how they fit together, or jump to one of the sections for a more in-depth description.

## API Overview

To use the API to manage your data collection campaigns, you will need to **authenticate** with it, so it knows who you are and what you are allowed to do. We provide multiple methods to authenticate with the API, as well as different models for managing the identities and permissions in your system. Human staff users that manage data collection campaigns are `User`s, and mobile devices are granted access via `App User`s, and each of these account types have their own way of authenticating. But, these concepts both boil down to `Actor`s, which are how the API actually thinks about authentication and permissioning.

In future versions of this server, the primary way an API consumer would authenticate with this server will be as a simple Actor through a standard OAuth 2.0 mechanism. That Actor can be granted a constrained set of rights to safely perform only all the actions it needs to. In these early releases, however, password-based authentication as a User is the only way to gain full access to the system.

The `/users` resource can be used to create, manage, and delete **Users**. These are the staff members who have administrative rights on your server, some projects, or both. Additional tasks like resetting a user's password are also available. You could use this API to, for example, synchronize accounts with another system or mass-provision Users.

Actors (and thus Users) may be granted rights via Assignments. In short, a Roles API is available which describes the defined Roles within the system, each of which allows some set of verbs. The Assignments APIs, in turn, assign Roles to certain Actors upon certain system objects. More information on these may be found below, under [Accounts and Users](/reference/accounts-and-users).

The rest of system is made up mostly of standard REST resources and subresources, nested under and partitioned by the `/projects` Projects resource. Forms, submissions to those forms, attachments on forms or submissions, and App Users ("App Users" in the management interface), are all subresources within `/projects`. This way, each project is essentially its own sandbox which can be managed and manipulated at will.

The `/projects/:id/app-users` subresource can be used to create, manage, and delete **App Users**.

The `/projects/:id/forms` resource and its subresource `/projects/:id/forms/…/submissions` provide full access to create, manage, and delete **`Form`s and `Submission`s to those Forms**. Each Form is a single ODK XForms survey, and many Submissions (filled-out forms, also sometimes called `Instance`s) may be attached to each Form. These resources are somewhat unique in that they are created by sending XML in the ODK XForms format instead of JSON. One can also retrieve all the multimedia attachments associated with any submission through the `/projects/:id/forms/…/submissions/…/attachments` subresource.

Forms and their submissions are also accessible through two **open standards specifications** that we follow:

* The [OpenRosa](https://docs.getodk.org/openrosa/) standard allows standard integration with tools like the [ODK Collect](https://docs.getodk.org/collect-intro/) mobile data collection app, or various other compatible tools like [Enketo](https://enketo.org/). It allows them to see the forms available on the server, and to send new submissions to them.
* The [OData](http://odata.org/) standard allows data to be shared between platforms for analysis and reporting. Tools like [Microsoft Power BI](https://powerbi.microsoft.com/en-us/) and [Tableau](https://public.tableau.com/en-us/s/) are examples of clients that consume the standard OData format and provide advanced features beyond what we offer. If you are looking for a straightforward JSON output of your data, or you are considering building a visualization or reporting tool, this is your best option.

Finally, **system information and configuration** is available via a set of specialized resources. Currently, you may set the Usage Reporting configuration and retrieve Server Audit Logs.

## Changelog

Here major and breaking changes to the API are listed by version.

### ODK Central v2022.3

**Added**:

* Introducing [Datasets](#reference/datasets) as the first step of Entity-Based Data Collection! Future versions of Central will build on these new concepts. We consider this functionality experimental and subject to change in the next release.
  * Forms can now create Datasets in the project, see [Creating a New Form](#reference/forms/forms/creating-a-new-form) and the [ODK XForms specification](https://getodk.github.io/xforms-spec) for details.
  * New endpoint [GET /projects/:id/datasets](#reference/datasets/datasets/datasets) for listing Datasets of a project.
  * New endpoint [GET /projects/:id/datasets/:name/entities.csv](#reference/datasets/download-dataset/download-dataset) to download the Dataset as a CSV file.
  * New endpoints for [Related Datasets](#reference/forms/related-datasets/) to see the Datasets affected by published and unpublished Forms.
  * New endpoint [PATCH .../attachments/:name](#reference/forms/draft-form/linking-a-dataset-to-a-draft-form-attachment) to link/unlink a Dataset to a Form Attachment.
* OData Data Document requests now allow limited use of `$select`.

**Changed**:

* The following endpoints have changed with the addition of Datasets:
  * The [Extended Project](#reference/project-management/projects/listing-projects) endpoint now returns the `datasets` count for the Project.
  * The [Extended Form](#reference/forms/forms/list-all-forms) endpoint now returns the `entityRelated` flag if the form defines a Dataset schema.
  * [DELETE .../draft/attachments/:name](#reference/forms/draft-form/clearing-a-draft-form-attachment) will unlink the Dataset if there's a Dataset link to the attachment.
  * [GET .../draft/attachments/:filename](#reference/forms/individual-form/downloading-a-form-attachment) will return the Dataset as a CSV file if the attachment is linked to a Dataset.
  * [GET .../draft/attachments](#reference/forms/draft-form/listing-expected-draft-form-attachments) returns two additional flags `blobExists` and `datasetExists`.
  * In the [OpenRosa Form Manifest](#reference/openrosa-endpoints/openrosa-form-manifest-api/openrosa-form-manifest-api), if a Form Attachment is linked to a Dataset then the value of `hash` is the MD5 of the last updated timestamp or the MD5 of `1970-01-01 00:00:00` if the Dataset is empty.

### ODK Central v1.5.3

**Removed**:

* It is no longer possible to initiate a new backups configuration (`POST /v1/config/backups/initiate`) or to verify one (`POST /v1/config/backups/verify`). However, for now, if there is an existing configuration, it is still possible to get it or terminate it. If the existing configuration is terminated, it will not be possible to set up a new configuration. Note that it is still possible to download a [Direct Backup](/reference/system-endpoints/direct-backup). For more information about this change, please see [this topic](https://forum.getodk.org/t/backups-to-google-drive-from-central-will-stop-working-after-jan-31st/38895) in the ODK Forum.

### ODK Central v1.5

ODK Central v1.5 adds editable Project descriptions as well as more detailed information about Forms and Submissions when listing Projects.

**Added**:

* New `description` field returned for each [Project](/reference/project-management/projects) that can be set or updated through `POST`/`PATCH`/`PUT` on `/projects/…`
    * Note that for the `PUT` request, the Project's description must be included in the request. [Read more](/reference/project-management/projects/deep-updating-project-and-form-details).
* [Form extended metadata](/reference/forms/individual-form/getting-form-details) now includes a `reviewStates` object of counts of Submissions with specific review states.
    * e.g. `{"received":12, "hasIssues":2, "edited":3}`
* New `?forms=true` option on [Project Listing](/reference/project-management/projects/listing-projects-with-nested-forms) that includes a `formList` field containing a list of extended Forms (and the review state counts described above) associated with that Project.

### ODK Central v1.4

ODK Central v1.4 enables additional CSV export options and creates an API-manageable 30 day permanent purge system for deleted Forms. Previously, deleted Forms were made inaccessible but the data was not purged from the database.

**Added**:

* New `?groupPaths` and `?splitSelectMultiples` options on [CSV export paths](/reference/submissions/submissions/exporting-form-submissions-to-csv) which aim to replicate ODK Briefcase export behavior. One simplifies nested path names and the other breaks select multiple options out into multiple columns.
* New `?deletedFields` option on [CSV export](/reference/submissions/submissions/exporting-form-submissions-to-csv) which exports all previously known and deleted fields and data on the form.
* Deleted Forms (either by API `DELETE` or through the web interface) are now placed in a 30 day hold, after which an automated process will permanently delete all data related to the Form.
  * You can see Forms in the 30 day wait by [listing Forms with `?deleted=true`](/reference/forms/forms/list-all-forms). You can also see them in the Trash section on the web interface.
  * `POST /projects/…/forms/…/restore` to restore a Form that hasn't yet been permanently purged.
* Additional metadata field 'formVersion' on [CSV export](/reference/submissions/submissions/exporting-form-submissions-to-csv), [OData feed](/reference/odata-endpoints/odata-form-service/data-document), and [extended Submission Version request](/reference/submissions/submission-versions/listing-versions) which reports the version of the Form the Submission was _originally_ created with.
* Additional metadata fields `userAgent` and `deviceId` tracked and returned for each [Submission Version](/reference/submissions/submission-versions/listing-versions).
  * These are collected automatically upon submission through transmitted client metadata information, similar to the existing `deviceId` field returned with each Submission.

### ODK Central v1.3

ODK Central v1.3 adds granular Submission edit history, as well as opt-in usage reporting to the Central team.

**Added**:

* `GET /projects/…/forms/…/submissions/…/diffs` will return the [changes between each version](/reference/submissions/submission-versions/getting-changes-between-versions) of a Submission.
* You can set the [Usage Reporting configuration](/reference/system-endpoints/usage-reporting-configuration) to choose whether the server will share anonymous usage data with the Central team. By default, no usage information will be sent at all.
* You can also [preview the Usage Report](/reference/system-endpoints/usage-report-preview) to see exactly what information would be sent in a Usage Report.

**Changed**:

* Additional actions are now logged in the [Server Audit Log](/reference/system-endpoints/server-audit-logs):
  * A `user.session.create` action will be logged when a User [logs in using Session Authentication](/reference/authentication/session-authentication/logging-in).
  * A `form.submissions.export` action will be logged when a User exports Form Submissions to CSV.
* The Submission update timestamp is now included in OData (as `__system/updatedAt`). Resources that accept the `$filter` query parameter can be filered on `__system/updatedAt`.
* All groups are now included in OData, even if they are not relevant. For more information, see [this post](https://forum.getodk.org/t/include-non-relevant-groups-and-fields-in-odk-central-api-responses/33536) in the ODK Forum.
* The `Content-Disposition` header now specifies the `filename*` parameter, allowing filenames to contain Unicode.

### ODK Central v1.2

ODK Central v1.2 adds submission editing, review states, and commenting.

**Added**:

* `POST /projects/…/submission` now accepts ecosystem-compatible submission updates over OpenRosa, using the `deprecatedID`.
* REST-friendly submission updates by `PUT`ing XML directly to the submission resource path.
* `GET /projects/…/forms/…/submissions/…/edit` will now redirect the authenticated user (after some thought) to an Enketo-powered webform for editing the submission.
* There is now a subresource `/projects/…/forms/…/submissions/…/versions` to get all versions of a submission, and details about each one, including submitted media files.
* There is now a subresource `/projects/…/forms/…/submissions/…/comments` which allows very simple comment creation (`POST`) and listing (`GET`) on a submission.
* Submissions now have a `reviewState` property which can be updated via `PATCH /projects/…/forms/…/submissions`.

* You can now provide `X-Action-Notes` on any API request that might generate audit logs, to leave a note on those log entries.
* `GET /projects/…/forms/…/submissions/…/audits` will return just audit logs pertaining to that submission.
* OData queries may now request `?expand=*` to request all nested data structures inline. Only `*` is accepted.
* OData `$filter` queries may now reference the new `__system/reviewState` metadata field.
* There is now a [data download path](/reference/odata-endpoints/odata-form-service/data-download-path) you can direct users to which eases media file access.
* Submissions now have an `instanceName` field which reflects the `<instanceName/>` tag on the submitted XML.
* The REST submission endpoint now accepts optional `?deviceID=` just like the OpenRosa submission endpoint.

**Changed**:

* Unpublished Forms (Forms that only have a Draft and have never been published) will now appear with full details in `GET /projects/…/forms`. Previously, values like `name` would be `null` for these Forms. You can still identify unpublished Forms as they will have a `publishedAt` value of `null`.
* Date and Boolean OData types are now given as date and boolean rather than text.
* Broke Forms and Submissions section apart into two below. This may break some links.

### ODK Central v1.1

ODK Central v1.1 adds minor new features to the API.

**Added**:

* `POST`/`GET /backup`, will immediately perform a backup of the database and return the encrypted backup.
* `POST`/`GET /projects/…/forms/…/submissions.csv`, which allows download of the root table (excluding repeat data) as CSV, without a zipfile.
* `POST`/`GET /projects/…/forms/…/submissions.csv.zip` now allows `?attachments=false` to exclude attachments.
* OData Data Document requests now allow limited use of `$filter`.
* The various `submissions.csv.*` endpoints also allow `$filter`, using the same limited OData syntax.
* `GET /projects/…/forms/…/submissions/submitters` which returns submitter Actors for a given Form.

**Fixed**:
* Documented the `deviceId` property of submission, which was added in version 0.4.

### ODK Central v1.0

ODK Central v1.0 adds Public Links to the API, and makes one minor breaking change.

**Added**:

* The new [Public Link](/reference/forms/public-access-links) resource lets you create Public Access Links, granting anonymous browser-based access to submit to your Forms using Enketo.

**Changed**:

* The non-extended App User response no longer includes a `createdBy` numeric ID. To retrieve the creator of an App User, request the extended response.
* We no longer reject the request if multiple authentication schemes are presented, and instead document the priority order of the different schemes [here](/reference/authentication).

### ODK Central v0.9

ODK Central v0.9 does not change the API except for one minor breaking change.

**Changed**:

* The [OpenRosa Form Listing API](/reference/openrosa-endpoints/openrosa-form-listing-api) has been modified to always require authentication. If a valid Actor is authenticated at all, a form list will always be returned, filtered by what that Actor is allowed to access.

### ODK Central v0.8

ODK Central v0.8 introduces Draft Forms, publishing, and archived Form versions, which has a significant breaking impact on the existing API. The changes should be straightforward to adapt to, however. If you are currently creating Forms with `POST /projects/…/forms`, you may wish to add `?publish=true` to skip the Draft state and mimic the old behaviour. If you are using the API to push Form Attachments onto Forms, you'll only be able to do so now in draft state, at `/projects/…/forms/…/draft/attachments`.

**Added**:

* Draft Forms and publishing, and archived Form versions.
  * This includes [a subresource](/reference/forms/draft-form) at `/projects/…/forms/…/draft`,
  * and [another](/reference/forms/published-form-versions) at `/projects/…/forms/…/versions`,
  * and a [new collection of OpenRosa endpoints](/reference/openrosa-endpoints/draft-testing-endpoints), under `/test/…/projects/…/forms/…/draft`, for submitting test submissions to the draft version of the form.
* `GET /projects/…/forms/…/fields`, which replaces `GET /projects/…/forms/….schema.json`.
* App User responses now include the `projectId` they are bound to.

**Changed**:

* As part of the Draft Forms change, the read/write endpoints for Form Attachments have been moved to the Draft Form state and subresource, at `/projects/…/forms/…/draft/attachments`.

**Removed**:

* `GET /projects/…/forms/….schema.json` has been removed in favor of `GET /projects/…/forms/…/fields`.

**Fixed**:

* Documented `GET /projects/…/forms/….xls(x)`, which was added in 0.7.

### ODK Central v0.7

**Added**:

* Form-specific [Assignments resource](/reference/forms/form-assignments) at `projects/…/forms/…/assignments`, allowing granular role assignments on a per-Form basis.
  * Relatedly, the [OpenRosa Form Listing API](/reference/openrosa-endpoints/openrosa-form-listing-api) no longer rejects requests outright based on authentication. Rather, it will only return Forms that the authenticated user is allowed to view.
  * A [new summary API](/reference/project-management/project-assignments/seeing-all-form-assignments-within-a-project) `GET /projects/…/assignments/forms` which returns all assignments on all Forms within a Project, so you don't have to request this information separately for each Form.
* `PUT /projects/:id`, which while complex allows you to update many Forms' states and assignments with a single transactional request.
* `POST /projects/…/forms` now allows upload of `.xls` and `.xlsx` XLSForm files. The correct MIME type must be given.
* `GET /users/?q` will now always return user details given an exact match for an email, even for users who cannot `user.list`. The request must still be authenticate as a valid Actor. This allows non-Administrators to choose a user for an action (eg grant rights) without allowing full search.

**Changed**:

* Newly created App Users are no longer automatically granted download and submission access to all Forms within their Project. You will want to use the [Form Assignments resource](/reference/forms/form-assignments) to explicitly grant `app-user` role access to the Forms they should be allowed to see.

**Fixed**:

* Correctly documented `keyId` property on Projects.

### ODK Central v0.6

**Added**:

* `GET /audits` Server Audit Log retrieval resource.
* Project Managed Encryption:
  * `POST /projects/…/key` to enable project managed encryption.
  * Both submission intake methods (OpenRosa and REST) now support encrypted submissions.
  * `GET /projects/…/forms/…/submissions/keys` to get a list of encryption keys needed to decrypt all submitted data.
  * `?{keyId}={passphrase}` option on `GET /projects/…/forms/…/submissions.csv.zip` to get a decrypted archive given the `passphrase`.
  * `POST /projects/…/forms/…/submissions.csv.zip` to provide a browser-secure (no querystring) method of accessing the above `GET .csv.zip` resource.
  * OData and `.csv.zip` data responses now contain an additional `status` system column.
* Form resource data now includes `projectId` and 'keyId'.
* `?odata=true` option on `GET /projects/…/forms/….schema.json` to sanitize the field names to match the way they will be outputted for OData.

**Changed**:

* `GET /projects/…/forms/…/attachments` now always returns `updatedAt`. There is no longer a separate Extended Metadata response for this resource.
* The Submission response format now provides the submitter ID at `submitterId` rather than `submitter`. This is so that the Extended responses for Submissions can use `submitter` to provide the full Actor subobject rather than replacing it. This brings the response format to be more similar to the other Extended formats.
* OData resources now namespace the `__system` schema information under `org.opendatakit.submission` rather than alongside user metadata (`org.opendatakit.user.*`). The actual returned data has not changed; this is purely a metadata document change.

**Removed**:

* The Extended responses for Forms and Submissions no longer include an `xml` property. To retrieve Form or Submission XML, use the dedicated endpoints for [Form XML](/reference/forms/individual-form/retrieving-form-xml) and [Submission XML](/reference/submissions/submissions/retrieving-submission-xml).

### ODK Central v0.5

**Added**:

* Roles and Assignments resources at `/roles`, `/assignments`, and `/projects/…/assignments`.
* Optional `?q=` querystring parameter on Users `GET` listing, for searching users.
* Extended `GET /users/current`: added `verbs` list of verbs the authenticated Actor may perform server-wide.
* Extended Project `GET`: added `appUsers` count of App Users and `verbs` list of verbs the authenticated Actor may perform upon/within the Project.
* User `DELETE`.
* Projects now have an `archived` flag which may be set to clear a Project out of the way without deleting it.

**Changed**:

* **Removed** autopromotion of Users to Administrator upon creation (`POST`). Roles must be assigned separately and explicitly.
* **Changed** Project Listing (`GET /projects`) to never reject based on authentication; instead it filters the response based on the access of the authenticated Actor.
* **Changed** `xmlFormId`/`version` conflict errors on `POST`ing a new Form from a `400` code to a `409` code.
* **Changed** all remaining textual references to "Field Keys" to "App Users" in the documentation.

**Fixed**:

* Corrected Actor documentation to match reality: **removed** `meta` field and added `type` field.
* Corrected Extended Form documentation: **added** `createdBy` field.
* Corrected Backup Config documentation. It was almost entirely wrong.
* Added Submission POST REST documentation.

### ODK Central v0.4

**Added**:

* Projects resource at `/projects`.
* Submission XML resource fetch at `GET /projects/…/forms/…/submissions/….xml`.
* Submission attachment management over REST, at the `/attachments` subresource within Submissions.

**Changed**:

* **Renamed** all `/field-keys` routes to `/app-users`.
* **Moved** all Forms, Submissions, and App User resources under Projects (e.g. `/forms/simple` would now be something like `/projects/1/forms/simple`).
* **Changed** `GET` Form to not return Form XML. The Extended Metadata version of those requests will give the XML.
* **Changed** both OpenRosa and REST Submission creation processes to create and accept only the attachment filenames that are indicated to exist by the Submission XML.
* **Changed** `GET` Submission Attachemnts listing to return an array of objects containing attachment details rather than an array of filename strings.

# Group Authentication

In ODK Central, the server thinks about identity and permissioning in terms of one core concept: the `Actor`. No matter how you authenticate with the API, you are doing so as an Actor of some kind or another, and when permissions are assigned and checked, they are done against the authenticated Actor.

In practice, there are two types of Actors available in the system today:

* `User`s are accounts used by the staff members who manage the server and the data collection campaigns. They each have a set of rights assigned to them via Roles and Assignments. They are the only account types that have passwords associated with them. They also always have an email address. Users can authenticate using **Session Bearer Tokens** or using **HTTPS Basic** authentication.
* `App User`s are only allowed to access the OpenRosa parts of the API: in essence, they are allowed to list forms, download form definitions, and create new submissions against those forms. They can only authenticate using **App User URL**s.

In a future version of the API, programmatic consumers will be more directly supported as their own Actor type, which can be granted limited permissions and can authenticate over **OAuth 2.0**.

Next, you will find documentation on each of the three authentication methods described above. It is best not to present multiple credentials. If you do, the first _presented_ scheme out of `/key` token, Bearer, Basic, then Cookie will be used for the request. If the multiple schemes are sent at once, and the first matching scheme fails, the request will be immediately rejected.

## Session Authentication [/v1/sessions]

This is the authentication method used by the ODK Central Frontend packaged with Central Backend. Only `User`s can authenticate this way. It consists mostly of two steps:

1. **Logging in**: presenting an Email Address and a Password for verification, after which a new `Session` is created. Associated with the Session is an expiration and a bearer token. Sessions expire 24 hours after they are created.
2. **Using the session**: each request to the API needs a header attached to it: `Authorization: Bearer {token}`. This authenticates that particular request as belonging to the Session we created by logging in.

You might notice that Step 2 greatly resembles how OAuth 2.0 works. This was an intentional first step towards OAuth support, and should make the forward migration of your code easier down the road.

### Logging in [POST]

In order to log a `User` in to a new `Session`, you must provide their credentials, in JSON format.

For security reasons, the only possible results are success or failure. No detail is provided upon failure.

Successful responses will come with an HTTP-Only, Secure-Only cookie. This cookie is primarily meant for use by the Central frontend, and we do not recommend relying upon it. It will only work on `GET` requests, and it will only work over HTTPS.

+ Attributes (object)
    + email (string, required) - The `User`'s full email address.
    + password (string, required) - The `User`'s password.


+ Request (application/json)
    + Body

            {
                "email": "my.email.address@getodk.org",
                "password": "my.super.secure.password"
            }

+ Response 200 (application/json)
    + Attributes (Session)

+ Response 401 (application/json)
    + Attributes (Error 401)

### Using the session [GET /v1/example]

Once you have logged in, to use your session token to authenticate with any action, supply it in a request header `Authorization` with a value of `Bearer {token}`, as seen here.

_(There is not really anything at `/v1/example`; this section only demonstrates how generally to use Session Bearer Token Authentication.)_

+ Request
    + Headers

            Authorization: Bearer lSpAIeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QPEjR7

+ Response 200 (application/json)
    + Attributes (Success)

#### Logging out [DELETE /v1/sessions/{token}]

Logging out is not strictly necessary for Web Users; all sessions expire 24 hours after they are created. But it can be a good idea, in case someone else manages to steal your token. It is also the way Public Link and App User access are revoked. To do so, issue a `DELETE` request to that token resource.

+ Parameters
    + token: `lSpAIeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QPEjR7` (string, required) - The session bearer token, obtained at login time.

+ Request
    + Headers

            Authorization: Bearer lSpAIeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QPEjR7

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## HTTPS Basic Authentication [/v1/example]

Standard HTTP Basic Authentication is allowed, but **_strongly discouraged_**. This is because the server must verify your password with every single request, which is very slow to compute: typically, this will add hundreds of milliseconds to each request. For some one-off tasks and in cases where there is no other choice, it is reasonable to choose Basic authentication, but wherever possible we strongly encourage the use of any other authentication method.

In addition, because credentials are sent in plaintext as part of the request, **the server will only accept Basic auth over HTTPS**. If your ODK Central server is set up over plain HTTP, it will not accept Basic auth.

### Using Basic Authentication [GET]

To use HTTPS Basic Authentication, attach an `Authorization` header formatted so:

    `Authorization: Basic bXkuZW1haWwuYWRkcmVzc0BvcGVuZGF0YWtpdC5vcmc6bXkucGFzc3dvcmQ=`

As given by [the standard](https://en.wikipedia.org/wiki/Basic_access_authentication), the text following the `Basic` marker here is a base64 encoding of the credentials, provided in the form `email:password` (in this example `my.email.address@getodk.org:my.password`).

Unlike the standard, we do not require the client to first send an unauthenticated request and retry the request only after receiving a `WWW-Authenticate` response, and in fact we will never send the `WWW-Authenticate` header. This is mostly because, as noted above, we generally discourage the use of this authentication method, and would rather not advertise its use openly. As a result, if you wish to use Basic Authentication, directly supply the header on any request that needs it.

_(There is not really anything at `/v1/example`; this section only demonstrates how generally to use Basic Authentication.)_

+ Request
    + Headers

            Authorization: Basic bXkuZW1haWwuYWRkcmVzc0BvcGVuZGF0YWtpdC5vcmc6bXkucGFzc3dvcmQ=

+ Response 200 (application/json)
    + Attributes (Success)

## App User Authentication [/v1/key/{appUser}/example]

App Users are only allowed to list and download forms, and upload new submissions to those forms. Primarily, this is to allow clients like ODK Collect to use the OpenRosa API (`/formList` and `/submission`), but any action in this API reference falling into those categories will be allowed.

+ Parameters
    + `appUser`: `!Ms7V3$Zdnd63j5HFacIPFEvFAuwNqTUZW$AsVOmaQFf$vIC!F8dJjdgiDnJXXOt` (string, required) - The App User token. As with Session Bearer tokens, these tokens only contain URL-safe characters, so no escaping is required.

### Using App User Authentication [GET]

To use App User Authentication, first obtain a App User, typically by using the configuration panel in the user interface, or else by using the [App User API Resource](/reference/accounts-and-users/app-users). Once you have the token, you can apply it to any eligible action by prefixing the URL with `/key/{appUser}` as follows:

    `/v1/key/!Ms7V3$Zdnd63j5HFacIPFEvFAuwNqTUZW$AsVOmaQFf$vIC!F8dJjdgiDnJXXOt/example/request/path`

_(There is not really anything at `/v1/example`; this section only demonstrates how generally to use App User Authentication.)_

+ Response 200 (application/json)
    + Attributes (Success)

### Revoking an App User [DELETE /v1/sessions/{token}]

The token associated with a App User is actually just its Session Token. As a result, although a App User Token can uniquely be used as a URL prefix as described here, the session associated with it can be revoked in exactly the same way a session is logged out, by issuing a `DELETE` request to its Session resource.

Note, however, that a App User cannot revoke itself; a `User` must perform this action.

+ Parameters
    + token: `lSpAIeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QPEjR7` (string, required) - The session bearer token, obtained at login time.

+ Request
    + Headers

            Authorization: Bearer lSpAIeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QPEjR7

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group Accounts and Users

Today, there are two types of accounts: `Users`, which are the administrative accounts held by staff members managing the data collection process, and `App Users`, which are restricted access keys granted per Form within a Project to data collection clients in the field. Although both of these entities are backed by `Actor`s as we explain in the [Authentication section](/reference/authentication) above, there is not yet any way to directly create or manipulate an Actor. Today, you can only create, manage, and delete Users and App Users.

Actors (and thus Users) may be granted rights via Roles. The `/roles` Roles API is open for all to access, which describes all defined roles on the server. Getting information for an individual role from that same API will reveal which verbs are associated with each role: some role might allow only `submission.create` and `submission.update`, for example.

Right now, there are four predefined system roles: Administrator (`admin`), Project Manager (`manager`), Data Collector (`formfill`), and App User (`app-user`). Administrators are allowed to perform any action upon the server, while Project Managers are allowed to perform any action upon the projects they are assigned to manage.

Data Collectors can see all Forms in a Project and submit to them, but cannot see Submissions and cannot edit Form settings. Similarly, App Users are granted minimal rights: they can read Form data and create new Submissions on those Forms. While Data Collectors can perform these actions directly on the Central administration website by logging in, App Users can only do these things through Collect or a similar data collection client device.

The Roles API alone does not, however, tell you which Actors have been assigned with Roles upon which system objects. For that, you will need to consult the various Assignments resources. There are two, one under the API root (`/v1/assignments`), which manages assignments to the entire system, and another nested under each Project (`/v1/projects/…/assignments`) which manage assignments to that Project.

## Users [/v1/users]

Presently, it is possible to create and list `User`s in the system, as well as to perform password reset operations. In future versions of this API it will be possible to manage existing user information and delete accounts as well.

### Listing all Users [GET /v1/users{?q}]

Currently, there are no paging or filtering options, so listing `User`s will get you every User in the system, every time.

Optionally, a `q` querystring parameter may be provided to filter the returned users by any given string. The search is performed via a [trigram similarity index](https://www.postgresql.org/docs/9.6/pgtrgm.html) over both the Email and Display Name fields, and results are ordered by match score, best matches first. Note that short search terms (less than 4 or 5 characters) may not return any results. Try a longer search if nothing is appearing.

If a `q` parameter is given, and it exactly matches an email address that exists in the system, that user's details will always be returned, even for actors who cannot `user.list`. The request must still authenticate as a valid Actor. This allows non-Administrators to choose a user for an action (eg grant rights) without allowing full search.

Actors who cannot `user.list` will always receive `[]` with a `200 OK` response.

+ Parameters
    + q: `alice` (string, optional) - An optional search parameter.

+ Response 200 (application/json)
    + Attributes (array[User])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Creating a new User [POST]

All that is required to create a new user is an email address. That email address will receive a message instructing the new user on how to claim their new account and set a password.

Optionally, a password may also be supplied as a part of this request. If it is, the account is immediately usable with the given credentials. However, an email will still be dispatched with claim instructions as above.

Users are not able to do anything upon creation besides log in and change their own profile information. To allow Users to perform useful actions, you will need to [assign them one or more Roles](/reference/accounts-and-users/assignments).

+ Request (application/json)
    + Attributes
        + email: `my.email.address@getodk.org` (string, required) - The email address of the User account to be created.
        + password: `my.super.secure.password` (string, optional) - If provided, the User account will be created with this password. Otherwise, the user will still be able set their own password later.

    + Body

            { "email": "my.email.address@getodk.org" }

+ Response 200 (application/json)
    + Attributes (User)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting User details [GET /v1/users/{actorId}]

Typically, you supply the integer ID to get information about the user associated with that id.

It is also possible to supply the text `current` instead of an integer ID; please see the following endpoint for documentation about this.

+ Parameters
    + actorId: `42` (string, required) - Typically the integer ID of the `User`. For getting user details, you can also supply the text `current`, which will tell you about the currently authenticated user.

+ Response 200 (application/json)
    + Attributes (User)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting authenticated User details [GET /v1/users/current]

Typically, you would get User details by the User's numeric Actor ID.

However, if you only have a Bearer token, for example, you don't have any information about the user attached to that session, including even the ID with which to get more information. So you can instead supply the text `current` to get the user information associated with the authenticated session.

If you _do_ use `current`, you may request extended metadata. Supply an `X-Extended-Metadata` header value of `true` to additionally retrieve an array of strings of the `verbs` the authenticated User/Actor is allowed to perform server-wide.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (User)

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (User)
        + verbs: `project.create`, `project.update` (array[string], required) - The verbs the authenticated Actor is allowed to perform server-wide.

+ Response 403 (application/json)
    + Attributes (Error 403)

### Modifying a User [PATCH /v1/users/{actorId}]

You can `PATCH` JSON data to update User details. Not all user information is modifiable; right now, the following fields may be updated:

* `displayName` sets the friendly display name the web interface uses to refer to the user.
* `email` sets the email address associated with the account.

When user details are updated, the `updatedAt` field will be automatically updated.

+ Parameters
    + actorId: `42` (string, required) - The integer ID of the `User`.

+ Request (application/json)
    + Attributes
        + displayName: `New Name` (string, optional) - The friendly display name that should be associated with this User.
        + email: `new.email.address@getodk.org` (string, optional) - The email address that should be associated with this User.

    + Body

            {
              "displayName": "New Name",
              "email": "new.email.address@getodk.org"
            }

+ Response 200 (application/json)
    + Attributes (User)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Directly updating a user password [PUT /v1/users/{actorId}/password]

To directly update a user password, you will need to reprove the user's intention by supplying the `old` password alongside the `new`. If you simply want to initiate an email-based password reset process, see the following endpoint.

+ Parameters
    + actorId: `42` (string, required) - The integer ID of the `User`.

+ Request (application/json)
    + Attributes
        + old: `old.password` (string, required) - The user's current password.
        + new: `new.password` (string, required) - The new password that the user wishes to set.

    + Body

            {
              "old": "old.password",
              "new": "new.password"
            }

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Initating a password reset [POST /v1/users/reset/initiate{?invalidate}]

Anybody can initate a reset of any user's password. An email will be sent with instructions on how to complete the password reset; it contains a token that is required to complete the process.

The optional query parameter `invalidate` may be set to `true` to immediately invalidate the user's current password, regardless of whether they complete the reset process. This can be done if, for example, their password has been compromised. In order to do this, though, the request must be performed as an authenticated user with permission to do this. If invalidation is attempted without the proper permissions, the entire request will fail.

If the email address provided does not match any user in the system, that address will still be sent an email informing them of the attempt and that no account was found.

+ Parameters
    + invalidate: `true` (boolean, optional) - Specify `true` in order to immediately invalidate the user's present password.

+ Request (application/json)
    + Attributes
        + email: `my.email.address@getodk.org` (string, required) - The email address of the User account whose password is to be reset.

    + Body

            { "email": "my.email.address@getodk.org" }

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Deleting a User [DELETE /v1/users/{actorId}]

Upon User deletion:

* The account will be removed,
* the user will be logged out of all existing sessions,
* and should the user attempt to reset their password, they will receive an email informing them that their account has been removed.

The User record will remain on file within the database, so that when for example information about the creator of a Form or Submission is requested, basic details are still available on file. A new User account may be created with the same email address as any deleted accounts.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## App Users [/v1/projects/{projectId}/app-users]

App Users may only be created, fetched, and manipulated within the nested Projects subresource, as App Users themselves are limited to the Project in which they are created. Through the `App User`s API, you can create, list, and delete the App Users of any given Project. Because they have extremely limited permissions, App Users cannot manage themselves; only `User`s may access this API.

For more information about the `/projects` containing resource, please see the following section.

+ Parameters
    + projectId: `7` (number, required) - The numeric ID of the Project

### Listing all App Users [GET]

Currently, there are no paging or filtering options, so listing `App User`s will get you every App User in the system, every time.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally retrieve the `lastUsed` timestamp of each App User, as well as to retrieve the details of the `Actor` the App User was `createdBy`.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[App User])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended App User])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Creating a new App User [POST]

The only information required to create a new `App User` is its `displayName` (this is called "Nickname" in the administrative panel).

When an App User is created, they are assigned no rights. They will be able to authenticate and list forms on a mobile client, but the form list will be empty, as the list only includes Forms that the App User has read access to. Once an App User is created, you'll likely wish to use the [Form Assignments resource](/reference/forms/form-assignments) to actually assign the `app-user` role to them for the Forms you wish.

+ Request (application/json)
    + Attributes
        + displayName: `My Display Name` (string, required) - The friendly nickname of the `App User` to be created.

    + Body

            { "displayName": "My Display Name" }

+ Response 200 (application/json)
    + Attributes (App User)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Deleting a App User [DELETE /v1/projects/{projectId}/app-users/{id}]

You don't have to delete a `App User` in order to cut off its access. Using a `User`'s credentials you can simply [log the App User's session out](/reference/authentication/app-user-authentication/revoking-an-app-user) using its token. This will end its session without actually deleting the App User, which allows you to still see it in the configuration panel and inspect its history. This is what the administrative panel does when you choose to "Revoke" the App User.

That said, if you do wish to delete the App User altogether, you can do so by issuing a `DELETE` request to its resource path. App Users cannot delete themselves.

+ Parameters
    + id: `16` (number, required) - The numeric ID of the App User

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Roles [/v1/roles]

_(introduced: version 0.5)_

The Roles API lists and describes each known Role within the system. Right now, Roles may not be created or customized via the API, but this will likely change in the future.

Each Role contains information about the verbs it allows its assignees to perform. Some Roles have a system name associated with them; the Roles may always be referenced by this system name in request URLs, and system Roles are always read-only.

### Listing all Roles [GET]

Currently, there are no paging or filtering options, so listing `Role`s will get you every Role in the system, every time. There are no authorization restrictions upon this endpoint: anybody is allowed to list all Role information at any time.

+ Response 200 (application/json)
    + Attributes (array[Role])

### Getting Role Details [GET /v1/roles/{id}]

Getting an individual Role does not reveal any additional information over listing all Roles. It is, however, useful for direct lookup of a specific role:

The `id` parameter for Roles here and elsewhere will accept the numeric ID associated with that Role, _or_ a `system` name if there is one associated with the Role. Thus, you may request `/v1/roles/admin` on any ODK Central server and receive information about the Administrator role.

As with Role listing, there are no authorization restrictions upon this endpoint: anybody is allowed to get information about any Role at any time.

+ Parameters
    + id: `1` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.

+ Response 200 (application/json)
    + Attributes (Role)

## Assignments [/v1/assignments]

_(introduced: version 0.5)_

There are multiple Assignments resources. This one, upon the API root (`/v1/assignments`), manages Role assignment to the entire system (e.g. if you are assigned a Role that gives you `form.create`, you may create a form anywhere on the entire server).

The [Project Assignments resource](/reference/project-management/project-assignments), nested under Projects, manages Role assignment to that Project in particular, and all objects within it. And the [Form Assignments resource](/reference/forms/form-assignments) allows even more granular assignments, to specific Forms within a Project. All of these resources have the same structure and take and return the same data types.

Assignments may be created (`POST`) and deleted (`DELETE`) like any other resource in the system. Here, creating an Assignment grants the referenced Actor the verbs associated with the referenced Role upon all system objects. The pathing for creation and deletion is not quite REST-standard: we represent the relationship between Role and Actor directly in the URL rather than as body data: `assignments/{role}/{actor}` represents the assignment of the given Role to the given Actor.

### Listing all Assignments [GET]

This will list every server-wide assignment, in the form of `actorId`/`roleId` pairs. It will _not_ list Project-specific Assignments. To find those, you will need the [Assignments subresource](/reference/project-management/project-assignments) within Projects.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to expand the `actorId` into a full `actor` objects. The Role reference remains a numeric ID.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Assignment])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Assignment])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Listing all Actors assigned some Role [GET /v1/assignments/{roleId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, this endpoint lists all `Actors` that have been assigned that Role on a server-wide basis.

+ Parameters
    + roleId: `admin` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.

+ Response 200 (application/json)
    + Attributes (array[Actor])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Assigning an Actor to a server-wide Role [POST /v1/assignments/{roleId}/{actorId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, and a numeric `actorId`, assigns that Role to that Actor across the entire server.

No `POST` body data is required, and if provided it will be ignored.

+ Parameters
    + roleId: `admin` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.
    + actorId: `14` (number, required) - The integer ID of the `Actor`.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Stripping an Role Assignment from an Actor [DELETE /v1/assignments/{roleId}/{actorId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, and a numeric `actorId`, unassigns that Role from that Actor across the entire server.

+ Parameters
    + roleId: `admin` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.
    + actorId: `14` (number, required) - The integer ID of the `Actor`.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group Project Management

Apart from staff users ("Web Users" in the Central management interface) and some site-wide configuration details like Usage Reporting, all of ODK Central's objects (Forms, Submissions, App Users) are partitioned by Project, and available only as subresources below the main Projects resource.

## Projects [/v1/projects]

_(introduced: version 0.4)_

You must create a containing Project before you can create any of its subobjects.

### Listing Projects [GET]

The Projects listing endpoint is somewhat unique in that it is freely accessible to anybody, even unauthenticated clients. Rather than reject the user with a `403` or similar error, the Projects listing will only return Projects that the authenticated Actor is allowed to see. In most cases, this means that unauthenticated requests will receive `[]` in reply.

Currently, there are no paging or filtering options, so listing `Project`s will get you every Project you have access to.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally retrieve the `appUsers` count of App Users and `forms` count of Forms within the Project, as well as the `lastSubmission` timestamp of the latest submission to any for in the project, if any.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Project])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Project])

### Listing Projects with nested Forms [GET /v1/projects?forms=true]

_(introduced: Version 1.5)_

This endpoint works similarly to the Project listing endpoint above, except it also returns the Forms that the authenticated Actor is allowed to see, with those Forms nested within their corresponding Project under a new parameter `formList`. The returned Forms will match structure of Forms requested with extended metadata (including additional `lastSubmission` timestamp and `submissions` and `reviewStates` counts).

+ Response 200 (application/json)
    This is the standard response:

    + Attributes (array[Project With Forms])

### Creating a Project [POST /v1/projects]

To create a Project, the only information you must supply (via POST body) is the desired name of the Project.

+ Request (application/json)
    + Attributes
        + name: `Project Name` (string, required) - The desired name of the Project.

    + Body

            { "name": "Project Name" }

+ Response 200 (application/json)
    + Attributes (Project)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting Project Details [GET /v1/projects/{id}]

To get just the details of a single Project, `GET` its single resource route by its numeric ID.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally retrieve the `appUsers` count of App Users and `forms` count of forms within the Project, as well as the `lastSubmission` timestamp of the latest submission to any for in the project, if any.

In addition, the extended metadata version of this endpoint (but not the overall Project listing) returns an array of the `verbs` the authenticated Actor is able to perform on/within the Project.

+ Parameters
    + id: `16` (number, required) - The numeric ID of the Project

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (Project)

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (Extended Project)
        + verbs: `form.create`, `form.delete` (array[string], required) - The array of string verbs the authenticated Actor may perform on and within this Project.

+ Response 403 (application/json)
    + Attributes (Error 403)

### Updating Project Details [PATCH /v1/projects/{id}]

The Project name may be updated, as well as the Project description and the `archived` flag.

By default, `archived` is not set, which is equivalent to `false`. If `archived` is set to `true`, the Project will be sorted to the bottom of the list, and in the web management application the Project will become effectively read-only. API write access will not be affected.

+ Parameters
    + id: `16` (number, required) - The numeric ID of the Project

+ Request (application/json)
    + Attributes
        + name: `New Project Name` (string, required) - The desired name of the Project.
        + description: `Description of this Project to show on Central.` (string, optional) - The description of the Project.
        + archived: `true` (boolean, optional) - Archives the Project.

    + Body

            { "name": "New Project Name", "description": "Description of this Project to show on Central.", "archived": true }

+ Response 200 (application/json)
    + Attributes (Project)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Deep Updating Project and Form Details [PUT /v1/projects/{id}]

_(introduced: version 0.7)_

When managing a large deployment, it can be necessary to make sweeping changes to all Form States and Assignments within it at once&mdash;when rolling out a new Form, for example, or replacing a deprecated version with a new revision.

For this purpose, we offer this `PUT` resource, which allows a deep update of Project metadata, Form metadata, and Form Assignment metadata at once and transactionally using a nested data format.

One important mechanic to note immediately here is that we follow true `PUT` semantics, meaning that the data you provide is not merged with existing data to form an update. With our usual `PATCH` endpoints, we do this kind of merging and so data that you don't explicitly pass us is left alone. Because we allow the deletion of Form Assignments by way of omission with this API, we treat _all_ omissions as an explicit specification to null the omitted field. This means that, for example, you must always re-specify the Project name, the Project description, and archival flag with every `PUT`.

This adherence to `PUT` semantics would normally imply that Forms could be created or deleted by way of this request, but such an operation could become incredibly complex. We currently return a `501 Not Implemented` error if you supply nested Form information but you do not give us exactly the entire set of extant Forms.

You can inspect the Request format for this endpoint to see the exact nested data structure this endpoint accepts. Each level of increased granularity is optional: you may `PUT` just Project metadata, with no `forms` array, and you may `PUT` Project and Form metadata but omit `assignments` from any Form, in which case the omitted detail will be left as-is.

+ Parameters
    + id: `16` (number, required) - The numeric ID of the Project

+ Request (application/json)
    + Attributes
        + name: `New Project Name` (string, required) - The desired name of the Project.
        + description: `New Project Description` (string, optional) - The desired description of the Project.
        + archived: `true` (boolean, optional) - Archives the Project.
        + forms: (array, optional) - If given, the Form metadata to update.
            + (object)
                + xmlFormId: `simple` (string, required) - The `id` of this form as given in its XForms XML definition.
                + state: (Form State, required) - The present lifecycle status of this form.
                + assignments: (array, optional) - If given, the Assignments to apply to this Form. And if given, any existing Assignments that are not specified here will be revoked.
                    + (object)
                        + roleId: `2` (number, required) - The role `id` to assign
                        + actorId: `14` (number, required) - The `id` of the Actor being assigned the given role on this Form

    + Body

            {
              "name": "New Project Name",
              "description": "New Project Description",
              "archived": false,
              "forms": [{
                "xmlFormId": "simple",
                "state": "open",
                "assignments": [{
                  "roleId": 2,
                  "actorId": 14
                }, {
                  "roleId": 2,
                  "actorId": 21
                }]
              }, {
                "xmlFormId": "test",
                "state": "closed"
              }]
            }

+ Response 200 (application/json)
    + Attributes (Project)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 501 (application/json)
    + Attributes (Error 501)

## Enabling Project Managed Encryption [POST /v1/projects/{id}/key]

_(introduced: version 0.6)_

[Project Managed Encryption](/reference/encryption) can be enabled via the API. To do this, `POST` with the `passphrase` and optionally a reminder `hint` about the passphrase. If managed encryption is already enabled, a `409` error response will be returned.

Enabling managed encryption will modify all unencrypted forms in the project, and as a result the `version` of all forms within the project will also be modified. It is therefore best to enable managed encryption before devices are in the field. Any forms in the project that already have self-supplied encryption keys will be left alone.

+ Parameters
    + id: `16` (number, required) - The numeric ID of the Project

+ Request (application/json)
    + Attributes
        + passphrase: `super duper secret` (string, required) - The encryption passphrase. If this passphrase is lost, the data will be irrecoverable.
        + hint: `it was a secret` (string, optional) - A reminder about the passphrase. This is primarily useful when multiple encryption keys and passphrases are being used, to tell them apart.

    + Body

            { "passphrase": "super duper secret", "hint": "it was a secret" }

+ Response 200 (application/json)
    + Attributes (Project)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 409 (application/json)
    + Attributes (Error 409)

### Deleting a Project [DELETE /v1/projects/{id}]

Deleting a Project will remove it from the management interface and make it permanently inaccessible. Do not do this unless you are certain you will never need any of its data again. For now, deleting a Project will not purge its Forms. (We will change that in a future release.)

+ Parameters
    + id: `16` (number, required) - The numeric ID of the Project

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Project Assignments [/v1/projects/{projectId}/assignments]

_(introduced: version 0.5)_

There are multiple Assignments resources. This one, specific to the Project it is nested within, only governs Role assignments to that Project. Assigning an Actor a Role that grants, for example, a verb `submission.create`, allows that Actor to create a submission anywhere within this Project. It is also possible to assign rights only to specific forms for actions related only to that form and its submissions: see the [Form Assignments resource](/reference/forms/form-assignments) for information about this.

The [sitewide Assignments resource](/reference/accounts-and-users/assignments), at the API root, manages Role assignments for all objects across the server. Apart from this difference in scope, the introduction to that section contains information useful for understanding the following endpoints.

There are only one set of Roles, applicable to either scenario. There are not a separate set of Roles used only upon Projects or Forms.

+ Parameters
    + projectId: `2` (number, required) - The numeric ID of the Project

### Listing all Project Assignments [GET]

This will list every assignment upon this Project, in the form of `actorId`/`roleId` pairs.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to expand the `actorId` into a full `actor` objects. The Role reference remains a numeric ID.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Assignment])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Assignment])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Listing all Actors assigned some Project Role [GET /v1/projects/{projectId}/assignments/{roleId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, this endpoint lists all `Actors` that have been assigned that Role upon this particular Project.

+ Parameters
    + roleId: `manager` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.

+ Response 200 (application/json)
    + Attributes (array[Actor])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Assigning an Actor to a Project Role [POST /v1/projects/{projectId}/assignments/{roleId}/{actorId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, and a numeric `actorId`, assigns that Role to that Actor for this particular Project.

No `POST` body data is required, and if provided it will be ignored.

+ Parameters
    + roleId: `manager` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.
    + actorId: `14` (number, required) - The integer ID of the `Actor`.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Revoking a Project Role Assignment from an Actor [DELETE /v1/projects/{projectId}/assignments/{roleId}/{actorId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, and a numeric `actorId`, unassigns that Role from that Actor for this particular Project.

+ Parameters
    + roleId: `manager` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.
    + actorId: `14` (number, required) - The integer ID of the `Actor`.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Seeing all Form Assignments within a Project [GET /v1/projects/{projectId}/assignments/forms]

Returns a summary of all _Form-specific_ Assignments within this Project. This endpoint is meant to simplify the task of summarizing all Form permissions within a Project at a glance and in one transactional request. Because it is necessary to specify which Form each Assignment is attached to, returned results form this endpoint include an `xmlFormId` field.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to expand the `actorId` into a full `actor` objects. The Role reference remains a numeric ID and the Form reference remains a string ID.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Form Summary Assignment])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Form Summary Assignment])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Seeing Role-specific Form Assignments within a Project [GET /v1/projects/{projectId}/assignments/forms/:roleId]

Like the [Form Assignments summary API](/reference/forms/form-assignments/listing-all-form-assignments), but filtered by some `roleId`.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to expand the `actorId` into a full `actor` objects. The Role reference remains a numeric ID and the Form reference remains a string ID.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Form Summary Assignment])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Form Summary Assignment])

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group Forms

`Form`s are the heart of ODK. They are created out of XML documents in the [ODK XForms](https://getodk.github.io/xforms-spec/) specification format. The [Intro to Forms](https://docs.getodk.org/form-design-intro/) on the ODK Documentation website is a good resource if you are unsure what this means. Once created, Forms can be retrieved in a variety of ways, their state can be managed, and they can be deleted.

These subsections cover only the modern RESTful API resources involving Forms. For documentation on the OpenRosa `formList` endpoint (which can be used to list Forms), see that section below.

## Forms [/v1/projects/{projectId}/forms]

In this API, `Form`s are distinguished by their [`formId`](https://getodk.github.io/xforms-spec/#primary-instance)s, which are a part of the XForms XML that defines each Form. In fact, as you will see below, many of the properties of a Form are extracted automatically from the XML: `hash`, `name`, `version`, as well as the `formId` itself (which to reduce confusion internally is known as `xmlFormId` in ODK Central).

The only other property Forms currently have is `state`, which can be used to control whether Forms show up in mobile clients like ODK Collect for download, as well as whether they accept new `Submission`s or not.

It is not yet possible to modify a Form's XML definition once it is created.

+ Parameters
    + projectId: `16` (number, required) - The numeric ID of the Project

### List all Forms [GET]

Currently, there are no paging or filtering options, so listing `Form`s will get you every Form you are allowed to access, every time.

As of version 1.2, Forms that are unpublished (that only carry a draft and have never been published) will appear with full metadata detail. Previously, certain details like `name` were omitted. You can determine that a Form is unpublished by checking the `publishedAt` value: it will be `null` for unpublished forms.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally retrieve the `submissions` count of the number of Submissions that each Form has, the `reviewStates` object of counts of Submissions with specific review states, the `lastSubmission` most recent submission timestamp, as well as the Actor the Form was `createdBy`.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Form])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Form])

+ Response 403 (application/json)
    + Attributes (Error 403)

### List all deleted Forms [GET /v1/projects/{projectId}/forms?deleted=true]

_(introduced: Version 1.4)_

This endpoint returns a list of the current soft-deleted Forms that appear in the Trash section. In addition to the normal `Form` values, each Form will also include when it was deleted (`deletedAt`) and its numeric ID (`id`) that can be used to restore the Form.

Like the standard Form List endpoint, this endpoint also supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally retrieve the `submissions` count of the number of `Submission`s that each Form has and the `lastSubmission` most recent submission timestamp, as well as the Actor the Form was `createdBy`.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Deleted Form])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Deleted Form])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Creating a new Form [POST /v1/projects/{projectId}/forms{?ignoreWarnings}{?publish}]

When creating a `Form`, the only required data is the actual XForms XML or XLSForm itself. Use it as the `POST` body with a `Content-Type` header of `application/xml` (`text/xml` works too), and the Form will be created.

As of Version 0.8, Forms will by default be created in Draft state, accessible under `/projects/…/forms/…/draft`. The Form itself will not have a public XML definition, and will not appear for download onto mobile devices. You will need to [publish the form](/reference/forms/draft-form/publishing-a-draft-form) to finalize it for data collection. To disable this behaviour, and force the new Form to be immediately ready, you can pass the querystring option `?publish=true`.

For XLSForm upload, either `.xls` or `.xlsx` are accepted. You must provide the `Content-Type` request header corresponding to the file type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for `.xlsx` files, and `application/vnd.ms-excel` for `.xls` files. You must also provide an `X-XlsForm-FormId-Fallback` request header with the `formId` you want the resulting form to have, if the spreadsheet does not already specify. This header field accepts percent-encoded values to support Unicode characters and other non-ASCII values.

By default, any XLSForm conversion Warnings will fail this request and return the warnings rather than use the converted XML to create a form. To override this behaviour, provide a querystring flag `?ignoreWarnings=true`. Conversion Errors will always fail this request.

The API will currently check the XML's structure in order to extract the information we need about it, but ODK Central does _not_ run comprehensive validation on the full contents of the XML to ensure compliance with the ODK specification. Future versions will likely do this, but in the meantime you will have to use a tool like [ODK Validate](https://getodk.org/use/validate/) to be sure your Forms are correct.

### Creating Datasets with Forms

Starting from Version 2022.3, a Form can also create a Dataset by defining a Dataset schema in the Form definition (XForms XML or XLSForm). When a Form with a Dataset schema is uploaded, a Dataset and its Properties are created and a `dataset.create` event is logged in the Audit logs. The state of the Dataset is dependent on the state of the Form; you will need to publish the Form to publish the Dataset. Datasets in the Draft state are not returned in [Dataset APIs](#reference/datasets), however the [Related Datasets](#reference/forms/related-datasets/draft-form-dataset-diff) API for the Form can be called to get the Dataset and its Properties.

It is possible to define the schema of a Dataset in multiple Forms. Such Forms can be created and published in any order. The creation of the first Form will generate a `dataset.create` event in Audit logs and subsequent Form creation will generate `dataset.update` events. Publishing any of the Forms will also publish the Dataset and will generate a `dataset.update.publish` event. The state of a Property of a Dataset is also dependent on the state of the Form that FIRST defines that Property, which means if a Form is in the Draft state then the Properties defined by that Form will not appear in the [.csv file](#reference/datasets/download-dataset/download-dataset) of the Dataset.

+ Parameters
    + ignoreWarnings: `false` (boolean, optional) - Defaults to `false`. Set to `true` if you want the Form to be created even if the XLSForm conversion results in warnings.
    + publish: `false` (boolean, optional) - Defaults to `false`. Set to `true` if you want the Form to skip the Draft state to Published.

+ Request (application/xml)
    + Body

            <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
              <h:head>
                <h:title>Simple</h:title>
                <model>
                  <instance>
                    <data id="simple" version="2.1">
                      <meta>
                        <instanceID/>
                      </meta>
                      <name/>
                      <age/>
                    </data>
                  </instance>

                  <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
                  <bind nodeset="/data/name" type="string"/>
                  <bind nodeset="/data/age" type="int"/>
                </model>

              </h:head>
              <h:body>
                <input ref="/data/name">
                  <label>What is your name?</label>
                </input>
                <input ref="/data/age">
                  <label>What is your age?</label>
                </input>
              </h:body>
            </h:html>

+ Request (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
    + Headers

            X-XlsForm-FormId-Fallback: filename.xlsx

    + Body

            (.xlsx binary contents)

+ Response 200 (application/json)
    + Attributes (Form)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 409 (application/json)
    + Attributes (Error 409)

### Individual Form [/v1/projects/{projectId}/forms/{xmlFormId}]

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

#### Getting Form Details [GET]

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally retrieve the `submissions` count of the number of `Submission`s that this Form has, as well as the `lastSubmission` most recent submission timestamp.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (Form)

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (Extended Form)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Retrieving Form XML [GET /v1/projects/{projectId}/forms/{xmlFormId}.xml]

To get the XML of the `Form`, add `.xml` to the end of the request URL.

+ Response 200 (application/xml)
    + Body

            <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
              <h:head>
                <h:title>Simple</h:title>
                <model>
                  <instance>
                    <data id="simple" version="2.1">
                      <meta>
                        <instanceID/>
                      </meta>
                      <name/>
                      <age/>
                    </data>
                  </instance>

                  <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
                  <bind nodeset="/data/name" type="string"/>
                  <bind nodeset="/data/age" type="int"/>
                </model>

              </h:head>
              </h:body>
                <input ref="/data/name">
                  <label>What is your name?</label>
                </input>
                <input ref="/data/age">
                  <label>What is your age?</label>
                </input>
              </h:body>
            </h:html>

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Retrieving Form XLS(X) [GET /v1/projects/{projectId}/forms/{xmlFormId}.xlsx]

If a Form was created with an Excel file (`.xls` or `.xlsx`), you can get that file back by adding `.xls` or `.xlsx` as appropriate to the Form resource path.

+ Response 200 (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Listing Form Attachments [GET /v1/projects/{projectId}/forms/{xmlFormId}/attachments]

This endpoint allows you to fetch the list of expected attachment files, and will tell you whether the server is in possession of each file or not. To modify an attachment, you'll need to create a Draft.

+ Response 200 (application/json)
    + Attributes (array[Form Attachment])

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Downloading a Form Attachment [GET /v1/projects/{projectId}/forms/{xmlFormId}/attachments/{filename}]

To download a single file, use this endpoint. The appropriate `Content-Disposition` (attachment with a filename) and `Content-Type` (based on the type supplied at upload time) will be given.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Response 200
    + Headers

            Content-Type: {the MIME type of the attachment file itself}
            Content-Disposition: attachment; filename={the file's name}

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Getting Form Schema Fields [GET /v1/projects/{projectId}/forms/{xmlFormId}/fields{?odata}]

_(introduced: version 0.8)_

For applications that do not rely on JavaRosa, it can be challenging to parse XForms XML into a simple schema structure. Because Central Backend already implements and performs such an operation for its own internal purposes, we also expose this utility for any downstream consumers which wish to make use of it.

While this may eventually overlap with the new OData JSON CSDL specification, we are likely to maintain this API as it more closely mirrors the original XForms data types and structure.

Central internally processes the XForms schema tree into a flat list of fields, and this is how the data is returned over this endpoint as well. It will always return fields in a _depth-first traversal order_ of the original `<instance>` XML block in the XForm.

You may optionally add the querystring parameter `?odata=true` to sanitize the field names and paths to match the way they will be outputted for OData. While the original field names as given in the XForms definition may be used as-is for CSV output, OData has some restrictions related to the domain-qualified identifier syntax it uses.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + odata: `false` (boolean, optional) - If set to `true`, will sanitize field names.

+ Response 200 (application/json)
    + Body

            [
              { "name": "meta", "path": "/meta", "type": "structure" },
              { "name": "instanceID", "path": "/meta/instanceID", "type": "string" },
              { "name": "name", "path": "/name", "type": "string" },
              { "name": "age", "path": "/age", "type": "int" },
              { "name": "photo", "path": "/photo", "type": "binary", "binary": true }
            ]

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Modifying a Form [PATCH]

It is currently possible to modify only one thing about a `Form`: its `state`, which governs whether it is available for download onto survey clients and whether it accepts new `Submission`s. See the `state` Attribute in the Request documentation to the right to see the possible values and their meanings.

We use `PATCH` rather than `PUT` to represent the update operation, so that you only have to supply the properties you wish to change. Anything you do not supply will remain untouched.

+ Request (application/json)
    + Attributes
        + state (Form State, optional) - If supplied, the Form lifecycle state will move to this value.

+ Response 200 (application/json)
    + Attributes (Form)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Deleting a Form [DELETE]

When a Form is deleted, it goes into the Trash section, but it can now be restored from the Trash. After 30 days in the Trash, the Form and all of its resources and submissions will be automatically purged. If your goal is to prevent it from showing up on survey clients like ODK Collect, consider setting its `state` to `closing` or `closed` instead (see [Modifying a Form](/reference/forms/individual-form/modifying-a-form) just above for more details).

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Restoring a Form [POST /v1/projects/{projectId}/forms/{id}/restore]

_(introduced: version 1.4)_

Deleted forms can now be restored (as long as they have been in the Trash less than 30 days and have not been purged). However, a deleted Form with the same `xmlFormId` as an active Form cannot be restored while that other Form is active. This `/restore` URL uses the numeric ID of the Form (now returned by the `/forms` endpoint) rather than the `xmlFormId` to unambigously restore.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Draft Form [/v1/projects/{projectId}/forms/{xmlFormId}/draft]

_(introduced: version 0.8)_

Draft Forms allow you to test and fix issues with Forms before they are finalized and presented to data collectors. They make this process easier, as Draft Forms can be created and discarded without consequence: your Drafts will not count against the overall Form schema, nor against the set of unique `version` strings for the Form.

You can create or replace the current Draft Form at any time by `POST`ing to the `/draft` subresource on the Form, and you can publish the current Draft by `POST`ing to `/draft/publish`.

When a Draft Form is created, a Draft Token is also created for it, which can be found in Draft Form responses at `draftToken`. This token allows you to [submit test Submissions to the Draft Form](/reference/submissions/draft-submissions/creating-a-submission) through clients like Collect. If the Draft is published or deleted, the token will be deactivated. But if you replace the Draft without first deleting it, the existing Draft Token will be carried forward, so that you do not have to reconfigure your device.

+ Parameters
    + projectId: `1` (number, required) - The `id` of the Project this Form belongs to.
    + xmlFormId: `simple` (string, required) - The `id` of this Form as given in its XForms XML definition

#### Creating a Draft Form [POST /v1/projects/{projectId}/forms/{xmlFormId}/draft{?ignoreWarnings}]

`POST`ing here will create a new Draft Form on the given Form. For the most part, it takes the same parameters as the [Create Form request](/reference/forms/forms/creating-a-new-form): you can submit XML or Excel files, you can provide `ignoreWarnings` if you'd like.

Additionally, however, you may `POST` with no `Content-Type` and an empty body to create a Draft Form with a copy of the definition (XML, XLS, etc) that is already published, if there is one. This can be useful if you don't wish to update the Form definition itself, but rather one or more Form Attachments.

If your Draft form schema contains any field path which overlaps with a field path of a previous version of the Form, but with a different data type, your request will be rejected. You can rename the conflicting field, or correct it to have the same data type as it did previously.

When a Draft is created, the expected Form Attachments are computed and slots are created, as with a new Form. Any attachments that match existing ones on the published Form, if it exists, will be copied over to the new Draft.

Even if a Draft exists, you can always replace it by `POST`ing here again. In that case, the attachments that exist on the Draft will similarly be copied over to the new Draft. If you wish to copy from the published version instead, you can do so by first `DELETE`ing the extant Draft.

Draft `version` conflicts are allowed with prior versions of a Form while in Draft state. If you attempt to [publish the Form](/reference/forms/draft-form/publishing-a-draft-form) without correcting the conflict, the publish operation will fail. You can request that Central update the version string on your behalf as part of the publish operation to avoid this: see that endpoint for more information.

The `xmlFormId`, however, must exactly match that of the Form overall, or the request will be rejected.

Starting from Version 2022.3, a Draft Form can also create or update a Dataset by defining a Dataset schema in the Form definition. The state of the Dataset and its Properties is dependent on the state of the Form, see [Creating a new form](#reference/forms/forms/creating-a-new-form) for more details.

+ Parameters
    + ignoreWarnings: `false` (boolean, optional) - Defaults to `false`. Set to `true` if you want the form to be created even if the XLSForm conversion results in warnings.

+ Request (application/xml)
    + Body

            <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
              <h:head>
                <h:title>Simple</h:title>
                <model>
                  <instance>
                    <data id="simple" version="2.1">
                      <meta>
                        <instanceID/>
                      </meta>
                      <name/>
                      <age/>
                    </data>
                  </instance>

                  <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
                  <bind nodeset="/data/name" type="string"/>
                  <bind nodeset="/data/age" type="int"/>
                </model>

              </h:head>
              <h:body>
                <input ref="/data/name">
                  <label>What is your name?</label>
                </input>
                <input ref="/data/age">
                  <label>What is your age?</label>
                </input>
              </h:body>
            </h:html>

+ Request (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
    + Headers

            X-XlsForm-FormId-Fallback: filename.xlsx

    + Body

            (.xlsx binary contents)

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Getting Draft Form Details [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft]

The response here will include standard overall Form metadata, like `xmlFormId`, in addition to the Draft-specific information.

+ Response 200
    + Attributes(Draft Form)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Retrieving Draft Form XML [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft.xml]

To get the XML of the Draft Form, add `.xml` to the end of the request URL.

+ Response 200 (application/xml)
    + Body

            <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
              <h:head>
                <h:title>Simple</h:title>
                <model>
                  <instance>
                    <data id="simple" version="2.1">
                      <meta>
                        <instanceID/>
                      </meta>
                      <name/>
                      <age/>
                    </data>
                  </instance>

                  <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
                  <bind nodeset="/data/name" type="string"/>
                  <bind nodeset="/data/age" type="int"/>
                </model>

              </h:head>
              <h:body>
                <input ref="/data/name">
                  <label>What is your name?</label>
                </input>
                <input ref="/data/age">
                  <label>What is your age?</label>
                </input>
              </h:body>
            </h:html>

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Retrieving Draft Form XLS(X) [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft.xlsx]

If a Draft Form was created with an Excel file (`.xls` or `.xlsx`), you can get that file back by adding `.xls` or `.xlsx` as appropriate to the Draft Form resource path.

+ Response 200 (application/xml)
    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Listing expected Draft Form Attachments [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments]

Form Attachments for each form are automatically determined when the form is first created, by scanning the XForms definition for references to media or data files. Because of this, it is not possible to directly modify the list of form attachments; that list is fully determined by the given XForm. Instead, the focus of this API subresource is around communicating that expected list of files, and uploading binaries into those file slots.

+ Response 200 (application/json)
    + Attributes (array[Form Attachment])

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Uploading a Draft Form Attachment [POST /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments/{filename}]

To upload a binary to an expected file slot, `POST` the binary to its endpoint. Supply a `Content-Type` MIME-type header if you have one.

As of version 2022.3, if there is already a Dataset linked to this attachment, it will be unlinked and replaced with the uploaded file.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + filename: `people.csv` (string, required) - The name of that attachment.
    
+ Request (*/*)
    + Body

            (binary data)

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Downloading a Draft Form Attachment [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments/{filename}]

To download a single file, use this endpoint. The appropriate `Content-Disposition` (attachment with a filename or Dataset name) and `Content-Type` (based on the type supplied at upload time or `text/csv` in the case of a linked Dataset) will be given.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + filename: `people.csv` (string, required) - The name of tha attachment.

+ Response 200
    + Headers

            
            Content-Type: {the MIME type of the attachment file itself or text/csv for a Dataset}
            Content-Disposition: attachment; filename={the file's name or [Dataset name].csv}

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Clearing a Draft Form Attachment [DELETE /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments/{filename}]

Because Form Attachments are completely determined by the XForms definition of the form itself, there is no direct way to entirely remove a Form Attachment entry from the list, only to clear its uploaded content or to unlink the Dataset. Thus, when you issue a `DELETE` to the attachment's endpoint, that is what happens.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + filename: `people.csv` (string, required) - The name of tha attachment.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Linking a Dataset to a Draft Form Attachment [PATCH /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments/{filename}]

_(introduced: version 2022.3)_

This endpoint can update a Form Attachment's link to a Dataset. You can use this to link or unlink a Dataset to a Form Attachment. Linking of a Dataset to the Attachment only happens if the Attachment type is `file` and there is a Dataset with the exact name of the Attachment (excluding extension `.csv`) in the Project. For example, if the Form definition includes an Attachment named `people.csv`, then it can be linked to a Dataset named `people`. Pay special attention to letter case and spaces.

When linking a Dataset, if there is any existing file attached then it will be removed.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + filename: `people.csv` (string, required) - The name of the attachment.

+ Request
    + Attributes (Patch Attachment)
    

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 404 (application/json)
    + Attributes (Error 404)

#### Getting Draft Form Schema Fields [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/fields{?odata}]

Identical to the [same request](/reference/forms/individual-form/getting-form-schema-fields) for the published Form, but will return the fields related to the current Draft version.

+ Parameters
    + odata: `false` (boolean, optional) - If set to `true`, will sanitize field names.

+ Response 200 (application/json)
    + Body

            [
              { "name": "meta", "path": "/meta", "type": "structure" },
              { "name": "instanceID", "path": "/meta/instanceID", "type": "string" },
              { "name": "name", "path": "/name", "type": "string" },
              { "name": "age", "path": "/age", "type": "int" },
              { "name": "photo", "path": "/photo", "type": "binary", "binary": true }
            ]

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Publishing a Draft Form [POST /v1/projects/{projectId}/forms/{xmlFormId}/draft/publish{?version}]

This will publish your current Draft Form and make it the active Form definition (and attachments).

If your Draft `version` conflicts with an older version of the Form, you will get an error.

If you wish for the `version` to be set on your behalf as part of the publish operation, you can provide the new version string as a querystring parameter `?version`.

Once the Draft is published, there will no longer be a Draft version of the form.

Starting with Version 2022.3, publishing a Draft Form that defines a Dataset schema will also publish the Dataset. It will generate `dataset.update.publish` event in Audit logs and make the Dataset available in [Datasets APIs](#reference/datasets)

+ Parameters
    + version: `newVersion` (string, optional) - The `version` to be associated with the Draft once it's published.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 409 (application/json)
    + Attributes (Error 409)

#### Deleting a Draft Form [DELETE /v1/projects/{projectId}/forms/{xmlFormId}/draft]

Once a Draft Form is deleted, its definition and any Form Attachments associated with it will be removed.

You will not be able to delete the draft if there is no published version of the form.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Published Form Versions [/v1/projects/{projectId}/forms/{xmlFormId}/versions]

All published versions of a Form are available read-only at the `/versions` subresource for reference, including the currently published version. You may read that version and its details, retrieve the Form definition, and any attachments associated with each version.

#### Listing Published Form Versions [GET]

Each entry of the version listing will contain some of the same duplicate keys with basic information about the Form: `xmlFormId` and `createdAt`, for example. This is done to match the data you'd receive if you'd requested each version separately.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally retrieve the `Actor` that each version was `publishedBy`.

+ Response 200
    + Attributes (array[Form])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Form Version])

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Getting Form Version Details [GET /v1/projects/{projectId}/forms/{xmlFormId}/versions/{version}]

Since the XForms specification allows blank strings as `version`s (and Central treats the lack of a `version` as a blank string), you may run into trouble using this resource if you have such a Form. In this case, pass the special value `___` (three underscores) as the `version` to retrieve the blank `version` version.

+ Parameters
    + version: `one` (string, required) - The `version` of the Form version being referenced. Pass `___` to indicate a blank `version`.

+ Response 200
    + Attributes(Form)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Retrieving Form Version XML [GET /v1/projects/{projectId}/forms/{xmlFormId}/versions/{version}.xml]

To get the XML of the Form Version, add `.xml` to the end of the request URL.

+ Parameters
    + version: `one` (string, required) - The `version` of the Form version being referenced. Pass `___` to indicate a blank `version`.

+ Response 200 (application/xml)
    + Body

            <h:html xmlns="http://www.w3.org/2002/xforms" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:jr="http://openrosa.org/javarosa">
              <h:head>
                <h:title>Simple</h:title>
                <model>
                  <instance>
                    <data id="simple" version="2.1">
                      <meta>
                        <instanceID/>
                      </meta>
                      <name/>
                      <age/>
                    </data>
                  </instance>

                  <bind nodeset="/data/meta/instanceID" type="string" readonly="true()" calculate="concat('uuid:', uuid())"/>
                  <bind nodeset="/data/name" type="string"/>
                  <bind nodeset="/data/age" type="int"/>
                </model>

              </h:head>

                <input ref="/data/name">
                  <label>What is your name?</label>
                </input>
                <input ref="/data/age">
                  <label>What is your age?</label>
                </input>
              </h:body>
            </h:html>

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Retrieving Form Version XLS(X) [GET /v1/projects/{projectId}/forms/{xmlFormId}/versions/{version}.xlsx]

If a Form Version was created with an Excel file (`.xls` or `.xlsx`), you can get that file back by adding `.xls` or `.xlsx` as appropriate to the Form Version resource path.

+ Parameters
    + version: `one` (string, required) - The `version` of the Form version being referenced. Pass `___` to indicate a blank `version`.

+ Response 200 (application/xml)
    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Listing Form Version Attachments [GET /v1/projects/{projectId}/forms/{xmlFormId}/versions/{version}/attachments]

Attachments are specific to each version of a Form. You can retrieve the attachments associated with a given version here.

+ Parameters
    + version: `one` (string, required) - The `version` of the Form version being referenced. Pass `___` to indicate a blank `version`.

+ Response 200 (application/json)
    + Attributes (array[Form Attachment])

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Downloading a Form Version Attachment [GET /v1/projects/{projectId}/forms/{xmlFormId}/versions/{version}/attachments/{filename}]

To download a single file, use this endpoint. The appropriate `Content-Disposition` (attachment with a filename) and `Content-Type` (based on the type supplied at upload time) will be given.

+ Parameters
    + version: `one` (string, required) - The `version` of the Form version being referenced. Pass `___` to indicate a blank `version`.

+ Response 200
    + Headers

            Content-Type: {the MIME type of the attachment file itself}
            Content-Disposition: attachment; filename={the file's name}

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Getting Form Version Schema Fields [GET /v1/projects/{projectId}/forms/{xmlFormId}/versions/{version}/fields{?odata}]

Identical to the [same request](/reference/forms/individual-form/getting-form-schema-fields) for the published Form, but will return the fields related to the specified version.

+ Parameters
    + version: `one` (string, required) - The `version` of the Form version being referenced. Pass `___` to indicate a blank `version`.
    + odata: `false` (boolean, optional) - If set to `true`, will sanitize field names.

+ Response 200 (application/json)
    + Body

            [
              { "name": "meta", "path": "/meta", "type": "structure" },
              { "name": "instanceID", "path": "/meta/instanceID", "type": "string" },
              { "name": "name", "path": "/name", "type": "string" },
              { "name": "age", "path": "/age", "type": "int" },
              { "name": "photo", "path": "/photo", "type": "binary", "binary": true }
            ]

+ Response 403 (application/json)
    + Attributes (Error 403)

## Form Assignments [/v1/projects/{projectId}/forms/{xmlFormId}/assignments]

_(introduced: version 0.7)_

There are multiple Assignments resources. This one, specific to the Form it is nested within, only governs Role assignments to that Form. Assigning an Actor a Role that grants, for example, a verb `submission.create`, allows that Actor to create a submission to this Form alone. It is also possible to assign umbrella rights to a whole Project and therefore all Forms within it: see the [Project Assignments resource](/reference/project-management/project-assignments) for information about this.

The [sitewide Assignments resource](/reference/accounts-and-users/assignments), at the API root, manages Role assignments for all objects across the server. Apart from this difference in scope, the introduction to that section contains information useful for understanding the following endpoints.

There are only one set of Roles, applicable to either scenario. There are not a separate set of Roles used only upon Projects or Forms.

+ Parameters
    + projectId: `2` (number, required) - The numeric ID of the Project
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

### Listing all Form Assignments [GET]

This will list every assignment upon this Form, in the form of `actorId`/`roleId` pairs.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to expand the `actorId` into a full `actor` objects. The Role reference remains a numeric ID.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Assignment])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Assignment])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Listing all Actors assigned some Form Role [GET /v1/projects/{projectId}/forms/{xmlFormId}/assignments/{roleId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, this endpoint lists all `Actors` that have been assigned that Role upon this particular Form.

+ Parameters
    + roleId: `manager` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.

+ Response 200 (application/json)
    + Attributes (array[Actor])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Assigning an Actor to a Form Role [POST /v1/projects/{projectId}/forms/{xmlFormId}/assignments/{roleId}/{actorId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, and a numeric `actorId`, assigns that Role to that Actor for this particular Form.

No `POST` body data is required, and if provided it will be ignored.

+ Parameters
    + roleId: `manager` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.
    + actorId: `14` (number, required) - The integer ID of the `Actor`.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    

### Revoking a Form Role Assignment from an Actor [DELETE /v1/projects/{projectId}/forms/{xmlFormId}/assignments/{roleId}/{actorId}]

Given a `roleId`, which may be a numeric ID or a string role `system` name, and a numeric `actorId`, unassigns that Role from that Actor for this particular Form.

+ Parameters
    + roleId: `manager` (string, required) - Typically the integer ID of the `Role`. You may also supply the Role `system` name if it has one.
    + actorId: `14` (number, required) - The integer ID of the `Actor`.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Public Access Links [/v1/projects/{projectId}/forms/{xmlFormId}/public-links]

_(introduced: version 1.0)_

Anybody in possession of a Public Access Link for a Form can use that link to submit data to that Form. Public Links are useful for collecting direct responses from a broad set of respondents, and can be revoked using the administration website or the API at any time.

The API for Public Links is particularly useful, as it can be used to, for example, programmatically create and send individually customized and controlled links for direct distribution. The user-facing link for a Public Link has the following structure: `/-/{enketoId}?st={token}` where `-` is the Enketo root, `enketoId` is the survey ID of this published Form on Enketo and `token` is a session token to identify this Public Link.

To revoke the access of any Link, terminate its session `token` by issuing [`DELETE /sessions/:token`](/reference/authentication/session-authentication/logging-out).

+ Parameters
    + projectId: `2` (number, required) - The numeric ID of the Project
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

### Listing all Links [GET]

This will list every Public Access Link upon this Form.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to retrieve the Actor the Link was `createdBy`.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Public Link])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Public Link])

### Creating a Link [POST]

To create a new Public Access Link to this Form, you must send at least a `displayName` for the resulting Actor. You may also provide `once: true` if you want to create a link that [can only be filled by each respondent once](https://blog.enketo.org/single-submission-surveys/). This setting is enforced by Enketo using local device tracking; the link is still distributable to multiple recipients, and the enforcement can be defeated by using multiple browsers or devices.

+ Request (application/json)
    + Attributes
        + displayName: `my public link` (string, required) - The name of the Link, for keeping track of. This name is displayed on the Central administration website but not to survey respondents.
        + once: `false` (boolean, optional) - If set to `true`, an Enketo [single submission survey](https://blog.enketo.org/single-submission-surveys/) will be created instead of a standard one, limiting respondents to a single submission each.

    + Body

            { "displayName": "my public link", "once": false }

+ Response 200 (application/json)
    + Attributes (Public Link)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Deleting a Link [DELETE /v1/projects/{projectId}/forms/{xmlFormId}/public-links/{linkId}]

You can fully delete a link by issuing `DELETE` to its resource. This will remove the Link from the system entirely. If instead you wish to revoke the Link's access to prevent future submission without removing its record entirely, you can issue [`DELETE /sessions/:token`](/reference/authentication/session-authentication/logging-out).

+ Parameters
    + linkId: `42` (integer, required) - The numeric ID of the Link

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)


## Related Datasets [/v1]

_(introduced: version 2022.3)_

Datasets are created and updated through Forms. Dataset-related Forms follow [the entities sub-spec](https://getodk.github.io/xforms-spec/entities) of the ODK XForms specification that allow them to define a Dataset and a mapping of Form Fields to Dataset Properties. Submissions from such a Form can create Entities within the Dataset defined in the Form.

Currently, Datasets and Dataset Properties are purely additive. Multiple Forms can add Properties to the same Dataset and multiple Forms can create Entities in the same Dataset. Not all Properties of a Dataset have to be included in a Form for that Dataset. For example, one Form publishing to a Dataset called `trees` could add `location` and `species`, while another could add `species` and `circumference`. The Properties of the Dataset would be the union of Properties from all Forms for that Dataset (`location`, `species`, `circumference`). Note that it is not necessary that a Form will save to all Properties of a Dataset, so the endpoint also returns a `inForm` flag for each property which is true only if the Form affects that Property.

The following endpoints return the Dataset(s) that Submissions of that Form will populate. They also return all of the Entity Properties for each Dataset and indicate which ones are mapped to Fields in the specified Form.


### Published Form Related Datasets [GET /v1/projects/{projectId}/forms/{xmlFormId}/dataset-diff]

This endpoint lists the name and Properties of a Dataset that are affected by a Form. The list of Properties includes all published Properties on that Dataset, but each property has the `inForm` flag to note whether or not it will be filled in by that form.

+ Response 200 (application/json)
    This is the standard response

    + Attributes (array[Dataset Diff])

### Draft Form Dataset Diff [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/dataset-diff]

This endpoint reflects the change to a Dataset that will go into effect once the form is Published. Like the endpoint above, it lists the Dataset name and Properties, but it also includes the `isNew` flag on both the Dataset, and on each individual property. This flag is true only if the Dataset/Property is new and is going to be created by publishing the Draft Form.

+ Response 200 (application/json)
    This is the standard response

    + Attributes (array[Draft Dataset Diff])
    

# Group Submissions

`Submission`s are filled-out forms (also called `Instance`s in some other ODK documentation). Each is associated with a particular Form (and in many cases with a particular _version_ of a Form), and is also created out of a standard XML format based on the Form itself. Submissions can be sent with many accompanying multimedia attachments, such as photos taken in the course of the survey. Once created, the Submissions themselves as well as their attachments can be retrieved through this API.

These subsections cover only the modern RESTful API resources involving Submissions. For documentation on the OpenRosa submission endpoint (which can be used to submit Submissions), or the OData endpoint (which can be used to retrieve and query submission data), see those sections below.

> Like Forms, Submissions can have versions. Each Form has an overall `xmlFormId` that represents the Form as a whole, and each version has a `version` that identifies that particular version. Often, when fetching data by the `xmlFormId` alone, information from the latest Form version is included in the response.

> Similarly with Submissions, the `instanceId` each Submission is first submitted with will always represent that Submission as a whole. Each version of the Submission, though, has its own `instanceId`. Sometimes, but not very often, when getting information about the Submission by only its overall `instanceId`, information from the latest Submission version is included in the response.

## Submissions [/v1/projects/{projectId}/forms/{xmlFormId}/submissions]

`Submission`s are available as a subresource under `Form`s. So, for instance, `/v1/projects/1/forms/myForm/submissions` refers only to the Submissions that have been submitted to the Form `myForm`.

Once created (which, like with Forms, is done by way of their XML data rather than a JSON description), it is possible to retrieve and export Submissions in a number of ways, as well as to access the multimedia `Attachment`s associated with each Submission.

+ Parameters
    + projectId: `16` (number, required) - The numeric ID of the Project
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

### Listing all Submissions on a Form [GET]

Currently, there are no paging or filtering options, so listing `Submission`s will get you every Submission in the system, every time.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to return a `submitter` data object alongside the `submitterId` Actor ID reference.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Submission])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Submission])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting Submission metadata [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}]

Like how `Form`s are addressed by their XML `formId`, individual `Submission`s are addressed in the URL by their `instanceId`.

As of version 1.4, a `deviceId` and `userAgent` will also be returned with each submission. The client device may transmit these extra metadata when the data is submitted. If it does, those fields will be recognized and returned here for reference. Here, only the initial `deviceId` and `userAgent` will be reported. If you wish to see these metadata for any submission edits, including the most recent edit, you will need to [list the versions](/reference/submissions/submission-versions/listing-versions).

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to return a `submitter` data object alongside the `submitterId` Actor ID reference.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (Submission)

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (Extended Submission)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Updating Submission metadata [PATCH /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}]

Currently, the only updatable _metadata_ on a Submission is its `reviewState`. To update the submission _data_ itself, please see [Updating Submission data](/reference/submissions/submissions/updating-submission-data).

Starting with Version 2022.3, changing the `reviewState` of a Submission to `approved` can create an Entity in a Dataset if the corresponding Form maps Dataset Properties to Form Fields. If an Entity is created successfully then an `entity.create` event is logged in Audit logs, else `entity.create.error` is logged.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.

+ Response 200 (application/json)
    + Attributes (Submission)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Retrieving Submission XML [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}.xml]

To get only the XML of the `Submission` rather than all of the details with the XML as one of many properties, just add `.xml` to the end of the request URL.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.

+ Response 200 (application/xml)
    + Body

            <data id="simple">
              <orx:meta><orx:instanceID>uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44</orx:instanceID></orx:meta>
              <name>Alice</name>
              <age>32</age>
            </data>

### Creating a Submission [POST /v1/projects/{projectId}/forms/{xmlFormId}/submissions{?deviceID}]

To create a Submission by REST rather than over the [OpenRosa interface](/reference/openrosa-endpoints/openrosa-form-submission-api), you may `POST` the Submission XML to this endpoint. The request must have an XML `Content-Type` (`text/xml` or `application/xml`).

Unlike the OpenRosa Form Submission API, this interface does _not_ accept Submission attachments upon Submission creation. Instead, the server will determine which attachments are expected based on the Submission XML, and you may use the endpoints found in the following section to add the appropriate attachments and check the attachment status and content.

If the XML is unparseable or there is some other input problem with your data, you will get a `400` error in response. If a submission already exists with the given `instanceId`, you will get a `409` error in response.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + deviceID: `b1628661-65ed-4cab-8e30-19c17fef2de0` (string, optional) - Optionally record a particular `deviceID` associated with this submission. It is recorded along with the data, but Central does nothing more with it.

+ Request (application/xml)
    + Body

            <data id="simple">
              <orx:meta><orx:instanceID>uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44</orx:instanceID></orx:meta>
              <name>Alice</name>
              <age>32</age>
            </data>

+ Response 200 (application/json)
    + Attributes (Submission)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 409 (application/json)
    + Attributes (Error 409)

### Updating Submission Data [PUT /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}]

_(introduced: version 1.2)_

You can use this endpoint to submit _updates_ to an existing submission.

The `instanceId` that is submitted with the initial version of the submission is used permanently to reference that submission logically, which is to say the initial submission and all its subsequent versions. Each subsequent version will also provide its own `instanceId`. This `instanceId` becomes that particular version's identifier.

To perform an update, you need to provide in the submission XML an additional [`deprecatedID` metadata node](https://getodk.github.io/xforms-spec/#metadata) with the `instanceID` of the particular and current submission version you are replacing. If the `deprecatedID` you give is anything other than the identifier of the current version of the submission at the time the server receives it, you will get a `409 Conflict` back. You can get the current version `instanceID` by getting the [current XML of the submission](/reference/submissions/submissions/retrieving-submission-xml).

The XML data you send will _replace_ the existing data entirely. All of the data must be present in the updated XML.

When you create a new submission version, any uploaded media files attached to the current version that match expected attachment names in the new version will automatically be copied over to the new version. So if you don't make any changes to media files, there is no need to resubmit them. You can get information about all the submission versions [from the `/versions` subresource](reference/submissions/submission-versions).

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being updated.

+ Request (application/xml)
    + Body

            <data id="simple">
              <orx:meta>
                <orx:deprecatedID>uuid:315c2f74-c8fc-4606-ae3f-22f8983e441e</orx:deprecatedID>
                <orx:instanceID>uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44</orx:instanceID>
              </orx:meta>
              <name>Alice</name>
              <age>36</age>
            </data>

+ Response 200 (application/json)
    + Attributes (Submission)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 409 (application/json)
    + Attributes (Error 409)

### Getting an Enketo Edit URL [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/edit]

_(introduced: version 1.2)_

This endpoint redirects the user to an Enketo-powered page that allows the user to interactively edit the submission. Once the user is satisfied, they can perform the submission update directly through the Enketo interface.

The Enketo instance is already hosted inside of ODK Central. There is no reason to create or use a separate Enketo installation.

This endpoint is intended for use by the Central administration frontend and will not work without it. In particular, the user must be logged into the Central administration site for Enketo editing to work. If there is no Central authentication cookie present when Enketo is loaded, the browser will then be redirected by Enketo to a Central login page.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being updated.

+ Response 302
    + Headers

            Location: https://sample.getodk.org/-/edit/BFChy9gKIR86lR54wSlHwrK4TGqBC0F?instance_id=uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44

+ Response 403 (application/json)
    + Attributes (Error 403)

### Exporting Form Submissions to CSV [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions.csv.zip{?attachments,%24filter,groupPaths,deletedFields,splitSelectMultiples}]

To export all the `Submission` data associated with a `Form`, just add `.csv.zip` to the end of the listing URL. The response will be a ZIP file containing one or more CSV files, as well as all multimedia attachments associated with the included Submissions.

You can exclude the media attachments from the ZIP file by specifying `?attachments=false`.

If [Project Managed Encryption](/reference/encryption) is being used, additional querystring parameters may be provided in the format `{keyId}={passphrase}` for any number of keys (eg `1=secret&4=password`). This will decrypt any records encrypted under those managed keys. Submissions encrypted under self-supplied keys will not be decrypted. **Note**: if you are building a browser-based application, please consider the alternative `POST` endpoint, described in the following section.

If a passphrase is supplied but is incorrect, the entire request will fail. If a passphrase is not supplied but encrypted records exist, only the metadata for those records will be returned, and they will have a `status` of `not decrypted`.

If you are running an unsecured (`HTTP` rather than `HTTPS`) Central server, it is not a good idea to export data this way as your passphrase and the decrypted data will be sent plaintext over the network.

You can use an [OData-style `$filter` query](/reference/odata-endpoints/odata-form-service/data-document) to filter the submissions that will appear in the ZIP file. This is a bit awkward, since this endpoint has nothing to do with OData, but since we already must recognize the OData syntax, it is less strange overall for now not to invent a whole other one here. Only a subset of the `$filter` features are available; please see the linked section for more information.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + attachments: `true` (boolean, optional) - Set to false to exclude media attachments from the export.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the given OData query. Only [certain fields](/reference/odata-endpoints/odata-form-service/data-document) are available to reference. The operators `lt`, `le`, `eq`, `neq`, `ge`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.
    + groupPaths: `true` (boolean, optional) - Set to false to remove group path prefixes from field header names (eg `instanceID` instead of `meta-instanceID`). This behavior mimics a similar behavior in ODK Briefcase.
    + deletedFields: `false` (boolean, optional) - Set to true to restore all fields previously deleted from this form for this export. All known fields and data for those fields will be merged and exported.
    + splitSelectMultiples: `false` (boolean, optional) - Set to true to create a boolean column for every known select multiple option in the export. The option name is in the field header, and a `0` or a `1` will be present in each cell indicating whether that option was checked for that row. This behavior mimics a similar behavior in ODK Briefcase.

+ Response 200
    + Headers

            Content-Disposition: attachment; filename=simple.zip

    + Body

            (binary data)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Exporting Form Submissions to CSV via POST [POST /v1/projects/{projectId}/forms/{xmlFormId}/submissions.csv.zip{?attachments,%24filter,groupPaths,deletedFields,splitSelectMultiples}]

This non-REST-compliant endpoint is provided for use with [Project Managed Encryption](/reference/encryption). In every respect, it behaves identically to the `GET` endpoint described in the previous section, except that it works over `POST`. This is necessary because for browser-based applications, it is a dangerous idea to simply link the user to `/submissions.csv.zip?2=supersecretpassphrase` because the browser will remember this route in its history and thus the passphrase will become exposed. This is especially dangerous as there are techniques for quickly learning browser-visited URLs of any arbitrary domain.

You can exclude the media attachments from the ZIP file by specifying `?attachments=false`.

And so, for this `POST` version of the Submission CSV export endpoint, the passphrases may be provided via `POST` body rather than querystring. Two formats are supported: form URL encoding (`application/x-www-form-urlencoded`) and JSON. In either case, the keys should be the `keyId`s and the values should be the `passphrase`s, as with the `GET` version above.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + attachments: `true` (boolean, optional) - Set to false to exclude media attachments from the export.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the given OData query. Only [certain fields](/reference/odata-endpoints/odata-form-service/data-document) are available to reference. The operators `lt`, `le`, `eq`, `neq`, `ge`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.
    + groupPaths: `true` (boolean, optional) - Set to false to remove group path prefixes from field header names (eg `instanceID` instead of `meta-instanceID`). This behavior mimics a similar behavior in ODK Briefcase.
    + deletedFields: `false` (boolean, optional) - Set to true to restore all fields previously deleted from this form for this export. All known fields and data for those fields will be merged and exported.
    + splitSelectMultiples: `false` (boolean, optional) - Set to true to create a boolean column for every known select multiple option in the export. The option name is in the field header, and a `0` or a `1` will be present in each cell indicating whether that option was checked for that row. This behavior mimics a similar behavior in ODK Briefcase.

+ Response 200
    + Headers

            Content-Disposition: attachment; filename=simple.zip

    + Body

            (binary data)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Exporting Root Data to Plain CSV [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions.csv{?%24filter}]

_(introduced: version 1.1)_

The above submission endpoints will give you a ZIP file with the submission data in it. This is necessary to provide all the possible related repeat table files, as well as the media files associated with the submissions. But ZIP files can be difficult to work with, and many Forms have no repeats nor media attachments.

To export _just_ the root table (no repeat data nor media files), you can call this endpoint instead, which will directly give you CSV data.

Please see the [above endpoint](/reference/submissions/submissions/exporting-form-submissions-to-csv) for notes on dealing with Managed Encryption.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the given OData query. Only [certain fields](/reference/odata-endpoints/odata-form-service/data-document) are available to reference. The operators `lt`, `le`, `eq`, `neq`, `ge`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.

+ Response 200
    + Body

            (csv text)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Exporting Root Data to Plain CSV via POST [POST /v1/projects/{projectId}/forms/{xmlFormId}/submissions.csv{?%24filter}]

_(introduced: version 1.1)_

This endpoint is useful only for Forms under Project Managed Encryption.

As with `GET` to `.csv` just above, this endpoint will only return CSV text data, rather than a ZIP file containing ore or more files. Please see that endpoint for further explanation.

As with [`POST` to `.csv.zip`](/reference/submissions/submissions/exporting-form-submissions-to-csv-via-post) it allows secure submission of decryption passkeys. Please see that endpoint for more information on how to do this.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the given OData query. Only [certain fields](/reference/odata-endpoints/odata-form-service/data-document) are available to reference. The operators `lt`, `le`, `eq`, `neq`, `ge`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.

+ Response 200
    + Body

            (csv data)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Retrieving Audit Logs [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/audits]

_(introduced: version 1.2)_

You can retrieve all [Server Audit Logs](/reference/system-endpoints/server-audit-logs) relating to a submission. They will be returned most recent first.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally expand the `actorId` into full `actor` details, and `acteeId` into full `actee` details. The `actor` will always be an Actor, and the `actee` will be the Form this Submission is a part of.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission.

+ Response 200 (application/json)
    + Attributes (array[Audit])

+ Response 200 (application/json; extended)
    + Attributes (array[Extended Audit])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Listing Encryption Keys [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/keys]

This endpoint provides a listing of all known encryption keys needed to decrypt all Submissions for a given Form. It will return at least the `base64RsaPublicKey` property (as `public`) of all known versions of the form that have submissions against them. If managed keys are being used and a `hint` was provided, that will be returned as well.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Response 200
    + Attributes (array[Key])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Listing Submitters [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/submitters]

This endpoint provides a listing of all known submitting actors to a given Form. Each Actor that has submitted to the given Form will be returned once.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Response 200
    + Attributes (array[Actor])

+ Response 403 (application/json)
    + Attributes (Error 403)

## Comments [/v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/comments]

_(introduced: version 1.2)_

This API is likely to change in the future. In version 1.2 we have added comments to submissions, so changes and problems with the data can be discussed. It's very likely we will want comments in more places in the future, and at that time a more complete comments API will be introduced, and this current one may be changed or deprecated entirely.

Currently, it is not possible to get a specific comment's details, or to edit or delete a comment once it has been made.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.

### Listing Comments [GET]

Comments have only a `body` comment text and an `actor` that made the comment.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to return a `actor` data object alongside the `actorId` Actor ID reference.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Comment])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Comment])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Posting Comments [POST]

Currently, the only accepted data is `body`, which contains the body of the comment to be made.

+ Request (application/json)
    + Attributes
        + body: `this is the text of my comment` (string, required) - The text of the comment.

+ Response 200 (application/json)
    + Attributes (Comment)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Attachments [/v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments]

When a `Submission` is created, either over the OpenRosa or the REST interface, its XML data is analyzed to determine which file attachments it references: these may be photos or video taken as part of the survey, or an audit/timing log, among other things. Each reference is an expected attachment, and these expectations are recorded permanently alongside the Submission.

With this subresource, you can list the expected attachments, see whether the server actually has a copy or not, and download, upload, re-upload, or clear binary data for any particular attachment.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.

### Listing expected Submission Attachments [GET]

 You can retrieve the list of expected Submission attachments at this route, along with a boolean flag indicating whether the server actually has a copy of the expected file or not. If the server has a file, you can then append its filename to the request URL to download only that file (see below).

+ Response 200 (application/json)
    + Attributes (array[Submission Attachment])

    + Body

            [{
                "name": "file1.jpg",
                "exists": true
            }, {
                "name": "file2.jpg",
                "exists": false
            }, {
                "name": "file3.jpg",
                "exists": true
            }]

+ Response 403 (application/json)
    + Attributes (Error 403)

### Downloading an Attachment [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments/{filename}]

The `Content-Type` and `Content-Disposition` will be set appropriately based on the file itself when requesting an attachment file download.

+ Parameters
    + filename: `file1.jpg` (string, required) - The name of the file as given by the Attachments listing resource.

+ Response 200
    + Headers

            Content-Type: {the MIME type of the attachment file itself}
            Content-Disposition: attachment; filename={the file's name}

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Uploading an Attachment [POST /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments/{filename}]

_(introduced: version 0.4)_

To upload a binary to an expected file slot, `POST` the binary to its endpoint. Supply a `Content-Type` MIME-type header if you have one.

+ Parameters
    + filename: `file1.jpg` (string, required) - The name of the file as given by the Attachments listing resource.

+ Request (*/*)
    + Body

            (binary data)

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Clearing a Submission Attachment [DELETE /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments/{filename}]

_(introduced: version 0.4)_

Because Submission Attachments are completely determined by the XML data of the submission itself, there is no direct way to entirely remove a Submission Attachment entry from the list, only to clear its uploaded content. Thus, when you issue a `DELETE` to the attachment's endpoint, that is what happens.

+ Parameters
    + filename: `file1.jpg` (string, required) - The name of the file as given by the Attachments listing resource.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Submission Versions [/v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/versions]

_(introduced: version 1.2)_

The `instanceId` that is submitted with the initial version of the submission is used permanently to reference that submission logically, which is to say the initial submission and all its subsequent versions. Each subsequent version will also provide its own `instanceId`. This `instanceId` becomes that particular version's identifier.

So if you submit a submission with `<orx:instanceID>one</orx:instanceID>` and then update it, deprecating `one` for version `two`, then the full route for version `one` is `/v1/projects/…/forms/…/submissions/one/versions/one`, and for `two` it is `/v1/projects/…/forms/…/submissions/one/versions/two`.

As of version 1.4, a `deviceId` and `userAgent` will also be returned with each submission. For each submission of a version, the submitting client device may transmit these extra metadata. If it does, those fields will be recognized and returned here for reference.

+ Parameters
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, optional) - The `instanceId` of the initially submitted version. Please see the notes at the top of this documentation section for more information.

### Listing Versions [GET]

This will return all submission metadata for every version of this submission, in descending creation order.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to return a `submitter` data object alongside the `submitterId` Actor ID reference.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Submission])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Submission])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting Version Details [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/versions/{versionId}]

Returns metadata about a particular version of the submission. As with the normal submission endpoint, you'll only get metadata in JSON out of this route. If you want to retrieve the XML, [add `.xml`](/reference/submissions/submission-versions/getting-version-xml).

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to return a `submitter` data object alongside the `submitterId` Actor ID reference.

+ Parameters
    + versionId: `uuid:b1628661-65ed-4cab-8e30-19c17fef2de0` (required, string) - The `instanceId` of the particular version of this submission in question.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (Submission)

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (Extended Submission)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting Version XML [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/versions/{versionId}.xml]

Returns the XML of a particular version of the submission.

+ Parameters
    + versionId: `uuid:b1628661-65ed-4cab-8e30-19c17fef2de0` (required, string) - The `instanceId` of the particular version of this submission in question.

+ Response 200 (application/xml)
    + Body

            <data id="simple">
              <orx:meta><orx:instanceID>uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44</orx:instanceID></orx:meta>
              <name>Alice</name>
              <age>32</age>
            </data>

+ Response 403 (application/json)
    + Attributes (Error 403)

### Listing Version expected Attachments [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/versions/{versionId}/attachments]

 You can retrieve the list of expected Submission attachments for the given version at this route, along with a boolean flag indicating whether the server actually has a copy of the expected file or not. If the server has a file, you can then append its filename to the request URL to download only that file (see below).

+ Parameters
    + versionId: `uuid:b1628661-65ed-4cab-8e30-19c17fef2de0` (required, string) - The `instanceId` of the particular version of this submission in question.

+ Response 200 (application/json)
    + Attributes (array[Submission Attachment])

    + Body

            [{
                "name": "file1.jpg",
                "exists": true
            }, {
                "name": "file2.jpg",
                "exists": false
            }, {
                "name": "file3.jpg",
                "exists": true
            }]

+ Response 403 (application/json)
    + Attributes (Error 403)

### Downloading a Version's Attachment [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/versions/{versionId}/attachments/{filename}]

It is important to note that this endpoint returns whatever is _currently_ uploaded against the _particular version_ of the _Submission_. It will not track overwritten attachments.

+ Parameters
    + versionId: `uuid:b1628661-65ed-4cab-8e30-19c17fef2de0` (required, string) - The `instanceId` of the particular version of this submission in question.
    + filename: `file1.jpg` (string, required) - The name of the file as given by the Attachments listing resource.

+ Response 200
    + Headers

            Content-Type: {the MIME type of the attachment file itself}
            Content-Disposition: attachment; filename={the file's name}

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting changes between Versions [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/diffs]

This returns the changes, or edits, between different versions of a Submission. These changes are returned in an object that is indexed by the `instanceId` that uniquely identifies that version. Between two submissions, there is an array of objects representing how each field changed. This change object contains the old and new values, as well as the path of that changed node in the Submission XML. These changes reflect the updated `instanceID` and `deprecatedID` fields as well as the edited value.

+ Response 200
    + Attributes (array[array[Submission Diff Value]])

    + Body

            {
              "two": [
                {
                  "new": "Donna",
                  "old": "Dana",
                  "path": ["name"]
                },
                {
                  "new": "55",
                  "old": "44",
                  "path": ["age"]
                },
                {
                  "new": "two",
                  "old": "one",
                  "path": ["meta", "instanceID"]
                },
                {
                  "new": "one",
                  "old": null,
                  "path": ["meta", "deprecatedID"]
                  ]
                }
              ]
            }


+ Response 403 (application/json)
    + Attributes (Error 403)

## Draft Submissions [/v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions]

All [Draft Forms](/reference/forms/draft-form) feature a `/submissions` subresource (`/draft/submissions`), which is identical to the same subresource on the form itself. These submissions exist only as long as the Draft Form does: they are removed if the Draft Form is published, and they are abandoned if the Draft Form is deleted or overwritten.

Here we list all those resources again just for completeness.

+ Parameters
    + projectId: `1` (number, required) - The `id` of the project this form belongs to.
    + xmlFormId: `simple` (string, required) - The `id` of this form as given in its XForms XML definition

### Listing all Submissions on a Draft Form [GET]

Identical to [the non-Draft version](/reference/submissions/submissions/listing-all-submissions-on-a-form) of this endpoint.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Submission])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Submission])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Exporting Form Submissions to CSV [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions.csv.zip]

Identical to [the non-Draft version](/reference/submissions/submissions/exporting-form-submissions-to-csv) of this endpoint.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Response 200
    + Headers

            Content-Disposition: attachment; filename=simple.zip

    + Body

            (binary data)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Exporting Form Submissions to CSV via POST [POST /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions.csv.zip]

Identical to [the non-Draft version](/reference/submissions/submissions/exporting-form-submissions-to-csv-via-post) of this endpoint.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Response 200
    + Headers

            Content-Disposition: attachment; filename=simple.zip

    + Body

            (binary data)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Listing Encryption Keys [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions/keys]

Identical to [the non-Draft version](/reference/submissions/submissions/listing-encryption-keys) of this endpoint.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Response 200
    + Attributes (array[Key])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting Submission details [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions/{instanceId}]

Identical to [the non-Draft version](/reference/submissions/submissions/getting-submission-metadata) of this endpoint.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (Submission)

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (Extended Submission)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Retrieving Submission XML [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions/{instanceId}.xml]

Identical to [the non-Draft version](/reference/submissions/submissions/retrieving-submission-xml) of this endpoint.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.

+ Response 200 (application/xml)
    + Body

            <data id="simple">
              <orx:meta><orx:instanceID>uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44</orx:instanceID></orx:meta>
              <name>Alice</name>
              <age>32</age>
            </data>

### Creating a Submission [POST /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions]

Identical to [the non-Draft version](/reference/submissions/submissions/creating-a-submission) of this endpoint.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Request (application/xml)
    + Body

            <data id="simple">
              <orx:meta><orx:instanceID>uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44</orx:instanceID></orx:meta>
              <name>Alice</name>
              <age>32</age>
            </data>

+ Response 200 (application/json)
    + Attributes (Submission)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 409 (application/json)
    + Attributes (Error 409)

### Listing expected Submission Attachments [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions/{instanceId}/attachments]

Identical to [the non-Draft version](/reference/submissions/attachments/listing-expected-submission-attachments) of this endpoint.

+ Parameters
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.

+ Response 200 (application/json)
    + Attributes (array[Submission Attachment])

    + Body

            [{
                "name": "file1.jpg",
                "exists": true
            }, {
                "name": "file2.jpg",
                "exists": false
            }, {
                "name": "file3.jpg",
                "exists": true
            }]

+ Response 403 (application/json)
    + Attributes (Error 403)

### Downloading an Attachment [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions/{instanceId}/attachments/{filename}]

Identical to [the non-Draft version](/reference/submissions/attachments/downloading-an-attachment) of this endpoint.

+ Parameters
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.
    + filename: `file1.jpg` (string, required) - The name of the file as given by the Attachments listing resource.

+ Response 200
    + Headers

            Content-Type: {the MIME type of the attachment file itself}
            Content-Disposition: attachment; filename={the file's name}

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Uploading an Attachment [POST /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions/{instanceId}/attachments/{filename}]

Identical to [the non-Draft version](/reference/submissions/attachments/uploading-an-attachment) of this endpoint.

+ Parameters
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.
    + filename: `file1.jpg` (string, required) - The name of the file as given by the Attachments listing resource.

+ Request (*/*)
    + Body

            (binary data)

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Clearing a Submission Attachment [DELETE /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions/{instanceId}/attachments/{filename}]

Identical to [the non-Draft version](/reference/submissions/attachments/clearing-a-submission-attachment) of this endpoint.

+ Parameters
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.
    + filename: `file1.jpg` (string, required) - The name of the file as given by the Attachments listing resource.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group Datasets

_(introduced: version 2022.3)_

Version 2022.3 introduces server-managed Datasets as the first step on our [Entity-based data collection](https://forum.getodk.org/t/entity-based-data-collection/38115) journey.

An Entity is a specific person, place, or thing. A Dataset is a collection of Entities. A Dataset is defined within a Form, and then a Submission to that Form creates an Entity when that Submission is **approved**. The Dataset definition includes the Dataset name and which Form fields map to which Dataset/Entity Properties, e.g. how to construct an Entity from a Submission.

See the [ODK XForms specification](https://getodk.github.io/xforms-spec) for guidance on defining Datasets in Forms.

Once a Dataset exists, it can be linked to another Form as an Attachment and served as an automatically-updating CSV.

### Related APIs:

- [Implicit creation of Datasets via Forms](#reference/forms/forms/creating-a-new-form)
- [Link a Dataset to a Form Attachment](#reference/forms/draft-form/linking-a-dataset-to-a-draft-form-attachment)
- [Get a Form's Related Datasets](#reference/forms/related-datasets)


## Datasets [GET /projects/{projectId}/datasets]

The Dataset listing endpoint returns all published Datasets in a Project. If a Draft Form defines a new Dataset, that Dataset will not be included in this list until the Form is published.

+ Parameters
    + projectId: `16` (number, required) - The numeric ID of the Project

+ Response 200 (application/json)
    This is the standard response

    + Attributes (array[Dataset])

+ Response 403 (application/json)
    + Attributes (Error 403)

## Download Dataset [GET /projects/{projectId}/datasets/{name}/entities.csv]

Datasets (collections of Entities) can be used as Attachments in other Forms, but they can also be downloaded directly as a CSV file. The CSV format matches what is expected for a [select question](https://docs.getodk.org/form-datasets/#building-selects-from-csv-files) with columns for `name`, `label,` and properties. In the case of Datasets, the `name` column is the Entity's UUID, the `label` column is the human-readable Entity label populated in the Submission, and the properties are the full set of Dataset Properties for that Dataset. If any Property for an given Entity is blank (e.g. it was not captured by that Form or was left blank), that field of the CSV is blank.

Note that as of Version 2022.3 we do not guarantee the order of the Dataset Property columns.

```
name,label,first_name,last_name,age,favorite_color
54a405a0-53ce-4748-9788-d23a30cc3afa,Amy Aardvark,Amy,Aardvark,45,
0ee79b8b-9711-4aa0-9b7b-ece0a109b1b2,Beth Baboon,Beth,Baboon,19,yellow
3fc9c54c-7d41-4258-b014-bfacedb95711,Cory Cat,Cory,Cat,,cyan
```


+ Parameters
    + projectId: `16` (number, required) - The numeric ID of the Project
    + name: `people` (string, required) - Name of the Dataset

+ Response 200
    + Headers

            Content-Type: text/csv
            Content-Disposition: attachment; filename={the dataset name}.csv

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group OpenRosa Endpoints

[OpenRosa](https://bitbucket.org/javarosa/javarosa/wiki/OpenRosaAPI) is an API standard which accompanies the ODK XForms XML standard, allowing compliant servers and clients to use a common protocol to communicate `Form`s and `Submission`s to each other. When survey clients like ODK Collect and Enketo submit Submission data to a Form, this is the API they use.

ODK Central is _not_ a fully compliant OpenRosa server. OpenRosa requires compliance with five major components:

1. [**Metadata Schema**](https://bitbucket.org/javarosa/javarosa/wiki/OpenRosaMetaDataSchema), which defines a standard way to include metadata like the survey device ID and survey duration with a Submission. ODK Central will accept and return this data, but does nothing special with anything besides the `instanceId` at this time.
2. [**HTTP Request API**](https://bitbucket.org/javarosa/javarosa/wiki/OpenRosaRequest), which defines a set of requirements every OpenRosa request and response must follow. ODK Central is fully compliant with this component, except that we do _not_ require the `Date` header.
3. [**Form Submission API**](https://bitbucket.org/javarosa/javarosa/wiki/FormSubmissionAPI), which defines how Submissions are submitted to the server. ODK Central is fully compliant with this component.
4. [**Authentication API**](https://bitbucket.org/javarosa/javarosa/wiki/AuthenticationAPI), which defines how users authenticate with the server. ODK Central provides [three authentication methods](/reference/authentication). One of these is HTTPS Basic Authentication, which is recommended by the OpenRosa specification. However, because [we do not follow the try/retry pattern](/reference/authentication/https-basic-authentication/using-basic-authentication) required by the OpenRosa and the RFC specification, ODK Central is _not compliant_ with this component. Our recommendation generally is to use [App User Authentication](/reference/authentication/app-user-authentication) when submitting data from survey clients.
5. [**Form Discovery (Listing) API**](https://bitbucket.org/javarosa/javarosa/wiki/FormListAPI), which returns a listing of Forms available for survey clients to download and submit to. At this time, ODK Central is _partially compliant_ with this component: the server will return a correctly formatted `formList` response, but it does not currently handle the optional filter parameters.

In practical usage, ODK survey clients like Collect will interact with Central in three places:

* The OpenRosa Form Listing API, [documented below](/reference/openrosa-endpoints/openrosa-form-listing-api), lists the Forms the client can retrieve.
* The [Form XML download](/reference/forms/individual-form/retrieving-form-xml) endpoint, a part of the standard REST API for Forms, is linked in the Form Listing response and allows clients to then download the ODK XForms XML for each form.
* The OpenRosa Submission API, [documented below](/reference/openrosa-endpoints/openrosa-form-submission-api), allows survey clients to submit new Submissions to any Form.

The Form Listing and Submission APIs are partitioned by Project, and their URLs are nested under the Project in question as a result. When you List or Submit, you will only be able to get forms from and submit submissions to that particular Project at a time.

Where the **HTTP Request API** OpenRosa standards specification requires two headers for any request, Central requires only one:

* `X-OpenRosa-Version` **must** be set to exactly `1.0` or the request will be rejected.
* But Central does not require a `Date` header field. You may set it if you wish, but it will have no effect on Central.

## OpenRosa Form Listing API [GET /v1/projects/{projectId}/formList]

This is the mostly standards-compliant implementation of the [OpenRosa Form Discovery (Listing) API](https://bitbucket.org/javarosa/javarosa/wiki/FormListAPI). We will not attempt to redocument the standard here.

The following aspects of the standard are _not_ supported by ODK Central:

* The `deviceID` may be provided with the request, but it will be ignored.
* The `Accept-Language` header may be provided with the request, but it will be ignored.
* The `?formID=` querystring parameter is not supported and will be ignored.
* The `?verbose` querystring parameter is not supported and will be ignored.
* The `?listAllVersions` querystring is not supported and will be ignored. Central does not yet support multiple active versions of the same Form.
* No `<xforms-group/>` will ever be provided, as Central does not yet support this feature.

By default, the given `<name/>` in the Form Listing response is the friendly name associated with the `Form` (`<title>` in the XML and `name` on the API resource). If no such value can be found, then the `xmlFormId` will be given as the `<name>` instead.

A `<manifestUrl/>` property will be given per `<xform>` if and only if that form is expected to have media or data file attachments associated with it, based on its XForms definition. It will appear even if no attachments have actually been uploaded to the server to fulfill those expectations.

This resource always requires authentication. If a valid Actor is authenticated at all, a form list will always be returned, filtered by what that Actor is allowed to access.

If you haven't already, please take a look at the **HTTP Request API** notes above on the required OpenRosa headers.

+ Parameters
    + projectId: `7` (number, required) - The numeric ID of the Project

+ Request
    + Headers

            X-OpenRosa-Version: 1.0

+ Response 200 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <?xml version="1.0" encoding="UTF-8"?>
            <xforms xmlns="http://openrosa.org/xforms/xformsList">
              <xform>
                <formID>basic</formID>
                <name>basic</name>
                <version></version>
                <hash>md5:a64817a5688dd7c17563e32d4eb1cab2</hash>
                <downloadUrl>https://your.odk.server/v1/projects/7/forms/basic.xml</downloadUrl>
                <manifestUrl>https://your.odk.server/v1/projects/7/forms/basic/manifest</manifestUrl>
              </xform>
              <xform>
                <formID>simple</formID>
                <name>Simple</name>
                <version></version>
                <hash>md5:</hash>
                <downloadUrl>https://your.odk.server/v1/projects/7/forms/simple.xml</downloadUrl>
              </xform>
            </xforms>

## OpenRosa Form Submission API [POST /v1/projects/{projectId}/submission]

This is the fully standards-compliant implementation of the [OpenRosa Form Submission API](https://bitbucket.org/javarosa/javarosa/wiki/FormSubmissionAPI). We will not attempt to redocument the submission part of the standard here, but please read further for information about _updating_ submissions with new data.

Some things to understand when using this API for any reason:

* ODK Central will always provide an `X-OpenRosa-Accept-Content-Length` of 100 megabytes. In reality, this number depends on how the server has been deployed. The default Docker-based installation, for example, is limited to 100MB at the nginx layer.
* The `xml_submission_file` may have a Content Type of either `text/xml` _or_ `application/xml`.
* Central supports the `HEAD` request preflighting recommended by the specification, but does not require it. Because our supported authentication methods do not follow the try/retry pattern, only preflight your request if you want to read the `X-OpenRosa-Accept-Content-Length` header or are concerned about the other issues listed in the standards document, like proxies.
* As stated in the standards document, it is possible to submit multimedia attachments with the `Submission` across multiple `POST` requests to this API. _However_, we impose the additional restriction that the Submission XML (`xml_submission_file`) _may not change_ between requests. If Central sees a Submission with an `instanceId` it already knows about but the XML has changed in any way, it will respond with a `409 Conflict` error and reject the submission.
* Central will never return a `202` in any response from this API.
* If you haven't already, please take a look at the **HTTP Request API** notes above on the required OpenRosa headers.

You can use this endpoint to submit _updates_ to an existing submission. To do so, provide additionally a [`deprecatedID` metadata XML node](https://getodk.github.io/xforms-spec/#metadata) with the `instanceID` of the submission you are replacing. Some things to understand when submitting updates:

* The new XML entirely replaces the old XML. No merging will be performed. So your new submission must contain exactly the current data.
* If the `deprecatedID` you provide has already been deprecated, your request will be rejected with a `409 Conflict` and a useful error message.
* If the submission you are deprecating had media files uploaded for it, any of those that are still relevant will be carried over to the new version by filename reference. Any files you provide will overwrite these carryovers.
* Just as with initial submission, you can send multiple requests to this endpoint to submit additional media files if they do not comfortably fit in a single request. Also the same as initial submission, you'll need to provide exactly the same XML to make this happen. For updates, this will need to include the `deprecatedID`.

+ Parameters
    + projectId: `7` (number, required) - The numeric ID of the Project

+ Request (multipart/form-data; boundary=28b9211a964e44a3b327c3c51a0dbd32)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            --28b9211a964e44a3b327c3c51a0dbd32
            Content-Disposition: form-data; name="xml_submission_file"; filename="submission.xml"
            Content-Type: application/xml

            <data id="simple"><meta><instanceID>uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44</instanceID></meta><name>Alice</name><age>30</age></data>

            --28b9211a964e44a3b327c3c51a0dbd32--

+ Response 201 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="">full submission upload was successful!</message>
            </OpenRosaResponse>

+ Response 400 (text/xml)
    This is one of several possible `400` failures the API might return:

    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="error">A resource already exists with a attachment file name of attachment1.jpg.</message>
            </OpenRosaResponse>

+ Response 403 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="error">The authenticated actor does not have rights to perform that action.</message>
            </OpenRosaResponse>

+ Response 409 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="error">A submission already exists with this ID, but with different XML. Resubmissions to attach additional multimedia must resubmit an identical xml_submission_file.</message>
            </OpenRosaResponse>

## OpenRosa Form Manifest API [GET /v1/projects/{projectId}/forms/{xmlFormId}/manifest]

_(introduced: version 0.2)_

This is the fully standards-compliant implementation of the [OpenRosa Form Manifest API](https://bitbucket.org/javarosa/javarosa/wiki/FormListAPI#!the-manifest-document). We will not attempt to redocument the standard here.

A Manifest document is available at this resource path for any form in the system. However:

* A link to this document will not be given in the [Form Listing API](/reference/openrosa-endpoints/openrosa-form-listing-api) unless we expect the form to have media or data file attachments based on the XForms definition of the form.
* The Manifest will only output information for files the server actually has in its possession. Any missing expected files will be omitted, as we cannot provide a `hash` or `downloadUrl` for them.
* For Attachments that are linked to a Dataset, the value of `hash` is calculated using the MD5 of the last updated timestamp of the Dataset, instead of the content of the Dataset.

+ Parameters
    + projectId: `7` (number, required) - The numeric ID of the Project

+ Request
    + Headers

            X-OpenRosa-Version: 1.0

+ Response 200 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <?xml version="1.0" encoding="UTF-8"?>
            <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
              <mediaFile>
                <filename>question1.jpg</filename>
                <hash>md5:a64817a5688dd7c17563e32d4eb1cab2</hash>
                <downloadUrl>https://your.odk.server/v1/projects/7/forms/basic/attachments/question1.jpg</downloadUrl>
              </mediaFile>
              <mediaFile>
                <filename>question2.jpg</filename>
                <hash>md5:a6fdc426037143cf71cced68e2532e3c</hash>
                <downloadUrl>https://your.odk.server/v1/projects/7/forms/basic/attachments/question2.jpg</downloadUrl>
              </mediaFile>
            </manifest>

+ Response 403 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="error">The authenticated actor does not have rights to perform that action.</message>
            </OpenRosaResponse>

## Draft Testing Endpoints [/v1/test/{token}/projects/{projectId}/forms/{xmlFormId}/draft]

_(introduced: version 0.8)_

To facilitate testing, there is an alternative collection of OpenRosa endpoints that will give access to the draft version of a form and allow submitting test submissions to it. If you are using User or App User authentication, you can use the following resources without the `/test/{token}` prefix with your existing authentication.

Otherwise, and in particular if you plan to test your form in Collect or another OpenRosa-compliant client, you will likely want to use the `/test` Draft Token prefix. It functions similarly to the standard OpenRosa support, with App User authentication, but instead of a `/key` route prefix they feature a `/test` route prefix, and they point directly at each form (example: `/test/lSpA…EjR7/projects/1/forms/myform/draft`).

You can get the appropriate Draft Token for any given draft by [requesting the Draft Form](/reference/forms/draft-form/getting-draft-form-details).

The `/test` tokens are not actual App Users, and Central does not keep track of user identity when they are used.

With the `/test` prefix, the following resources are available:

+ Parameters
    + token: `IeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QP` (string, required) - The authentication Draft Token associated with the Draft Form in question.
    + projectId: `1` (number, required) - The `id` of the project this form belongs to.
    + xmlFormId: `simple` (string, required) - The `id` of this form as given in its XForms XML definition

### OpenRosa Form Listing API [GET /v1/test/{token}/projects/{projectId}/forms/{xmlFormId}/draft/formList]

Identical to the [non-Draft version](/reference/openrosa-endpoints/openrosa-form-listing-api/openrosa-form-listing-api), but will only list the Draft Form to be tested.

+ Request
    + Headers

            X-OpenRosa-Version: 1.0

+ Response 200 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <?xml version="1.0" encoding="UTF-8"?>
            <xforms xmlns="http://openrosa.org/xforms/xformsList">
              <xform>
                <formID>basic</formID>
                <name>basic</name>
                <version></version>
                <hash>md5:a64817a5688dd7c17563e32d4eb1cab2</hash>
                <downloadUrl>https://your.odk.server/v1/test/IeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QP/projects/7/forms/basic/draft.xml</downloadUrl>
                <manifestUrl>https://your.odk.server/v1/test/IeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QP/projects/7/forms/basic/draft/manifest</manifestUrl>
              </xform>
            </xforms>

### OpenRosa Form Submission API [POST /v1/test/{token}/projects/{projectId}/forms/{xmlFormId}/draft/submission]

Identical to the [non-Draft version](/reference/openrosa-endpoints/openrosa-form-submission-api/openrosa-form-submission-api), but will only submit to (and allow submissions to) the Draft Form to be tested.

+ Request (multipart/form-data; boundary=28b9211a964e44a3b327c3c51a0dbd32)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            --28b9211a964e44a3b327c3c51a0dbd32
            Content-Disposition: form-data; name="xml_submission_file"; filename="submission.xml"
            Content-Type: application/xml

            <data id="simple"><meta><instanceID>uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44</instanceID></meta><name>Alice</name><age>30</age></data>

            --28b9211a964e44a3b327c3c51a0dbd32--

+ Response 201 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="">full submission upload was successful!</message>
            </OpenRosaResponse>

+ Response 400 (text/xml)
    This is one of several possible `400` failures the API might return:

    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="error">A resource already exists with a attachment file name of attachment1.jpg.</message>
            </OpenRosaResponse>

+ Response 403 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="error">The authenticated actor does not have rights to perform that action.</message>
            </OpenRosaResponse>

+ Response 409 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="error">A submission already exists with this ID, but with different XML. Resubmissions to attach additional multimedia must resubmit an identical xml_submission_file.</message>
            </OpenRosaResponse>

### OpenRosa Form Manifest API [GET /v1/test/{token}/projects/{projectId}/forms/{xmlFormId}/draft/manifest]

Identical to the [non-Draft version](/reference/openrosa-endpoints/openrosa-form-manifest-api/openrosa-form-manifest-api).

+ Request
    + Headers

            X-OpenRosa-Version: 1.0

+ Response 200 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <?xml version="1.0" encoding="UTF-8"?>
            <manifest xmlns="http://openrosa.org/xforms/xformsManifest">
              <mediaFile>
                <filename>question.jpg</filename>
                <hash>md5:a64817a5688dd7c17563e32d4eb1cab2</hash>
                <downloadUrl>https://your.odk.server/v1/test/IeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QP/projects/7/forms/basic/draft/attachments/question.jpg</downloadUrl>
              </mediaFile>
            </manifest>

+ Response 403 (text/xml)
    + Headers

            X-OpenRosa-Version: 1.0

    + Body

            <OpenRosaResponse xmlns="http://openrosa.org/http/response" items="0">
              <message nature="error">The authenticated actor does not have rights to perform that action.</message>
            </OpenRosaResponse>

### Downloading a Form Attachment [GET /v1/test/{token}/projects/{projectId}/forms/{xmlFormId}/attachments/{filename}]

Identical to the [non-Draft version](/reference/forms/individual-form/downloading-a-form-attachment).

+ Response 200
    + Headers

            Content-Type: {the MIME type of the attachment file itself}
            Content-Disposition: attachment; filename={the file's name}

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group OData Endpoints

[OData](http://www.odata.org/) is an emerging standard for the formal description and transfer of data between web services. In its most ambitious form, it aims to be _the_ standard way for any REST or REST-like API to enable interoperability with other services, not unlike the API Blueprint format this document is written in. However, in practical usage today it is primarily a way for data-centric web services to describe and transfer their data to various clients for deeper analysis or presentation.

ODK Central implements the [4.0 Minimal Conformance level](http://docs.oasis-open.org/odata/odata/v4.01/cs01/part1-protocol/odata-v4.01-cs01-part1-protocol.html#_Toc505771292) of the specification. Our goal is to enable data analysis and reporting through powerful third-party tools, sending them the data over OData, rather than attempt to create our own analysis tools. Today, our implementation primarily targets [Microsoft Power BI](https://docs.microsoft.com/en-us/power-bi/desktop-connect-odata) and [Tableau](https://onlinehelp.tableau.com/current/pro/desktop/en-us/examples_odata.html), two tools with reasonably robust free offerings that provide versatile analysis and visualization of data.

While OData itself supports data of any sort of structure, Power BI and Tableau both think in terms of relational tables. This presents an interesting challenge for representing ODK's `group` and `repeat` structures in OData. Our current solution is to treat every `repeat` in the `Form` definition as its own relational table, and we invent stable join IDs to relate the tables together.

In general, the OData standard protocol consists of three API endpoints:

* The **Service Document** describes the available resources in the service. We provide one of these for every `Form` in the system. In our case, these are the tables we derive from the `repeat`s in the given Form. The root table is always named `Submissions`.
* The **Metadata Document** is a formal XML-based EDMX schema description of every data object we might return. It is linked in every OData response.
* The actual data documents, linked from the Service Document, are a simple JSON representation of the submission data, conforming to the schema we describe in our Metadata Document.

As our focus is on the bulk-export of data from ODK Central so that more advanced analysis tools can handle the data themselves, we do not support most of the features at the Intermediate and above conformance levels, like `$sort` or `$filter`.

## OData Form Service [/v1/projects/{projectId}/forms/{xmlFormId}.svc]

ODK Central presents one OData service for every `Form` it knows about. Each service might have multiple tables related to that Form. To access the OData service, simply add `.svc` to the resource URL for the given Form.

+ Parameters
    + projectId: `7` (number, required) - The numeric ID of the Project

    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.

### Service Document [GET]

The Service Document is essentially the index of all available documents. From this document, you will find links to all other available information in this OData service. In particular, you will find the Metadata Document, as well as a data document for each table defined by the `Form`.

You will always find a link to the `/Submissions` subpath, which is the data document that represents the "root" table, the data from each `Submission` that is not nested within any `repeat`s.

This document is available only in JSON format.

+ Response 200 (application/json; charset=utf-8; odata.metadata=minimal)
    + Body

            {
                "@odata.context": "https://your.odk.server/v1/projects/7/forms/sample.svc/$metadata",
                "value": [
                    {
                        "kind": "EntitySet",
                        "name": "Submissions",
                        "url": "Submissions"
                    },
                    {
                        "kind": "EntitySet",
                        "name": "Submissions.children.child",
                        "url": "Submissions.children.child"
                    }
                ]
            }

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 406 (application/json)
    + Attributes (Error 406)

### Metadata Document [GET /v1/projects/{projectId}/forms/{xmlFormId}.svc/$metadata]

The Metadata Document describes, in [EDMX CSDL](http://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html), the schema of all the data you can retrieve from the OData Form Service in question (essentially, this is the XForms form schema translated into the OData format). EDMX/CSDL is very similar in concept to UML: there are objects, they have properties, and some of those properties are relationships to other objects.

If you are writing a tool to analyze your own data, whose schema you already know and understand, there is very little reason to touch this endpoint at all. You can likely skip ahead to the data documents themselves and work directly with the simple JSON output returned by those endpoints. This endpoint is more useful for authors of tools which seek to generically work with arbitrary data whose schemas they cannot know in advance.

In general, the way we model the XForms schema in OData terms is to represent `group`s as `ComplexType`s, and `repeat`s as `EntityType`s. In the world of OData, the primary difference between these two types is that Entity Types require Primary Keys, while Complex Types do not. This fits well with the way XForms surveys tend to be structured.

Most other types map to `String`. The exceptions are numbers, which map either to `Int64` or `Decimal` as appropriate, datetime fields which are always `DateTimeOffset`, date fields which become `Date`, and geography points which will appear as `GeographyPoint`, `GeographyLineString`, or `GeographyPolygon` given a `geopoint`, `geotrace`, or `geoshape`.

We also advertise the relationships between tables (the point at which a `repeat` connects the parent data to the repeated subtable) using the `NavigationProperty`. This should allow clients to present the data in an interconnected way, without the user having to specify how the tables connect to each other.

This implementation of the OData standard includes a set of Annotations describing the supported features of the service in the form of the [Capabilities Vocabulary](https://github.com/oasis-tcs/odata-vocabularies/blob/master/vocabularies/Org.OData.Capabilities.V1.md). In general, however, you can assume that the server supports the Minimal Conformance level and nothing beyond.

While the latest 4.01 OData specification adds a new JSON EDMX CSDL format, most servers and clients do not yet support that format, and so for this release of ODK Central only the older XML EDMX CSDL format is available.

+ Parameters
    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.

+ Response 200 (application/xml)
      + Body

              <?xml version="1.0" encoding="UTF-8"?>
              <edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
                <edmx:DataServices>
                  <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.simple">
                    <EntityType Name="Submissions">
                      <Key><PropertyRef Name="__id"/></Key>
                      <Property Name="__id" Type="Edm.String"/>
                      <Property Name="meta" Type="org.opendatakit.user.simple.meta"/>
                      <Property Name="name" Type="Edm.String"/>
                      <Property Name="age" Type="Edm.Int64"/>
                    </EntityType>
                    <ComplexType Name="meta">
                      <Property Name="instanceID" Type="Edm.String"/>
                    </ComplexType>
                    <EntityContainer Name="simple">
                      <EntitySet Name="Submissions" EntityType="org.opendatakit.user.simple.Submissions">
                        <Annotation Term="Org.OData.Capabilities.V1.ConformanceLevel" EnumMember="Org.OData.Capabilities.V1.ConformanceLevelType/Minimal"/>
                        <Annotation Term="Org.OData.Capabilities.V1.BatchSupported" Bool="false"/>
                        <Annotation Term="Org.OData.Capabilities.V1.CountRestrictions">
                          <Record><PropertyValue Property="Countable" Bool="true"/></Record>
                        </Annotation>
                        <Annotation Term="Org.OData.Capabilities.V1.FilterFunctions">
                          <Record>
                            <PropertyValue Property="NonCountableProperties">
                              <Collection>
                                <String>eq</String>
                              </Collection>
                            </PropertyValue>
                          </Record>
                        </Annotation>
                        <Annotation Term="Org.OData.Capabilities.V1.FilterFunctions">
                          <Record>
                            <PropertyValue Property="Filterable" Bool="true"/>
                            <PropertyValue Property="RequiresFilter" Bool="false"/>
                            <PropertyValue Property="NonFilterableProperties">
                              <Collection>
                                <PropertyPath>meta</PropertyPath>
                                <PropertyPath>name</PropertyPath>
                                <PropertyPath>age</PropertyPath>
                              </Collection>
                            </PropertyValue>
                          </Record>
                        </Annotation>
                        <Annotation Term="Org.OData.Capabilities.V1.SortRestrictions">
                          <Record><PropertyValue Property="Sortable" Bool="false"/></Record>
                        </Annotation>
                        <Annotation Term="Org.OData.Capabilities.V1.ExpandRestrictions">
                          <Record><PropertyValue Property="Expandable" Bool="false"/></Record>
                        </Annotation>
                      </EntitySet>
                    </EntityContainer>
                  </Schema>
                </edmx:DataServices>
              </edmx:Edmx>

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 406 (application/json)
    + Attributes (Error 406)

### Data Document [GET /v1/projects/{projectId}/forms/{xmlFormId}.svc/{table}{?%24skip,%24top,%24count,%24wkt,%24filter,%24expand,%24select}]

The data documents are the straightforward JSON representation of each table of `Submission` data. They follow the [corresponding specification](http://docs.oasis-open.org/odata/odata-json-format/v4.01/odata-json-format-v4.01.html), but apart from the representation of geospatial data as GeoJSON rather than the ODK proprietary format, the output here should not be at all surprising. If you are looking for JSON output of Submission data, this is the best place to look.

The `$top` and `$skip` querystring parameters, specified by OData, apply `limit` and `offset` operations to the data, respectively. The `$count` parameter, also an OData standard, will annotate the response data with the total row count, regardless of the scoping requested by `$top` and `$skip`. While paging is possible through these parameters, it will not greatly improve the performance of exporting data. ODK Central prefers to bulk-export all of its data at once if possible.

As of ODK Central v1.1, the [`$filter` querystring parameter](http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#_Toc31358948) is partially supported. In OData, you can use `$filter` to filter by any data field in the schema. The operators `lt`, `le`, `eq`, `ne`, `ge`, `gt`, `not`, `and`, and `or` are supported. The built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second` are supported. These supported elements may be combined in any way, but all other `$filter` features will cause an error.

The fields you can query against are as follows:

| Submission Metadata         | REST API Name | OData Field Name          |
| --------------------------- | ------------- | ------------------------- |
| Submitter Actor ID          | `submitterId` | `__system/submitterId`    |
| Submission Timestamp        | `createdAt`   | `__system/submissionDate` |
| Submission Update Timestamp | `updatedAt`   | `__system/updatedAt`      |
| Review State                | `reviewState` | `__system/reviewState`    |

Note that the `submissionDate` has a time component. This means that any comparisons you make need to account for the full time of the submission. It might seem like `$filter=__system/submissionDate le 2020-01-31` would return all results on or before 31 Jan 2020, but in fact only submissions made before midnight of that day would be accepted. To include all of the month of January, you need to filter by either `$filter=__system/submissionDate le 2020-01-31T23:59:59.999Z` or `$filter=__system/submissionDate lt 2020-02-01`. Remember also that you can [query by a specific timezone](https://en.wikipedia.org/wiki/ISO_8601#Time_offsets_from_UTC).

Please see the [OData documentation](http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#_Toc31358948) on `$filter` [operations](http://docs.oasis-open.org/odata/odata/v4.01/cs01/part1-protocol/odata-v4.01-cs01-part1-protocol.html#sec_BuiltinFilterOperations) and [functions](http://docs.oasis-open.org/odata/odata/v4.01/cs01/part1-protocol/odata-v4.01-cs01-part1-protocol.html#sec_BuiltinQueryFunctions) for more information.

As of ODK Central v1.2, you can use `%24expand=*` to expand all repeat repetitions. This is helpful if you'd rather get one nested JSON data payload of all hierarchical data, rather than retrieve each of repeat as a separate flat table with references.

The _nonstandard_ `$wkt` querystring parameter may be set to `true` to request that geospatial data is returned as a [Well-Known Text (WKT) string](https://en.wikipedia.org/wiki/Well-known_text) rather than a GeoJSON structure. This exists primarily to support Tableau, which cannot yet read GeoJSON, but you may find it useful as well depending on your mapping software. **Please note** that both GeoJSON and WKT follow a `(lon, lat, alt)` coördinate ordering rather than the ODK-proprietary `lat lon alt`. This is so that the values map neatly to `(x, y, z)`. GPS accuracy information is not a part of either standards specification, and so is presently omitted from OData output entirely. GeoJSON support may come in a future version.

As of ODK Central v2022.3, the [`$select` query parameter](http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#_Toc31358942) is supported with some limitations:
+ `$select` and `$expand` can't be used together.
+ Child properties of repeats can't be requested using `$select`
+ Requesting complex types (groups) to get all fields of that type is only supported for `__system`

As the vast majority of clients only support the JSON OData format, that is the only format ODK Central offers.

+ Parameters
    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.
    + `table`: `Submissions` (string, required) - The name of the table to be returned. These names can be found in the output of the [Service Document](/reference/odata-endpoints/odata-form-service/service-document).
    + `%24skip`: `10` (number, optional) - If supplied, the first `$skip` rows will be omitted from the results.
    + `%24top`: `5` (number, optional) - If supplied, only up to `$top` rows will be returned in the results.
    + `%24count`: `true` (boolean, optional) - If set to `true`, an `@odata.count` property will be added to the result indicating the total number of rows, ignoring the above paging parameters.
    + `%24wkt`: `true` (boolean, optional) - If set to `true`, geospatial data will be returned as Well-Known Text (WKT) strings rather than GeoJSON structures.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the query. Only [certain fields](/reference/odata-endpoints/odata-form-service/data-document) are available to reference. The operators `lt`, `le`, `eq`, `neq`, `ge`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.
    + `%24expand`: `*` (string, optional) - Repetitions, which should get expanded. Currently, only `*` is implemented, which expands all repetitions.
    + `%24select`: `__id, age, name, meta/instanceID` (string, optional) - If provided, will return only the selected fields.

+ Response 200 (application/json)
    + Body

            {
                "@odata.context": "https://your.odk.server/v1/projects/7/forms/simple.svc/$metadata#Submissions",
                "value": [
                    {
                        "__id": "uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44",
                        "age": 25,
                        "meta": {
                            "instanceID": "uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44"
                        },
                        "name": "Bob"
                    },
                    {
                        "__id": "uuid:297000fd-8eb2-4232-8863-d25f82521b87",
                        "age": 30,
                        "meta": {
                            "instanceID": "uuid:297000fd-8eb2-4232-8863-d25f82521b87"
                        },
                        "name": "Alice"
                    }
                ]
            }

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 406 (application/json)
    + Attributes (Error 406)

+ Response 501 (application/json)
    + Attributes (Error 501)

### Data Download Path [GET /#/dl/projects{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments/{filename}]

_(introduced: version 1.2)_

This route is a web browser oriented endpoint intended for user-interactive usage only. It's not part of the Central API, but is documented here as it can be useful.

If you are writing or configuring an OData client and have submission media files to deal with, you can run into authentication problems directly fetching or linking the media file URLs that are provided in the OData feed. This can be due to several reasons: if the user is not logged into the Central administration site (and thus has no valid cookie), if the request comes from a foreign origin (and thus cookies are not sent by the browser), and more.

To help manage this, the frontend provides a `/#/dl` path that allows file download. Just take a normal attachment download path and replace the `/v1` near the beginning of the path with `/#/dl`, and the user will be taken to a page managed by the Central administration website that will ensure the user is logged in, and offer the file as a download.

Because this `/#/dl` path returns a web page that causes a file download rather than directly returning the media file in question, it cannot be used to directly embed or retrieve these files, for example in a `<img>` tag.

+ Parameters
    + projectId: `7` (number, required) - The numeric ID of the Project
    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.
    + filename: `file1.jpg` (string, required) - The name of the file to be retrieved.

+ Response 200 (text/html)
    + Body

            (html markup data)

## Draft Testing [/v1/projects/{projectId}/forms/{xmlFormId}/draft.svc]

_(introduced: version 0.8)_

To facilitate testing, there is an alternative collection of OData endpoints that will give access to the submissions uploaded to a Draft Form. This can be useful for ensuring that changes to your form do not break downstream dashboards or applications.

They are all identical to the non-Draft OData endpoints, but they will only return the Draft Form schema and Submissions.

+ Parameters
    + projectId: `7` (number, required) - The numeric ID of the Project
    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.

### Service Document [GET]

Identical to [the non-Draft version](/reference/odata-endpoints/odata-form-service/service-document) of this endpoint.

+ Response 200 (application/json; charset=utf-8; odata.metadata=minimal)
    + Body

            {
                "@odata.context": "https://your.odk.server/v1/projects/7/forms/sample.svc/$metadata",
                "value": [
                    {
                        "kind": "EntitySet",
                        "name": "Submissions",
                        "url": "Submissions"
                    },
                    {
                        "kind": "EntitySet",
                        "name": "Submissions.children.child",
                        "url": "Submissions.children.child"
                    }
                ]
            }

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 406 (application/json)
    + Attributes (Error 406)

### Metadata Document [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft.svc/$metadata]

Identical to [the non-Draft version](/reference/odata-endpoints/odata-form-service/metadata-document) of this endpoint.

+ Parameters
    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.

+ Response 200 (application/xml)
      + Body

              <?xml version="1.0" encoding="UTF-8"?>
              <edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
                <edmx:DataServices>
                  <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="org.opendatakit.user.simple">
                    <EntityType Name="Submissions">
                      <Key><PropertyRef Name="__id"/></Key>
                      <Property Name="__id" Type="Edm.String"/>
                      <Property Name="meta" Type="org.opendatakit.user.simple.meta"/>
                      <Property Name="name" Type="Edm.String"/>
                      <Property Name="age" Type="Edm.Int64"/>
                    </EntityType>
                    <ComplexType Name="meta">
                      <Property Name="instanceID" Type="Edm.String"/>
                    </ComplexType>
                    <EntityContainer Name="simple">
                      <EntitySet Name="Submissions" EntityType="org.opendatakit.user.simple.Submissions">
                        <Annotation Term="Org.OData.Capabilities.V1.ConformanceLevel" EnumMember="Org.OData.Capabilities.V1.ConformanceLevelType/Minimal"/>
                        <Annotation Term="Org.OData.Capabilities.V1.BatchSupported" Bool="false"/>
                        <Annotation Term="Org.OData.Capabilities.V1.CountRestrictions">
                          <Record><PropertyValue Property="Countable" Bool="true"/></Record>
                        </Annotation>
                        <Annotation Term="Org.OData.Capabilities.V1.FilterFunctions">
                          <Record>
                            <PropertyValue Property="NonCountableProperties">
                              <Collection>
                                <String>eq</String>
                              </Collection>
                            </PropertyValue>
                          </Record>
                        </Annotation>
                        <Annotation Term="Org.OData.Capabilities.V1.FilterFunctions">
                          <Record>
                            <PropertyValue Property="Filterable" Bool="true"/>
                            <PropertyValue Property="RequiresFilter" Bool="false"/>
                            <PropertyValue Property="NonFilterableProperties">
                              <Collection>
                                <PropertyPath>meta</PropertyPath>
                                <PropertyPath>name</PropertyPath>
                                <PropertyPath>age</PropertyPath>
                              </Collection>
                            </PropertyValue>
                          </Record>
                        </Annotation>
                        <Annotation Term="Org.OData.Capabilities.V1.SortRestrictions">
                          <Record><PropertyValue Property="Sortable" Bool="false"/></Record>
                        </Annotation>
                        <Annotation Term="Org.OData.Capabilities.V1.ExpandRestrictions">
                          <Record><PropertyValue Property="Expandable" Bool="false"/></Record>
                        </Annotation>
                      </EntitySet>
                    </EntityContainer>
                  </Schema>
                </edmx:DataServices>
              </edmx:Edmx>

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 406 (application/json)
    + Attributes (Error 406)

### Data Document [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft.svc/{table}{?%24skip,%24top,%24count,%24wkt,%24filter,%24expand,%24select}]

Identical to [the non-Draft version](/reference/odata-endpoints/odata-form-service/data-document) of this endpoint.

+ Parameters
    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.
    + `table`: `Submissions` (string, required) - The name of the table to be returned. These names can be found in the output of the [Service Document](/reference/odata-endpoints/odata-form-service/service-document).
    + `%24skip`: `10` (number, optional) - If supplied, the first `$skip` rows will be omitted from the results.
    + `%24top`: `5` (number, optional) - If supplied, only up to `$top` rows will be returned in the results.
    + `%24count`: `true` (boolean, optional) - If set to `true`, an `@odata.count` property will be added to the result indicating the total number of rows, ignoring the above paging parameters.
    + `%24wkt`: `true` (boolean, optional) - If set to `true`, geospatial data will be returned as Well-Known Text (WKT) strings rather than GeoJSON structures.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the query. Only [certain fields](/reference/odata-endpoints/odata-form-service/data-document) are available to reference. The operators `lt`, `le`, `eq`, `neq`, `ge`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.
    + `%24expand`: `*` (string, optional) - Repetitions, which should get expanded. Currently, only `*` is implemented, which expands all repetitions.
    + `%24select`: `__id, age, name, meta/instanceID` (string, optional) - If provided, will return only the selected fields.

+ Response 200 (application/json)
    + Body

            {
                "@odata.context": "https://your.odk.server/v1/projects/7/forms/simple.svc/$metadata#Submissions",
                "value": [
                    {
                        "__id": "uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44",
                        "age": 25,
                        "meta": {
                            "instanceID": "uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44"
                        },
                        "name": "Bob"
                    },
                    {
                        "__id": "uuid:297000fd-8eb2-4232-8863-d25f82521b87",
                        "age": 30,
                        "meta": {
                            "instanceID": "uuid:297000fd-8eb2-4232-8863-d25f82521b87"
                        },
                        "name": "Alice"
                    }
                ]
            }

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 406 (application/json)
    + Attributes (Error 406)

+ Response 501 (application/json)
    + Attributes (Error 501)

# Group System Endpoints

There are some resources available for getting or setting system information and configuration. You can [set the Usage Reporting configuration](/reference/system-endpoints/usage-reporting-configuration) for the server, or you can [retrieve the Server Audit Logs](/reference/system-endpoints/server-audit-logs). If backups were configured using an earlier version of ODK Central, you can also [get the current configuration](/reference/system-endpoints/backups-configuration) or terminate it.

## Backups Configuration [/v1/config/backups]

Earlier versions of ODK Central allowed users to configure backups to Google Drive, but it is no longer possible to do so. If backups were configured using an earlier version of ODK Central, you can get the current configuration or terminate it. On January 31, 2023, backups to Google Drive will stop working entirely, and we will remove the endpoints to get the current configuration or terminate it. Although backups to Google Drive will stop working, it will still be possible to download a [Direct Backup](/reference/system-endpoints/direct-backup). For more information about these changes, please see [this topic](https://forum.getodk.org/t/backups-to-google-drive-from-central-will-stop-working-after-jan-31st/38895) in the ODK Forum.

The backups configuration is essentially a singleton object: there can be only one backups configuration at a time.

### Getting the current configuration [GET]

If configured, this endpoint will return the present backups configuration type. For security reasons, none of the actual internal authentication and encryption information is returned.

If no backups are configured, this endpoint will return a `404`.

+ Response 200 (application/json)
    + Body

            {
                "type": "google",
                "setAt": "2018-01-06T00:32:52.787Z"
            }

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 404 (application/json)
    + Attributes (Error 404)

### Terminating the current configuration [DELETE]

Deleting the backups configuration will permanently remove it, stopping it from running as scheduled.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Direct Backup [/v1/backup]

_(introduced: version 1.1)_

ODK Central offers HTTP endpoints that will immediately perform a backup on the system database and send that encrypted backup as the response. You can `POST` with an encryption passphrase. If backups to Google Drive were [configured](/reference/system-endpoints/backups-configuration) using an earlier version of ODK Central, you can also `GET` to use the passphrase you configured then.

Note that performing the backup takes a great deal of time, during which the request will be held open. Both of these endpoints trickle junk data every five seconds while that processing is occurring to prevent the request from timing out. Depending on how much data you have, it can take many minutes for the data stream to speed up to a full transfer rate.

### Using an Ad-Hoc Passphrase [POST]

A `POST` verb will start an direct download ad-hoc backup. You will want to supply a `passphrase` with your chosen encryption passphrase. It is possible to omit this, in which case the backup will still be encrypted, but it will decrypt given an empty passphrase.

Please see the section notes above about the long-running nature of this endpoint.

+ Request (application/json)
    + Attributes
        + passphrase: `my-password` (string, optional) - The passphrase with which to encrypt the backup.

+ Response 200
    + Headers

            Content-Disposition: attachment; filename=central-backup-2020-01-01T00:00:00.000Z.zip

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Using the Configured Scheduled Backups Passphrase [GET]

A `GET` verb will start an direct download backup, but using the configured scheduled backups passphrase. If no scheduled backup has been configured, the endpoint will return not found.

Please see the section notes above about the long-running nature of this endpoint.

+ Response 200
    + Headers

            Content-Disposition: attachment; filename=central-backup-2020-01-01T00:00:00.000Z.zip

    + Body

            (binary data)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Usage Reporting Configuration [/v1/config/analytics]

_(introduced: version 1.3)_

### Setting a new configuration [POST]

An Administrator can use this endpoint to choose whether the server will share anonymous usage data with the Central team. This configuration affects the entire server. Until the Usage Reporting configuration is set, Administrators will see a message on the Central administration website that provides further information.

If an Administrator specifies `true` for `enabled`, the server will share anonymous usage data monthly with the Central team. By specifying `true`, the Administrator accepts the [Terms of Service](https://getodk.org/legal/tos.html) and [Privacy Policy](https://getodk.org/legal/privacy.html). The Administrator can also share contact information to include with the report.

If an Administrator specifies `false` for `enabled`, the server will not share anonymous usage data with the Central team. Administrators will no longer see the message on the administration website.

If the Usage Reporting configuration is already set, the current configuration will be overwritten with the new one.

+ Request (application/json)
    + Attributes
        + enabled: `true` (boolean, required) - See above.
        + email: `my.email.address@getodk.org` (string, optional) - A work email address to include with the metrics report.
        + organization: `Organization Name` (string, optional) - An organization name to include with the metrics report.

+ Response 200 (application/json)
    + Attributes (Usage Reporting Config)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting the current configuration [GET]

If the Usage Reporting configuration is not set, this endpoint will return a `404`. Once the configuration is set, this endpoint will indicate whether the server will share usage data with the Central team. If the server will share usage data, and contact information was provided, this endpoint will also return the provided work email address and organization name.

+ Response 200 (application/json)
    + Attributes (Usage Reporting Config)

+ Response 403 (application/json)
    + Attributes (Error 403)

+ Response 404 (application/json)
    + Attributes (Error 404)

### Unsetting the current configuration [DELETE]

If the Usage Reporting configuration is unset, Administrators will once again see a message on the the Central administration website.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Usage Report Preview [/v1/analytics/preview]

_(introduced: version 1.3)_

An Administrator of Central may opt in to sending periodic reports summarizing usage. Configuration of this reporting is described [here](/reference/system-endpoints/usage-reporting-configuration). For added transparency, the API provides a preview of the reported metrics.

### Getting the Usage Report preview [GET]

An Administrator can use this endpoint to preview the metrics being sent. The preview is computed on the fly and represents what the report would look like if sent at that time. This endpoint does not directly submit the Usage Report; that is handled internally as a scheduled Central task.

+ Response 200 (application/json)
    + Body

            {
              "system":{
                "num_admins":{
                  "recent":1,
                  "total":1
                },
                "backups_configured":1,
                "database_size":12345,
                ...
              },
              "projects":[
                {
                  "id":1,
                  "users":{ ... },
                  "forms":{ ... },
                  "submissions":{ ... }
                },
                ...
              ]
            }

+ Response 403 (application/json)
    + Attributes (Error 403)


## Server Audit Logs [/v1/audits]

_(introduced: version 0.6)_

Many actions on ODK Central will automatically log an event to the Server Audit Log. Creating a new Form, for instance, will log a `form.create` event, with information about the Actor who performed the action, and sometimes some additional details specific to the event.

Any time an audit action is logged, the request headers are checked. If `X-Action-Notes` are provided anywhere, those notes will be logged into the audit entries as well. Note that some requests generate multiple audit entries; in these cases, the `note` will be attached to every entry logged.

Server Audit Logs entries are created for the following `action`s:

* `user.create` when a new User is created.
* `user.update` when User information is updated, like email or password.
* `user.assignment.create` when a User is assigned to a Server Role.
* `user.assignment.delete` when a User is unassigned from a Server Role.
* `user.session.create` when a User logs in.
* `user.delete` when a User is deleted.
* `project.create` when a new Project is created.
* `project.update` when top-level Project information is updated, like its name.
* `project.delete` when a Project is deleted.
* `form.create` when a new Form is created.
* `form.update` when top-level Form information is updated, like its name or state.
* `form.update.draft.set` when a Draft Form definition is set.
* `form.update.draft.delete` when a Draft Form definition is deleted.
* `form.update.publish` when a Draft Form is published to the Form.
* `form.attachment.update` when a Form Attachment binary is set or cleared.
* `form.submissions.export` when a Form's Submissions are exported to CSV.
* `form.delete` when a Form is deleted.
* `form.restore` when a Form that was deleted is restored.
* `form.purge` when a Form is permanently purged.
* `field_key.create` when a new App User is created.
* `field_key.assignment.create` when an App User is assigned to a Server Role.
* `field_key.assignment.delete` when an App User is unassigned from a Server Role.
* `field_key.session.end` when an App User's access is revoked.
* `field_key.delete` when an App User is deleted.
* `public_link.create` when a new Public Link is created.
* `public_link.assignment.create` when a Public Link is assigned to a Server Role.
* `public_link.assignment.delete` when a Public Link is unassigned from a Server Role.
* `public_link.session.end` when a Public Link's access is revoked.
* `public_link.delete` when a Public Link is deleted.
* `submission.create` when a new Submission is created.
* `submission.update` when a Submission's metadata is updated.
* `submission.update.version` when a Submission XML data is updated.
* `submission.attachment.update` when a Submission Attachment binary is set or cleared, but _only via the REST API_. Attachments created alongside the submission over the OpenRosa `/submission` API (including submissions from Collect) do not generate audit log entries.
* `dataset.create` when a Dataset is created.
* `dataset.update` when a Dataset is updated.
* `dataset.update.publish` when a Dataset is published.
* `entity.create` when an Entity is created.
* `entity.create.error` when there is an error during entity creation process.
* `config.set` when a system configuration is set.
* `backup` when a backup operation is attempted.
* `analytics` when a Usage Report is attempted.

### Getting Audit Log Entries [GET /v1/audits{?action,start,end,limit,offset}]

This resource allows access to those log entries, with some paging and filtering options. These are provided by querystring parameters: `action` allows filtering by the action types listed above, `start` and `end` allow filtering by log timestamp (see below), and `limit` and `offset` control paging. If no paging parameters are given, the server will attempt to return every audit log entry that it has.

The `start` and `end` parameters work based on exact timestamps, given in [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) format. It is possible to provide just a datestring (eg `2000-01-01`), in which case midnight will be inferred. But this value alone leaves the timezone unspecified. When no timezone is given, the server's local time will be used: the standard [Docker deployment](https://docs.getodk.org/central-install/) will always set server local time to UTC, but installations may have been customized, and there is no guarantee the UTC default hasn't been overridden.

For this reason, **we recommend always setting a timezone** when querying based on `start` and `end`: either by appending a `z` to indicate UTC (eg `2000-01-01z`) or by explicitly specifying a timezone per ISO 8601 (eg `2000-01-01+08`). The same applies for full timestamps (eg `2000-01-01T12:12:12z`, `2000-01-01T12:12:12+08`).

`start` may be given without `end`, and vice versa, in which case the timestamp filter will only be bounded on the specified side. They are both inclusive (`>=` and `<=`, respectively).

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally expand the `actorId` into full `actor` details, and `acteeId` into full `actee` details. The `actor` will always be an Actor, but the `actee` may be an Actor, a Project, a Form, or some other type of object depending on the type of action.

+ Parameters
    + `action`: `form.create` (string, optional) - The name of the `action` to filter by.
    + `start`: `2000-01-01z` (string, optional) - The timestamp before which log entries are to be filtered out.
    + `end`: `2000-12-31T23:59.999z` (string, optional) - The timestamp after which log entries are to be filtered out.
    + `limit`: `100` (number, optional) - The maximum number of entries to return.
    + `offset`: `200` (number, optional) - The zero-indexed number of entries to skip from the result.

+ Response 200 (application/json)
    + Attributes (array[Audit])

+ Response 200 (application/json; extended)
    + Attributes (array[Extended Audit])

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group Encryption

ODK Central supports two types of encryption:

1. The [old methodology](https://docs.getodk.org/encrypted-forms/), where you generate an RSA keypair and use it with locally-downloaded encrypted data to decrypt submissions. We refer to these sorts of keys in this documentation as "self-supplied keys."
2. Managed Encryption, where Central will generate and store an RSA keypair for you, secured under a passphrase that Central does not save. The CSV export path can then decrypt all records on the fly given the passphrase.

Given the self-supplied key case, Central does not understand how to decrypt records, and the CSV export will export only metadata fields (and no binary attachments) for encrypted records. You may retrieve each data resource over the REST API and decrypt them yourself, or use ODK Briefcase to do this.

Managed Encryption is recommended for most people. The data is still encrypted "at rest" on the server, and the private key needed to decrypt the data is itself encrypted by the passphrase. Neither the passphrase nor the decrypted private key are ever stored; they are forgotten as soon as the server has finished the work at hand.

The relevant API operations are documented inline above; here we guide you through what exists from a high level.

To invoke Project Manage Encryption, you may use the web management interface, or [you may `POST /projects/…/key`](/reference/project-management/projects/enabling-project-managed-encryption).

To list all the encryption keys associated with the submissions on a given form, [you can `GET /projects/…/forms/…/submissions/keys`](/reference/submissions/submissions/listing-encryption-keys). This is particularly useful for obtaining the integer numeric ID associated with each key, which will be necessary to decrypt the records, as well as for obtaining reminder hints about each passphrase.

To perform decryption, [you can `GET` or `POST /projects/…/forms/…/submissions.csv.zip`](/reference/submissions/submissions/exporting-form-submissions-to-csv) with extra parameters to provide the necessary passphrases. If you are building a browser-based application, it is recommended that you `POST` rather than `GET`: please see the notes in the linked sections for additional details.

Note that the OData JSON API does not (presently) decrypt data. Any encrypted submissions will be returned only with basic metadata, like submission date and user.

# Data Structures

These are in alphabetic order, with the exception that the `Extended` versions of each structure, where applicable, is listed immediately following the standard version.

## Actor (object)
+ createdAt: `2018-04-18T23:19:14.802Z` (string, required) - ISO date format
+ displayName: `My Display Name` (string, required) - All `Actor`s, regardless of type, have a display name
+ id: `115` (number, required)
+ type: (Actor Type, required) - the Type of this Actor; typically this will be `user`.
+ updatedAt: `2018-04-18T23:42:11.406Z` (string, optional) - ISO date format
+ deletedAt: `2018-04-18T23:42:11.406Z` (string, optional) - ISO date format

## Actor Type (enum)
+ user (string) - A User with an email and login password.
+ field_key (string) - An App User which can submit data to a Form. ("Field Key" is a legacy internal name for "App User".)
+ public_link (string) - A Public Access Link that grants anonymous browser-based access to submit to a Form.
+ singleUse (string) - A temporary token authorized to perform some specific action, like reset one password.

## Assignment (object)
+ actorId: `42` (number, required) - The numeric Actor ID being assigned.
+ roleId: `4` (number, required) - The numeric Role ID being assigned.

## Extended Assignment (object)
+ actor: (Actor, required) - The full Actor data for this assignment.
+ roleId: `4` (number, required) - The numeric Role ID being assigned.

## Form Summary Assignment (object)
+ actorId: `42` (number, required) - The numeric Actor ID being assigned.
+ xmlFormId: `simple` (string, required) - The `id` of the assigned form as given in its XForms XML definition
+ roleId: `4` (number, required) - The numeric Role ID being assigned.

## Extended Form Summary Assignment (object)
+ actor: (Actor, required) - The full Actor data for this assignment.
+ xmlFormId: `simple` (string, required) - The `id` of the assigned form as given in its XForms XML definition
+ roleId: `4` (number, required) - The numeric Role ID being assigned.

## App User (Actor)
+ token: `d1!E2GVHgpr4h9bpxxtqUJ7EVJ1Q$Dusm2RBXg8XyVJMCBCbvyE8cGacxUx3bcUT` (string, optional) - If present, this is the Token that can be used to authenticate a request as this `App User`. If not present, this `App User`'s access has been revoked.
+ projectId: `1` (number, required) - The ID of the `Project` that this `App User` is bound to.

## Audit (object)
+ actorId: `42` (number, optional) - The ID of the actor, if any, that initiated the action.
+ action: `form.create` (string, required) - The action that was taken.
+ acteeId: `85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, optional) - The ID of the permissioning object against which the action was taken.
+ details: (object, optional) - Additional details about the action that vary according to the type of action.
+ loggedAt: `2018-04-18T23:19:14.802Z` (string, required) - ISO date format

## Extended Audit (Audit)
+ actor: (Actor, optional) - The details of the actor given by `actorId`.
+ actee: (object, optional) - The details of the actee given by `acteeId`. Depending on the action type, this could be a number of object types, including an `Actor`, a `Project`, or a `Form`.

## Comment (object)
+ body: `this is my comment` (string, required) - The text of the comment.
+ actorId: `42` (number, required) - The ID of the Actor that made the comment.

## Extended Comment (Comment)
+ actor: (Actor, optional) - The details of the actor given by `actorId`.

## Error 400 (object)
+ code: `400` (string, required)
+ details (object, optional) - a subobject that contains programmatically readable details about this error
+ message: `Could not parse the given data (2 chars) as json.` (string)

## Error 401 (object)
+ code: `401.2` (string, required)
+ message: `Could not authenticate with the provided credentials.` (string)

## Error 403 (object)
+ code: `403.1` (string, required)
+ message: `The authenticated actor does not have rights to perform that action.` (string)

## Error 404 (object)
+ code: `404.1` (string, required)
+ message: `Could not find the resource you were looking for.` (string)

## Error 406 (object)
+ code: `406.1` (string, required)
+ message: `Requested format not acceptable; this resource allows: (application/json, json).` (string)

## Error 409 (object)
+ code: `409.1` (string, required)
+ message: `A resource already exists with id value(s) of 1.` (string)

## Error 501 (object)
+ code: `501.1` (string, required)
+ message: `The requested feature $unsupported is not supported by this server.` (string)

## Config (object)
+ key: `some_type` (string, required) - The type of system configuration.
+ setAt: `2018-01-06T00:32:52.787Z` (string, required) - ISO date format. The last time this system configuration was set.

## Usage Reporting Config Value (object)
+ enabled: `true` (boolean, required) - `true` if the server will share usage data with the Central team and `false` if not.
+ email: `my.email.address@getodk.org` (string, optional) - The work email address to include with the metrics report.
+ organization: `Organization Name` (string, optional) - The organization name to include with the metrics report.

## Usage Reporting Config (Config)
+ value: (Usage Reporting Config Value, required) - Details about the Usage Reporting configuration.

## Form (object)
+ projectId: `1` (number, required) - The `id` of the project this form belongs to.
+ xmlFormId: `simple` (string, required) - The `id` of this form as given in its XForms XML definition
+ name: `Simple` (string, optional) - The friendly name of this form. It is given by the `<title>` in the XForms XML definition.
+ version: `2.1` (string, required) - The `version` of this form as given in its XForms XML definition. If no `version` was specified in the Form, a blank string will be given.
+ enketoId: `abcdef` (string, optional) - If it exists, this is the survey ID of this Form on Enketo at `/-`. This will be the ID of the published version if it exists, otherwise it will be the draft ID. Only a cookie-authenticated user may access the preview through Enketo.
+ hash: `51a93eab3a1974dbffc4c7913fa5a16a` (string, required) - An MD5 sum automatically computed based on the XForms XML definition. This is required for OpenRosa compliance.
+ keyId: `3` (number, optional) - If a public encryption key is present on the form, its numeric ID as tracked by Central is given here.
+ state (Form State, required) - The present lifecycle status of this form. Controls whether it is available for download on survey clients or accepts new submissions.
+ publishedAt: `2018-01-21T00:04:11.153Z` (string, optional) - Indicates when a draft has most recently been published for this Form. If this value is `null`, this Form has never been published yet, and contains only a draft.
+ createdAt: `2018-01-19T23:58:03.395Z` (string, required) - ISO date format
+ updatedAt: `2018-03-21T12:45:02.312Z` (string, optional) - ISO date format

## Deleted Form (Form)
+ deletedAt: `2018-03-21T12:45:02.312Z` (string, required) - ISO date format
+ id: `42` (number, required) - Numeric ID that distinguishes the Form from other Forms in the Project with the same xmlFormId. This ID can be used to restore the Form.

## Extended Form (Form)
+ submissions: `10` (number, required) - The number of `Submission`s that have been submitted to this `Form`.
+ reviewStates: (Review State Counts, required) - Additional counts of the number of submissions in various states of review.
+ lastSubmission: `2018-04-18T03:04:51.695Z` (string, optional) - ISO date format. The timestamp of the most recent submission, if any.
+ createdBy: (Actor, optional) - The full information of the Actor who created this Form.
+ excelContentType: (string, optional) - If the Form was created by uploading an Excel file, this field contains the MIME type of that file.
+ entityRelated: `false` (boolean, required) - True only if this Form is related to a Dataset. In v2022.3, this means the Form's Submissions create Entities in a Dataset. In a future version, Submissions will also be able to update existing Entities.

## Extended Deleted Form (Extended Form)
+ deletedAt: `2018-03-21T12:45:02.312Z` (string, required) - ISO date format
+ id: `42` (number, required) - Numeric ID as it is represented in the database.

## Draft Form (Form)
+ draftToken: `lSpAIeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QPEjR7` (string, required) - The test token to use to submit to this draft form. See [Draft Testing Endpoints](/reference/submissions/draft-submissions).
+ enketoId: `abcdef` (string, optional) - If it exists, this is the survey ID of this draft Form on Enketo at `/-`. Authentication is not needed to access the draft form through Enketo.

## Extended Form Version (Form)
+ publishedBy: (Actor, optional) - The full information of the Actor who published this version of the Form.
+ excelContentType: (string, optional) - If the Form was created by uploading an Excel file, this field contains the MIME type of that file.

## Form Attachment (object)
+ name: `myfile.mp3` (string, required) - The name of the file as specified in the XForm.
+ type: (Form Attachment Type, required) - The expected type of file as specified in the XForm.
+ exists: `true` (boolean, required) - True if the server has the file or the Attachment is linked to a Dataset, otherwise false.
+ blobExists: `true` (boolean, required) - Whether the server has the file or not.
+ datasetExists: `true` (boolean, required) - Whether attachment is linked to a Dataset.
+ updatedAt: `2018-03-21T12:45:02.312Z` (string, optional) - ISO date format. The last time this file's binary content was set (POST) or cleared (DELETE).

## Form Attachment Type (enum)
+ image (string) - An image (jpg, etc) file is expected.
+ audio (string) - An audio (mp3, etc) file is expected.
+ video (string) - A video (mp4, etc) file is expected.
+ file (string) - A data file of some kind (usually csv) is expected.

## Form State (enum)
+ open (string) - _(Default)_ This form is available for download and accepts submissions.
+ closing (string) - This form is _not_ available for download but still accepts submissions. This state will remove the form from the [OpenRosa FormList](/reference/openrosa-endpoints/openrosa-form-listing-api) that mobile clients use to determine which forms are available to download. The `closing` state does not affect the REST API at all: a `closing` form will still be available over all REST APIs.
+ closed (string) - This form is _not_ available for download, and it does _not_ accept submissions. This state is the same as the `closing` state, but additionally new submissions will not be accepted over either the [OpenRosa](/reference/openrosa-endpoints/openrosa-form-submission-api) or the [REST](/reference/forms-and-submissions/submissions/creating-a-submission) submission creation APIs.

## Extended App User (App User)
+ createdBy (Actor, required) - The full details about the `Actor` that created this `App User`.
+ lastUsed: `2018-04-14T08:34:21.633Z` (string, optional) - ISO date format. The last time this `App User` was used to authenticate a request.

## Project (object)
+ id: `1` (number) - The numerical ID of the Project.
+ name: `Default Project` (string, required) - The name of the Project.
+ description: `Description of this Project to show on Central.` (string, optional) - The description of the Project, which is rendered as Markdown on Frontend.
+ keyId: `3` (number, optional) - If managed encryption is enabled on the project, the numeric ID of the encryption key as tracked by Central is given here.
+ archived: false (boolean, optional) - Whether the Project is archived or not. `null` is equivalent to `false`. All this does is sort the Project to the bottom of the list and disable management features in the web management application.

## Extended Project (Project)
+ appUsers: `4` (number, required) - The number of App Users created within this Project.
+ forms: `7` (number, required) - The number of forms within this Project.
+ lastSubmission: `2018-04-18T03:04:51.695Z` (string, optional) - ISO date format. The timestamp of the most recent submission to any form in this project, if any.
+ datasets: `2` (number, required) - The number of Datasets within this Project.

## Project With Forms (Project)
+ formList: (array[Extended Form], required) - The extended Forms associated with this Project that are visible to the authenticated Actor.

## Public Link (Actor)
+ token: `d1!E2GVHgpr4h9bpxxtqUJ7EVJ1Q$Dusm2RBXg8XyVJMCBCbvyE8cGacxUx3bcUT` (string, optional) - If present, this is the Token to include as the `st` query parameter for this `Public Link`. If not present, this `Public Link` has been revoked.
+ once: `false` (boolean, optional) - If set to `true`, an Enketo [single submission survey](https://blog.enketo.org/single-submission-surveys/) will be created instead of a standard one, limiting respondents to a single submission each.

## Extended Public Link (Public Link)
+ createdBy (Actor, required) - The full details about the `Actor` that created this `Public Link`.

## Key (object)
+ id: `1` (number, required) - The numerical ID of the Key.
+ public: `bcFeKDF3Sg8W91Uf5uxaIlM2uK0cUN9tBSGoASbC4LeIPqx65+6zmjbgUnIyiLzIjrx4CAaf9Y9LG7TAu6wKPqfbH6ZAkJTFSfjLNovbKhpOQcmO5VZGGay6yvXrX1TFW6C6RLITy74erxfUAStdtpP4nraCYqQYqn5zD4/1OmgweJt5vzGXW2ch7lrROEQhXB9lK+bjEeWx8TFW/+6ha/oRLnl6a2RBRL6mhwy3PoByNTKndB2MP4TygCJ/Ini4ivk74iSqVnoeuNJR/xUcU+kaIpZEIjxpAS2VECJU9fZvS5Gt84e5wl/t7bUKu+dlh/cUgHfk6+6bwzqGQYOe5A==` (string, required) - The base64-encoded public key, with PEM envelope removed.
+ managed: `true` (boolean, optional) - If true, this is a key generated by Project managed encryption. If not, this key is self-supplied.
+ hint: `it was a secret` (string, optional) - The hint, if given, related to a managed encryption key.

## User (Actor)
+ email: `my.email.address@getodk.org` (string, required) - Only `User`s have email addresses associated with them

## Role (object)
+ id: `4` (number, required) - The numerical ID of the Role.
+ name: `Project Manager` (string, required) - The human-readable name for the Role.
+ system: `manager` (string, optional) - The system name of the Role. Roles that have system names may not be modified.
+ verbs: `project.update`, `project.delete` (array[string], required) - The array of string verbs this Role confers.
+ createdAt: `2018-01-19T23:58:03.395Z` (string, required) - ISO date format
+ updatedAt: `2018-03-21T12:45:02.312Z` (string, optional) - ISO date format

## Session (object)
+ createdAt: `2018-04-18T03:04:51.695Z` (string, required) - ISO date format
+ expiresAt: `2018-04-19T03:04:51.695Z` (string, required) - ISO date format
+ token: `lSpAIeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QPEjR7` (string, required) - The bearer token associated with the session. It consists only of URL-safe characters, so it should never need any escaping.

## Submission (object)
+ instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the `Submission`, given by the Submission XML.
+ instanceName: `village third house` (string, optional) - The `instanceName`, if any, given by the Submission XML in the metadata section.
+ submitterId: `23` (number, required) - The ID of the `Actor` (`App User`, `User`, or `Public Link`) that submitted this `Submission`.
+ deviceId: `imei:123456` (string, optional) - The self-identified `deviceId` of the device that collected the data, sent by it upon submission to the server. On overall ("logical") submission requests, the initial submission `deviceId` will be returned here. For specific version listings of a submission, the value associated with the submission of that particular version will be given.
+ userAgent: `Enketo/3.0.4` (string, optional) - The self-identified `userAgent` of the device that collected the data, sent by it upon submission to the server.
+ reviewState: `approved` (Submission Review State, optional) - The current review state of the submission.
+ createdAt: `2018-01-19T23:58:03.395Z` (string, required) - ISO date format. The time that the server received the Submission.
+ updatedAt: `2018-03-21T12:45:02.312Z` (string, optional) - ISO date format. `null` when the Submission is first created, then updated when the Submission's XML data or metadata is updated.

## Extended Submission (Submission)
+ submitter (Actor, required) - The full details of the `Actor` that submitted this `Submission`.
+ formVersion: `1.0` (string, optional) - The version of the form the submission was initially created against. Only returned with specific Submission Version requests.

## Review State Counts (object)
+ received: `3` (number, required) - The number of submissions receieved with no other review state.
+ hasIssues: `2` (number, required) - The number of submissions marked as having issues.
+ edited: `1` (number, required) - The number of edited submissions.

## Submission Attachment (object)
+ name: `myfile.mp3` (string, required) - The name of the file as specified in the Submission XML.
+ exists: `true` (boolean, required) - Whether the server has the file or not.

## Submission Review State (enum)
+ null (string, nullable) - The submission has been received by the server. No specific review state has been set. This is called "received" in the administration panel.
+ edited (string) - An edited copy of this submission has been received by the server. No specific review state has been set since.
+ hasIssues (string) - Somebody has flagged that this submission has potential problems that need to be addressed.
+ rejected (string) - Somebody has flagged that this submission should be ignored.
+ approved (string) - Somebody has approved this submission.

## Submission Diff Value (object)
+ new (string, nullable) - The new value of this node, which can either be a simple string, or JSON string representing a larger structural change to the Submission XML. It can also be null if this field no longer exists in the Submission.
+ old (string, nullable) - The old value of this node, with similar properties to `new`. It can be null if this field did not exist previously.
+ path (array) - An array representing the path (XPath) in the Submission tree for this node. It does not include the outermost path `data`. For elements that are part of repeat groups, the path element is the node name and the index (starting at 0), e.g. ['child', 2] is the third child.

## Success (object)
+ success: `true` (boolean, required)

## Dataset (object)
+ name: `people` (string, required) - The name of the Dataset
+ createdAt: `2018-01-19T23:58:03.395Z` (string, required) - ISO date format.
+ projectId: `1` (number, required) - The numerical ID of the Project that the Dataset belongs to.

## Patch Attachment (object)
+ dataset: `true` (boolean, required) - true for linking Dataset and false for unlinking Dataset.

## Dataset Diff (object)
+ name: `people` (string, required) - The name of the Dataset.
+ properties: (array[Property]) - All properties of the Dataset.

## Draft Dataset Diff (object)
+ name: `people` (string, required) - The name of the Dataset.
+ isNew: `true` (boolean, required) - Whether or not this Dataset is new (will be created by publishing the Draft Form).
+ properties: (array[Draft Property]) - All properties of the Dataset.

## Property (object)
+ name: `first_name` (string, required) - The name of the Property.
+ inForm: `true` (boolean, required) - Whether or not this Property is affected by the Form.

## Draft Property (object)
+ name: `first_name` (string, required) - The name of the Property.
+ inForm: `true` (boolean, required) - Whether or not this Property is affected by the form.
+ isNew: `true` (boolean, required) - Whether or not this Property is new (will be created by publishing the Draft Form).

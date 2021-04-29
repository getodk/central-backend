FORMAT: 1A

# ODK Central API
[ODK Central Backend](https://github.com/opendatakit/central-backend) is a RESTful API server that provides key functionality for creating and managing Open Data Kit data collection campaigns. It couples with [Central Frontend](https://github.com/opendatakit/central-frontend), an independent frontend interface, to form [ODK Central](https://github.com/opendatakit/central), a complete user-installable ODK server solution. While Central Frontend is the primary consumer of the ODK Central API, the API this server provides is fully public and generic: anything that can be done in the user interface can be done directly via the API.

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

* The [OpenRosa](https://docs.opendatakit.org/openrosa/) standard allows standard integration with tools like the [ODK Collect](https://docs.opendatakit.org/collect-intro/) mobile data collection app, or various other compatible tools like [Enketo](https://enketo.org/). It allows them to see the forms available on the server, and to send new submissions to them.
* The [OData](http://odata.org/) standard allows data to be shared between platforms for analysis and reporting. Tools like [Microsoft Power BI](https://powerbi.microsoft.com/en-us/) and [Tableau](https://public.tableau.com/en-us/s/) are examples of clients that consume the standard OData format and provide advanced features beyond what we offer. If you are looking for a straightforward JSON output of your data, or you are considering building a visualization or reporting tool, this is your best option.

Finally, **system information and configuration** is available via a set of specialized resources. Currently, you may set the Backups configuration, and retrieve Server Audit Logs.

## Changelog

Here major and breaking changes to the API are listed by version.

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

* The new [Public Link](/reference/forms-and-submissions/'-public-access-links) resource lets you create Public Access Links, granting anonymous browser-based access to submit to your Forms using Enketo.

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
  * This includes [a subresource](/reference/forms-and-submissions/'-draft-form) at `/projects/…/forms/…/draft`,
  * and [another](/reference/forms-and-submissions/'-published-form-versions) at `/projects/…/forms/…/versions`,
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

* Form-specific [Assignments resource](/reference/forms-and-submissions/'-form-assignments) at `projects/…/forms/…/assignments`, allowing granular role assignments on a per-Form basis.
  * Relatedly, the [OpenRosa Form Listing API](/reference/openrosa-endpoints/openrosa-form-listing-api) no longer rejects requests outright based on authentication. Rather, it will only return Forms that the authenticated user is allowed to view.
  * A [new summary API](/reference/project-management/project-assignments/seeing-all-form-assignments-within-a-project) `GET /projects/…/assignments/forms` which returns all assignments on all Forms within a Project, so you don't have to request this information separately for each Form.
* `PUT /projects/:id`, which while complex allows you to update many Forms' states and assignments with a single transactional request.
* `POST /projects/…/forms` now allows upload of `.xls` and `.xlsx` XLSForm files. The correct MIME type must be given.
* `GET /users/?q` will now always return user details given an exact match for an email, even for users who cannot `user.list`. The request must still be authenticate as a valid Actor. This allows non-Administrators to choose a user for an action (eg grant rights) without allowing full search.

**Changed**:

* Newly created App Users are no longer automatically granted download and submission access to all Forms within their Project. You will want to use the [Form Assignments resource](/reference/forms-and-submissions/'-form-assignments) to explicitly grant `app-user` role access to the Forms they should be allowed to see.

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

* The Extended responses for Forms and Submissions no longer include an `xml` property. To retrieve Form or Submission XML, use the dedicated endpoints for [Form XML](/reference/forms-and-submissions/'-individual-form/retrieving-form-xml) and [Submission XML](/reference/forms-and-submissions/submissions/retrieving-submission-xml).

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
                "email": "my.email.address@opendatakit.org",
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

As given by [the standard](https://en.wikipedia.org/wiki/Basic_access_authentication), the text following the `Basic` marker here is a base64 encoding of the credentials, provided in the form `email:password` (in this example `my.email.address@opendatakit.org:my.password`).

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

To use App User Authentication, first obtain a App User, typically by using the configuration panel in the user interface, or else by using the [App User API Resource(/reference/accounts-and-users/app-users). Once you have the token, you can apply it to any eligible action by prefixing the URL with `/key/{appUser}` as follows:

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

Optionally, a `q` querystring parameter may be provided to filter the returned users by any given string. The search is performed via a [trigram similarity index](https://www.postgresql.org/docs/9.6/pgtrgm.html) over both the Email and Display Name fields, and results are ordered by match score, best matches first.

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
        + email: `my.email.address@opendatakit.org` (string, required) - The email address of the User account to be created.
        + password: `my.super.secure.password` (string, optional) - If provided, the User account will be created with this password. Otherwise, the user will still be able set their own password later.

    + Body

            { "email": "my.email.address@opendatakit.org" }

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
        + email: `new.email.address@opendatakit.org` (string, optional) - The email address that should be associated with this User.

    + Body

            {
              "displayName": "New Name",
              "email": "new.email.address@opendatakit.org"
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
        + email: `my.email.address@opendatakit.org` (string, required) - The email address of the User account whose password is to be reset.

    + Body

            { "email": "my.email.address@opendatakit.org" }

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

When an App User is created, they are assigned no rights. They will be able to authenticate and list forms on a mobile client, but the form list will be empty, as the list only includes Forms that the App User has read access to. Once an App User is created, you'll likely wish to use the [Form Assignments resource](/reference/forms-and-submissions/'-form-assignments) to actually assign the `app-user` role to them for the Forms you wish.

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

The [Project Assignments resource](/reference/project-management/project-assignments), nested under Projects, manages Role assignment to that Project in particular, and all objects within it. And the [Form Assignments resource](/reference/forms-and-submissions/'-form-assignments) allows even more granular assignments, to specific Forms within a Project. All of these resources have the same structure and take and return the same data types.

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

Apart from staff users ("Web Users" in the Central management interface) and some site-wide configuration details like backups, all of ODK Central's objects (Forms, Submissions, App Users) are partitioned by Project, and available only as subresources below the main Projects resource.

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

The Project name may be updated, as well as the `archived` flag.

By default, `archived` is not set, which is equivalent to `false`. If `archived` is set to `true`, the Project will be sorted to the bottom of the list, and in the web management application the Project will become effectively read-only. API write access will not be affected.

+ Parameters
    + id: `16` (number, required) - The numeric ID of the Project

+ Request (application/json)
    + Attributes
        + name: `New Project Name` (string, required) - The desired name of the Project.
        + archived: `true` (boolean, optional) - Archives the Project.

    + Body

            { "name": "New Project Name", "archived": true }

+ Response 200 (application/json)
    + Attributes (Project)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Deep Updating Project and Form Details [PUT /v1/projects/{id}]

_(introduced: version 0.7)_

When managing a large deployment, it can be necessary to make sweeping changes to all Form States and Assignments within it at once&mdash;when rolling out a new Form, for example, or replacing a deprecated version with a new revision.

For this purpose, we offer this `PUT` resource, which allows a deep update of Project metadata, Form metadata, and Form Assignment metadata at once and transactionally using a nested data format.

One important mechanic to note immediately here is that we follow true `PUT` semantics, meaning that the data you provide is not merged with existing data to form an update. With our usual `PATCH` endpoints, we do this kind of merging and so data that you don't explicitly pass us is left alone. Because we allow the deletion of Form Assignments by way of omission with this API, we treat _all_ omissions as an explicit specification to null the omitted field. This means that, for example, you must always re-specify the Project name (and archival flag) with every `PUT`.

This adherence to `PUT` semantics would normally imply that Forms could be created or deleted by way of this request, but such an operation could become incredibly complex, we currently return a `501 Not Implemented` error if you supply nested Form information but you do not give us exactly the entire set of extant Forms.

You can inspect the Request format for this endpoint to see the exact nested data structure this endpoint accepts. Each level of increased granularity is optional: you may `PUT` just Project metadata, with no `forms` array, and you may `PUT` Project and Form metadata but omit `assignments` from any Form, in which case the omitted detail will be left as-is.

+ Parameters
    + id: `16` (number, required) - The numeric ID of the Project

+ Request (application/json)
    + Attributes
        + name: `New Project Name` (string, required) - The desired name of the Project.
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

Deleting a Project will remove it from the management interface and make it permanently inaccessible. Do not do this unless you are certain you will never need any of its data again.

+ Parameters
    + id: `16` (number, required) - The numeric ID of the Project

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Project Assignments [/v1/projects/{projectId}/assignments]

_(introduced: version 0.5)_

There are multiple Assignments resources. This one, specific to the Project it is nested within, only governs Role assignments to that Project. Assigning an Actor a Role that grants, for example, a verb `submission.create`, allows that Actor to create a submission anywhere within this Project. It is also possible to assign rights only to specific forms for actions related only to that form and its submissions: see the [Form Assignments resource](/reference/forms-and-submissions/'-form-assignments) for information about this.

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

Like the [Form Assignments summary API](/reference/forms-and-submissions/'-form-assignments/listing-all-form-assignments), but filtered by some `roleId`.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to expand the `actorId` into a full `actor` objects. The Role reference remains a numeric ID and the Form reference remains a string ID.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Form Summary Assignment])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Form Summary Assignment])

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group Forms and Submissions

`Form`s are the heart of ODK. They are created out of XML documents in the [ODK XForms](https://opendatakit.github.io/xforms-spec/) specification format. The [Intro to Forms](https://docs.opendatakit.org/form-design-intro/) on the ODK Documentation website is a good resource if you are unsure what this means. Once created, Forms can be retrieved in a variety of ways, their state can be managed, and they can be deleted.

`Submission`s are filled-out forms (also called `Instance`s in some other ODK documentation). Each is associated with a particular Form (and in many cases with a particular _version_ of a Form), and is also created out of a standard XML format based on the Form itself. Submissions can be sent with many accompanying multimedia attachments, such as photos taken in the course of the survey. Once created, the Submissions themselves as well as their attachments can be retrieved through this API.

These subsections cover only the modern RESTful API resources involving Forms and Submissions. For documentation on the OpenRosa endpoints (which can be used to list Forms and submit Submissions), or the OData endpoints (which can be used to bulk-export the data in the standardize OData format), see those sections below.

## Forms [/v1/projects/{projectId}/forms]

In this API, `Form`s are distinguished by their [`formId`](https://opendatakit.github.io/xforms-spec/#primary-instance)s, which are a part of the XForms XML that defines each Form. In fact, as you will see below, many of the properties of a Form are extracted automatically from the XML: `hash`, `name`, `version`, as well as the `formId` itself (which to reduce confusion internally is known as `xmlFormId` in ODK Central).

The only other property Forms currently have is `state`, which can be used to control whether Forms show up in mobile clients like ODK Collect for download, as well as whether they accept new `Submission`s or not.

It is not yet possible to modify a Form's XML definition once it is created.

+ Parameters
    + projectId: `16` (number, required) - The numeric ID of the Project

### List all Forms [GET]

Currently, there are no paging or filtering options, so listing `Form`s will get you every Form in the system, every time.

This endpoint supports retrieving extended metadata; provide a header `X-Extended-Metadata: true` to additionally retrieve the `submissions` count of the number of `Submission`s that each Form has and the `lastSubmission` most recent submission timestamp, as well as the Actor the Form was `createdBy`.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Form])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Form])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Creating a new Form [POST /v1/projects/{projectId}/forms{?ignoreWarnings}{?publish}]

When creating a `Form`, the only required data is the actual XForms XML or XLSForm itself. Use it as the `POST` body with a `Content-Type` header of `application/xml` (`text/xml` works too), and the Form will be created.

As of Version 0.8, Forms will by default be created in Draft state, accessible under `/projects/…/forms/…/draft`. The Form itself will not have a public XML definition, and will not appear for download onto mobile devices. You will need to [publish the form](/reference/forms-and-submissions/'-draft-form/publishing-a-draft-form) to finalize it for data collection. To disable this behaviour, and force the new Form to be immediately ready, you can pass the querystring option `?publish=true`.

For XLSForm upload, either `.xls` or `.xlsx` are accepted. You must provide the `Content-Type` request header corresponding to the file type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for `.xlsx` files, and `application/vnd.ms-excel` for `.xls` files. You must also provide an `X-XlsForm-FormId-Fallback` request header with the `formId` you want the resulting form to have, if the spreadsheet does not already specify.

By default, any XLSForm conversion Warnings will fail this request and return the warnings rather than use the converted XML to create a form. To override this behaviour, provide a querystring flag `?ignoreWarnings=true`. Conversion Errors will always fail this request.

The API will currently check the XML's structure in order to extract the information we need about it, but ODK Central does _not_ run comprehensive validation on the full contents of the XML to ensure compliance with the ODK specification. Future versions will likely do this, but in the meantime you will have to use a tool like [ODK Validate](https://opendatakit.org/use/validate/) to be sure your Forms are correct.

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

### › Individual Form [/v1/projects/{projectId}/forms/{xmlFormId}]

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

Only `DELETE` a `Form` if you are sure you will never need it again. If your goal is to prevent it from showing up on survey clients like ODK Collect, consider setting its `state` to `closing` or `closed` instead (see [Modifying a Form](/reference/forms-and-submissions/'-individual-form/modifying-a-form) just above for more details).

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

### › Draft Form [/v1/projects/{projectId}/forms/{xmlFormId}/draft]

_(introduced: version 0.8)_

Draft Forms allow you to test and fix issues with Forms before they are finalized and presented to data collectors. They make this process easier, as Draft Forms can be created and discarded without consequence: your Drafts will not count against the overall Form schema, nor against the set of unique `version` strings for the Form.

You can create or replace the current Draft Form at any time by `POST`ing to the `/draft` subresource on the Form, and you can publish the current Draft by `POST`ing to `/draft/publish`.

When a Draft Form is created, a Draft Token is also created for it, which can be found in Draft Form responses at `draftToken`. This token allows you to [submit test Submissions to the Draft Form](/reference/forms-and-submissions/'-draft-submissions/creating-a-submission) through clients like Collect. If the Draft is published or deleted, the token will be deactivated. But if you replace the Draft without first deleting it, the existing Draft Token will be carried forward, so that you do not have to reconfigure your device.

+ Parameters
    + projectId: `1` (number, required) - The `id` of the Project this Form belongs to.
    + xmlFormId: `simple` (string, required) - The `id` of this Form as given in its XForms XML definition

#### Creating a Draft Form [POST /v1/projects/{projectId}/forms/{xmlFormId}/draft{?ignoreWarnings}]

`POST`ing here will create a new Draft Form on the given Form. For the most part, it takes the same parameters as the [Create Form request](/reference/forms-and-submissions/forms/creating-a-new-form): you can submit XML or Excel files, you can provide `ignoreWarnings` if you'd like.

Additionally, however, you may `POST` with no `Content-Type` and an empty body to create a Draft Form with a copy of the definition (XML, XLS, etc) that is already published, if there is one. This can be useful if you don't wish to update the Form definition itself, but rather one or more Form Attachments.

If your Draft form schema contains any field path which overlaps with a field path of a previous version of the Form, but with a different data type, your request will be rejected. You can rename the conflicting field, or correct it to have the same data type as it did previously.

When a Draft is created, the expected Form Attachments are computed and slots are created, as with a new Form. Any attachments that match existing ones on the published Form, if it exists, will be copied over to the new Draft.

Even if a Draft exists, you can always replace it by `POST`ing here again. In that case, the attachments that exist on the Draft will similarly be copied over to the new Draft. If you wish to copy from the published version instead, you can do so by first `DELETE`ing the extant Draft.

Draft `version` conflicts are allowed with prior versions of a Form while in Draft state. If you attempt to [publish the Form](/reference/forms-and-submissions/'-draft-form/publishing-a-draft-form) without correcting the conflict, the publish operation will fail. You can request that Central update the version string on your behalf as part of the publish operation to avoid this: see that endpoint for more information.

The `xmlFormId`, however, must exactly match that of the Form overall, or the request will be rejected.

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

#### Listing expected Form Attachments [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments]

Form Attachments for each form are automatically determined when the form is first created, by scanning the XForms definition for references to media or data files. Because of this, it is not possible to directly modify the list of form attachments; that list is fully determined by the given XForm. Instead, the focus of this API subresource is around communicating that expected list of files, and uploading binaries into those file slots.

+ Response 200 (application/json)
    + Attributes (array[Form Attachment])

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Uploading a Form Attachment [POST /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments/{filename}]

To upload a binary to an expected file slot, `POST` the binary to its endpoint. Supply a `Content-Type` MIME-type header if you have one.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Request (*/*)
    + Body

            (binary data)

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Downloading a Form Attachment [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments/{filename}]

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

#### Clearing a Form Attachment [DELETE /v1/projects/{projectId}/forms/{xmlFormId}/draft/attachments/{filename}]

Because Form Attachments are completely determined by the XForms definition of the form itself, there is no direct way to entirely remove a Form Attachment entry from the list, only to clear its uploaded content. Thus, when you issue a `DELETE` to the attachment's endpoint, that is what happens.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

#### Getting Draft Form Schema Fields [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/fields{?odata}]

Identical to the [same request](/reference/forms-and-submissions/'-individual-form/retrieving-form-schema-fields) for the published Form, but will return the fields related to the current Draft version.

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

### › Published Form Versions [/v1/projects/{projectId}/forms/{xmlFormId}/versions]

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

#### Downloading a Form Attachment [GET /v1/projects/{projectId}/forms/{xmlFormId}/versions/{version}/attachments/{filename}]

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

Identical to the [same request](/reference/forms-and-submissions/'-individual-form/retrieving-form-schema-fields) for the published Form, but will return the fields related to the specified version.

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

## › Form Assignments [/v1/projects/{projectId}/forms/{xmlFormId}/assignments]

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

## › Public Access Links [/v1/projects/{projectId}/forms/{xmlFormId}/public-links]

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

### Exporting Form Submissions to CSV [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions.csv.zip{?media,%24filter}]

To export all the `Submission` data associated with a `Form`, just add `.csv.zip` to the end of the listing URL. The response will be a ZIP file containing one or more CSV files, as well as all multimedia attachments associated with the included Submissions.

You can exclude the media attachments from the ZIP file by specifying `?attachments=false`.

If [Project Managed Encryption](/reference/encryption) is being used, additional querystring parameters may be provided in the format `{keyId}={passphrase}` for any number of keys (eg `1=secret&4=password`). This will decrypt any records encrypted under those managed keys. Submissions encrypted under self-supplied keys will not be decrypted. **Note**: if you are building a browser-based application, please consider the alternative `POST` endpoint, described in the following section.

If a passphrase is supplied but is incorrect, the entire request will fail. If a passphrase is not supplied but encrypted records exist, only the metadata for those records will be returned, and they will have a `status` of `not decrypted`.

If you are running an unsecured (`HTTP` rather than `HTTPS`) Central server, it is not a good idea to export data this way as your passphrase and the decrypted data will be sent plaintext over the network.

You can use an [OData-style `$filter` query](/reference/odata-endpoints/odata-form-service/data-document) to filter the submissions that will appear in the ZIP file. This is a bit awkward, since this endpoint has nothing to do with OData, but since we already must recognize the OData syntax, it is less strange overall for now not to invent a whole other one here. Only a subset of the `$filter` features are available; please see the linked section for more information.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + attachments: `true` (boolean, optional) - Set to false to exclude media attachments from the export.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the given OData query. Only the fields `__system/submitterId` and `__system/submissionDate` are available to reference. The operators `lt`, `lte`, `eq`, `neq`, `gte`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.

+ Response 200
    + Headers

            Content-Disposition: attachment; filename=simple.zip

    + Body

            (binary data)

+ Response 400 (application/json)
    + Attributes (Error 400)

+ Response 403 (application/json)
    + Attributes (Error 403)

### Exporting Form Submissions to CSV via POST [POST /v1/projects/{projectId}/forms/{xmlFormId}/submissions.csv.zip{?media,%24filter}]

This non-REST-compliant endpoint is provided for use with [Project Managed Encryption](/reference/encryption). In every respect, it behaves identically to the `GET` endpoint described in the previous section, except that it works over `POST`. This is necessary because for browser-based applications, it is a dangerous idea to simply link the user to `/submissions.csv.zip?2=supersecretpassphrase` because the browser will remember this route in its history and thus the passphrase will become exposed. This is especially dangerous as there are techniques for quickly learning browser-visited URLs of any arbitrary domain.

You can exclude the media attachments from the ZIP file by specifying `?attachments=false`.

And so, for this `POST` version of the Submission CSV export endpoint, the passphrases may be provided via `POST` body rather than querystring. Two formats are supported: form URL encoding (`application/x-www-form-urlencoded`) and JSON. In either case, the keys should be the `keyId`s and the values should be the `passphrase`s, as with the `GET` version above.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + attachments: `true` (boolean, optional) - Set to false to exclude media attachments from the export.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the given OData query. Only the fields `__system/submitterId` and `__system/submissionDate` are available to reference. The operators `lt`, `lte`, `eq`, `neq`, `gte`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.

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

Please see the [above endpoint](/reference/forms-and-submissions/submissions/exporting-form-submissions-to-csv) for notes on dealing with Managed Encryption.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the given OData query. Only the fields `__system/submitterId` and `__system/submissionDate` are available to reference. The operators `lt`, `lte`, `eq`, `neq`, `gte`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.

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

As with [`POST` to `.csv.zip`](/reference/forms-and-submissions/submissions/exporting-form-submissions-to-csv-via-post) it allows secure submission of decryption passkeys. Please see that endpoint for more information on how to do this.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the given OData query. Only the fields `__system/submitterId` and `__system/submissionDate` are available to reference. The operators `lt`, `lte`, `eq`, `neq`, `gte`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.

+ Response 200
    + Body

            (csv data)

+ Response 400 (application/json)
    + Attributes (Error 400)

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

### Getting Submission details [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}]

Like how `Form`s are addressed by their XML `formId`, individual `Submission`s are addressed in the URL by their `instanceId`.

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

#### Retrieving Submission XML [GET /v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}.xml]

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

#### Creating a Submission [POST /v1/projects/{projectId}/forms/{xmlFormId}/submissions]

To create a Submission by REST rather than over the [OpenRosa interface](/reference/openrosa-endpoints/openrosa-form-submission-api), you may `POST` the Submission XML to this endpoint. The request must have an XML `Content-Type` (`text/xml` or `application/xml`).

Unlike the OpenRosa Form Submission API, this interface does _not_ accept Submission attachments upon Submission creation. Instead, the server will determine which attachments are expected based on the Submission XML, and you may use the endpoints found in the following section to add the appropriate attachments and check the attachment status and content.

If the XML is unparseable or there is some other input problem with your data, you will get a `400` error in response. If a submission already exists with the given `instanceId`, you will get a `409` error in response.

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

## › Attachments [/v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments]

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

## › Draft Submissions [/v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions]

All [Draft Forms](/reference/forms-and-submissions/'-draft-form) feature a `/submissions` subresource (`/draft/submissions`), which is identical to the same subresource on the form itself. These submissions exist only as long as the Draft Form does: they are removed if the Draft Form is published, and they are abandoned if the Draft Form is deleted or overwritten.

Here we list all those resources again just for completeness.

+ Parameters
    + projectId: `1` (number, required) - The `id` of the project this form belongs to.
    + xmlFormId: `simple` (string, required) - The `id` of this form as given in its XForms XML definition

### Listing all Submissions on a Draft Form [GET]

Identical to [the non-Draft version](/reference/forms-and-submissions/submissions/listing-all-submissions-on-a-form) of this endpoint.

+ Response 200 (application/json)
    This is the standard response, if Extended Metadata is not requested:

    + Attributes (array[Submission])

+ Response 200 (application/json; extended)
    This is the Extended Metadata response, if requested via the appropriate header:

    + Attributes (array[Extended Submission])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Exporting Form Submissions to CSV [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions.csv.zip]

Identical to [the non-Draft version](/reference/forms-and-submissions/submissions/exporting-form-submissions-to-csv) of this endpoint.

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

Identical to [the non-Draft version](/reference/forms-and-submissions/submissions/exporting-form-submissions-to-csv-via-post) of this endpoint.

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

Identical to [the non-Draft version](/reference/forms-and-submissions/submissions/listing-encryption-keys) of this endpoint.

+ Parameters
    + xmlFormId: `simple` (string, required) - The `xmlFormId` of the Form being referenced.

+ Response 200
    + Attributes (array[Key])

+ Response 403 (application/json)
    + Attributes (Error 403)

### Getting Submission details [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft/submissions/{instanceId}]

Identical to [the non-Draft version](/reference/forms-and-submissions/submissions/getting-submission-details) of this endpoint.

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

Identical to [the non-Draft version](/reference/forms-and-submissions/submissions/retrieving-submission-xml) of this endpoint.

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

Identical to [the non-Draft version](/reference/forms-and-submissions/submissions/creating-a-submission) of this endpoint.

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

Identical to [the non-Draft version](/reference/forms-and-submissions/'-attachments/listing-expected-submission-attachments) of this endpoint.

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

Identical to [the non-Draft version](/reference/forms-and-submissions/'-attachments/downloading-an-attachment) of this endpoint.

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

Identical to [the non-Draft version](/reference/forms-and-submissions/'-attachments/uploading-an-attachment) of this endpoint.

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

_(introduced: version 0.4)_

Identical to [the non-Draft version](/reference/forms-and-submissions/'-attachments/clearing-a-submission-attachment) of this endpoint.

+ Parameters
    + instanceId: `uuid:85cb9aff-005e-4edd-9739-dc9c1a829c44` (string, required) - The `instanceId` of the Submission being referenced.
    + filename: `file1.jpg` (string, required) - The name of the file as given by the Attachments listing resource.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

# Group OpenRosa Endpoints

[OpenRosa](https://bitbucket.org/javarosa/javarosa/wiki/OpenRosaAPI) is an API standard which accompanies the ODK XForms XML standard, allowing compliant servers and clients to use a common protocol to communicate `Form`s and `Submission`s to each other. When survey clients like ODK Collect and Enketo submit Submission data to a Form, this is the API they use.

ODK Central is _not_ a fully compliant OpenRosa server. OpenRosa requires compliance with five major components:

1. [**Metadata Schema**](https://bitbucket.org/javarosa/javarosa/wiki/OpenRosaMetaDataSchema), which defines a standard way to include metadata like the survey device ID and survey duration with a Submission. ODK Central will accept and return this data, but does nothing special with anything besides the `instanceId` at this time.
2. [**HTTP Request API**](https://bitbucket.org/javarosa/javarosa/wiki/OpenRosaRequest), which defines a set of requirements every OpenRosa request and response must follow. ODK Central is fully compliant with this component.
3. [**Form Submission API**](https://bitbucket.org/javarosa/javarosa/wiki/FormSubmissionAPI), which defines how Submissions are submitted to the server. ODK Central is fully compliant with this component.
4. [**Authentication API**](https://bitbucket.org/javarosa/javarosa/wiki/AuthenticationAPI), which defines how users authenticate with the server. ODK Central provides [three authentication methods](/reference/authentication). One of these is HTTPS Basic Authentication, which is recommended by the OpenRosa specification. However, because [we do not follow the try/retry pattern](/reference/authentication/https-basic-authentication/using-basic-authentication) required by the OpenRosa and the RFC specification, ODK Central is _not compliant_ with this component. Our recommendation generally is to use [App User Authentication](/reference/authentication/app-user-authentication) when submitting data from survey clients.
5. [**Form Discovery (Listing) API**](https://bitbucket.org/javarosa/javarosa/wiki/FormListAPI), which returns a listing of Forms available for survey clients to download and submit to. At this time, ODK Central is _partially compliant_ with this component: the server will return a correctly formatted `formList` response, but it does not currently handle the optional filter parameters.

In practical usage, ODK survey clients like Collect will interact with Central in three places:

* The OpenRosa Form Listing API, [documented below](/reference/openrosa-endpoints/openrosa-form-listing-api), lists the Forms the client can retrieve.
* The [Form XML download](/reference/forms-and-submissions/'-individual-form/retrieving-form-xml) endpoint, a part of the standard REST API for Forms, is linked in the Form Listing response and allows clients to then download the ODK XForms XML for each form.
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

This is the fully standards-compliant implementation of the [OpenRosa Form Submission API](https://bitbucket.org/javarosa/javarosa/wiki/FormSubmissionAPI). We will not attempt to redocument the standard here.

Some additional things to understand when using this API:

* ODK Central will always provide an `X-OpenRosa-Accept-Content-Length` of 100 megabytes. In reality, this number depends on how the server has been deployed. The default Docker-based installation, for example, is limited to 100MB at the nginx layer.
* The `xml_submission_file` may have a Content Type of either `text/xml` _or_ `application/xml`.
* Central supports the `HEAD` request preflighting recommended by the specification, but does not require it. Because our supported authentication methods do not follow the try/retry pattern, only preflight your request if you want to read the `X-OpenRosa-Accept-Content-Length` header or are concerned about the other issues listed in the standards document, like proxies.
* As stated in the standards document, it is possible to submit multimedia attachments with the `Submission` across multiple `POST` requests to this API. _However_, we impose the additional restriction that the Submission XML (`xml_submission_file`) _may not change_ between requests. If Central sees a Submission with an `instanceId` it already knows about but the XML has changed in any way, it will respond with a `409 Conflict` error and reject the submission.
* Central will never return a `202` in any response from this API.
* If you haven't already, please take a look at the **HTTP Request API** notes above on the required OpenRosa headers.

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

You can get the appropriate Draft Token for any given draft by [requesting the Draft Form](/reference/forms-and-submissions/'-draft-form/getting-draft-form-details).

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

Identical to the [non-Draft version](/reference/openrosa-endpoints/openrosa-form-listing-api/openrosa-form-submission-api), but will only submit to (and allow submissions to) the Draft Form to be tested.

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

Identical to the [non-Draft version](/reference/openrosa-endpoints/openrosa-form-listing-api/openrosa-form-manifest-api).

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

Identical to the [non-Draft version](/https://jubilantgarbanzo.docs.apiary.io/reference/forms-and-submissions/'-individual-form/downloading-a-form-attachment).

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

Most other types map to `String`. The exceptions are numbers, which map either to `Int64` or `Decimal` as appropriate, datetime fields which are always `DateTimeOffset`, and geography points which will appear as `GeographyPoint`, `GeographyLineString`, or `GeographyPolygon` given a `geopoint`, `geotrace`, or `geoshape`.

Due to a limitation in Power BI, we do not take the extra step of advertising the actual relationships between tables (the point at which a `repeat` connects the parent data to the repeated subtable). Normally, this would be done with a `NavigationProperty`. However, while the OData specification allows Navigation Properties to exist on Complex Types, Power BI only allows them on Entity Types, as it makes certain assumptions about how Primary Keys must be structured to relate the two tables together. This is a problem for us, because it is a common idiom in ODK XForms design to place `repeat`s inside of `group`s. When Power BI resolves this issue, we will be able to formally represent the joins between these tables.

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

### Data Document [GET /v1/projects/{projectId}/forms/{xmlFormId}.svc/{table}{?%24skip,%24top,%24count,%24wkt,%24filter,%24expand}]

The data documents are the straightforward JSON representation of each table of `Submission` data. They follow the [corresponding specification](http://docs.oasis-open.org/odata/odata-json-format/v4.01/odata-json-format-v4.01.html), but apart from the representation of geospatial data as GeoJSON rather than the ODK proprietary format, the output here should not be at all surprising. If you are looking for JSON output of Submission data, this is the best place to look.

The `$top` and `$skip` querystring parameters, specified by OData, apply `limit` and `offset` operations to the data, respectively. The `$count` parameter, also an OData standard, will annotate the response data with the total row count, regardless of the scoping requested by `$top` and `$skip`. While paging is possible through these parameters, it will not greatly improve the performance of exporting data. ODK Central prefers to bulk-export all of its data at once if possible.

As of ODK Central v1.1, the [`$filter` querystring parameter](http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#_Toc31358948) is partially supported. In OData, you can use `$filter` to filter by any data field in the schema. In ODK Central, the only fields you can reference are `__system/submitterId` and `__system/submissionDate`. These refer to the numeric `actorId` and the timestamp `createdAt` of the submission overall. The operators `lt`, `lte`, `eq`, `neq`, `gte`, `gt`, `not`, `and`, and `or` are supported. The built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second` are supported. These supported elements may be combined in any way, but all other `$filter` features will cause an error. Please see the [OData documentation](http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#_Toc31358948) on `$filter` for more information.

If you want to expand all repetitions, you can use `%24expand=&#42;`. This might be helpful if you want to get a full dump of all submissions within a single query.

The _nonstandard_ `$wkt` querystring parameter may be set to `true` to request that geospatial data is returned as a [Well-Known Text (WKT) string](https://en.wikipedia.org/wiki/Well-known_text) rather than a GeoJSON structure. This exists primarily to support Tableau, which cannot yet read GeoJSON, but you may find it useful as well depending on your mapping software. **Please note** that both GeoJSON and WKT follow a `(lon, lat, alt)` coördinate ordering rather than the ODK-proprietary `lat lon alt`. This is so that the values map neatly to `(x, y, z)`. GPS accuracy information is not a part of either standards specification, and so is presently omitted from OData output entirely. GeoJSON support may come in a future version.

As the vast majority of clients only support the JSON OData format, that is the only format ODK Central offers.

+ Parameters
    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.
    + `table`: `Submissions` (string, required) - The name of the table to be returned. These names can be found in the output of the [Service Document](/reference/odata-endpoints/odata-form-service/service-document).
    + `%24skip`: `10` (number, optional) - If supplied, the first `$skip` rows will be omitted from the results.
    + `%24top`: `5` (number, optional) - If supplied, only up to `$top` rows will be returned in the results.
    + `%24count`: `true` (boolean, optional) - If set to `true`, an `@odata.count` property will be added to the result indicating the total number of rows, ignoring the above paging parameters.
    + `%24wkt`: `true` (boolean, optional) - If set to `true`, geospatial data will be returned as Well-Known Text (WKT) strings rather than GeoJSON structures.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the query. Only the fields `__system/submitterId` and `__system/submissionDate` are available to reference. The operators `lt`, `lte`, `eq`, `neq`, `gte`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.
    + `%24expand`: `&#42;` (string, optional) - Repetitions, which should get expanded. Currently, only `&#42` is implemented, which expands all repetitions.

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

### Data Document [GET /v1/projects/{projectId}/forms/{xmlFormId}/draft.svc/{table}{?%24skip,%24top,%24count,%24wkt,%24filter}]

Identical to [the non-Draft version](/reference/odata-endpoints/odata-form-service/data-document) of this endpoint.

+ Parameters
    + `xmlFormId`: `simple` (string, required) - The `xmlFormId` of the `Form` whose OData service you wish to access.
    + `table`: `Submissions` (string, required) - The name of the table to be returned. These names can be found in the output of the [Service Document](/reference/odata-endpoints/odata-form-service/service-document).
    + `%24skip`: `10` (number, optional) - If supplied, the first `$skip` rows will be omitted from the results.
    + `%24top`: `5` (number, optional) - If supplied, only up to `$top` rows will be returned in the results.
    + `%24count`: `true` (boolean, optional) - If set to `true`, an `@odata.count` property will be added to the result indicating the total number of rows, ignoring the above paging parameters.
    + `%24wkt`: `true` (boolean, optional) - If set to `true`, geospatial data will be returned as Well-Known Text (WKT) strings rather than GeoJSON structures.
    + `%24filter`: `year(__system/submissionDate) lt year(now())` (string, optional) - If provided, will filter responses to those matching the query. Only the fields `__system/submitterId` and `__system/submissionDate` are available to reference. The operators `lt`, `lte`, `eq`, `neq`, `gte`, `gt`, `not`, `and`, and `or` are supported, and the built-in functions `now`, `year`, `month`, `day`, `hour`, `minute`, `second`.

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

There are some resources available for getting or setting system information and configuration. You can [set the Backups configuration](/reference/system-endpoints/backups-configuration) for the server, or you can [retrieve the Server Audit Logs](/reference/system-endpoints/server-audit-logs).

## Backups Configuration [/v1/config/backups]

This resource does not conform to REST standards, as it has a multi-step initialization process and is essentially a singleton object: only one backup may be configured at a time.

### Getting the current configuration [GET]

If configured, this endpoint will return a combination of the present backups configuration type, along with the `Audit` log entry of the most recent backup attempt, if one exists. For security reasons, none of the actual internal authentication and encryption information is returned.

If no backups are configured, this endpoint will return a `404`.

+ Response 200 (application/json)
    + Body

            {
                "type": "google",
                "setAt": "2018-01-06T00:32:52.787Z",
                "recent": [{
                    "acteeId": null,
                    "action": "backup",
                    "actorId": null,
                    "details": {
                        "success": true
                    },
                    "loggedAt": "2018-03-21T03:47:03.504Z"
                }]
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

### Initiating a new backup configuration [POST /v1/config/backups/initiate]

This is the first of two steps required to initialize a new backup configuration.

While the administrative interface packaged with ODK Central requires a backup to be terminated before a new one may be set up, the API has no such limitation. Should the initialization process succeed (with a `POST /v1/config/backups/verify` as [documented below](/reference/system-endpoints/backups-configuration/completing-a-new-backup-configuration)), the existing backup will be overwritten with the new configuration.

All ODK Central backups are encrypted before they are sent to Google Drive for storage. If a `passphrase` is not provided with this request, encryption will still occur with a `""` empty string passphrase.

To complete the backup configuration, it is necessary to use the Google OAuth URL returned by this endpoint and have a human interactively undergo the Google OAuth process to authorize ODK Central to send files to their account. Because of the way we have set the OAuth structure up, it is not necessary for each installation of the server to provision its own Google Developer key.

+ Request (application/json)
    + Attributes
        + passphrase: `super.secret` (string, optional) - The passphrase to use in encrypting the backup data. If no passphrase is provided, backups are still encrypted but with a `""` empty string passphrase.

+ Response 200 (application/json)
    + Attributes
        + token: `DS9aOoudH3kGw3a$tkCf9SGa3gvM41sbuZ$2IpVTrc!OBbKjrB03JPXA0Csn1lVF` (string, required) - The Session Bearer Token to be used in authenticating the follow-up `/verify` request.
        + url: `https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file&response_type=code&client_id=660095633112-h7bhsjenhp1agd0c4v3cmqk6bccgkdu0.apps.googleusercontent.com&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob` (string, required) - The Google OAuth URL to send the human user to in order to allow access to their Google Drive account for storing backups.

+ Response 403 (application/json)
    + Attributes (Error 403)

### Completing a new backup configuration [POST /v1/config/backups/verify]

This is the second of two steps required to initialize a new backup configuration. As noted in step 1 above, if a backup already exists and this request succeeds, it will be overwritten with the new configuration.

This endpoint has two requirements, both relating to [step 1](/reference/system-endpoints/backups-configuration/initiating-a-new-backup-configuration):

* It _must_ be called via Session Bearer Token auth (`Authorization: Bearer {token}`), with the token provided in the response to step 1. Attempting to authenticate as any other `Actor` will fail.
* It needs to be provided with the verification `code` the user receives at the end of their Google OAuth process.

If these two things are present and correct, and Google can be reached to verify the code, the new backups will be configured.

+ Request (application/json)
    + Attributes
        + code: `4/AACdfD3bBxUAI-zlkLodGmUh_IC4zT6-j8EJ7jr7IFF7Nm4RH_S7RHs` (string, required) - The code the user receives at the end of the OAuth authorization process. Typically, it begins with the text `4/AA`.

+ Response 200 (application/json)
    + Attributes (Success)

+ Response 403 (application/json)
    + Attributes (Error 403)

## Direct Backup [/v1/backup]

_(introduced: version 1.1)_

ODK Central offers HTTP endpoints that will immediately perform a backup on the system database and send that encrypted backup as the response. You can `POST` with an encryption passphrase, or `GET` if you have encryption [already configured](/reference/system-endpoints/backups-configuration) to use the passphrase you configured then.

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

## Server Audit Logs [/v1/audits]

_(introduced: version 0.6)_

Server Audit Logs entries are created for the following `action`s:

* `user.create` when a new User is created.
* `user.update` when User information is updated, like email or password.
* `user.delete` when a User is deleted.
* `assignment.create` when an Actor is assigned to a Server Role.
* `assignment.delete` when an Actor is unassigned from a Server Role.
* `project.create` when a new Project is created.
* `project.update` when top-level Project information is updated, like its name.
* `project.delete` when a Project is deleted.
* `form.create` when a new Form is created.
* `form.update` when top-level Form information is updated, like its name or state.
* `form.update.draft.set` when a Draft Form definition is set.
* `form.update.draft.delete` when a Draft Form definition is deleted.
* `form.update.publish` when a Draft Form is published to the Form.
* `form.delete` when a Form is deleted.
* `form.attachment.update` when a Form Attachment binary is set or cleared.
* `submission.create` when a new Submission is created.
* `submission.attachment.update` when a Submission Attachment binary is set or cleared, but _only via the REST API_. Attachments created alongside the submission over the OpenRosa `/submission` API (including submissions from Collect) do not generate audit log entries.
* `backup` when a backup operation is attempted.

### Getting Audit Log Entries [GET /v1/audits{?action,start,end,limit,offset}]

This resource allows access to those log entries, with some paging and filtering options. These are provided by querystring parameters: `action` allows filtering by the action types listed above, `start` and `end` allow filtering by log timestamp (see below), and `limit` and `offset` control paging. If no paging parameters are given, the server will attempt to return every audit log entry that it has.

The `start` and `end` parameters work based on exact timestamps, given in [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) format. It is possible to provide just a datestring (eg `2000-01-01`), in which case midnight will be inferred. But this value alone leaves the timezone unspecified. When no timezone is given, the server's local time will be used: the standard [Docker deployment](https://docs.opendatakit.org/central-install/) will always set server local time to UTC, but installations may have been customized, and there is no guarantee the UTC default hasn't been overridden.

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

1. The [old methodology](https://docs.opendatakit.org/encrypted-forms/), where you generate an RSA keypair and use it with locally-downloaded encrypted data to decrypt submissions. We refer to these sorts of keys in this documentation as "self-supplied keys."
2. Managed Encryption, where Central will generate and store an RSA keypair for you, secured under a passphrase that Central does not save. The CSV export path can then decrypt all records on the fly given the passphrase.

Given the self-supplied key case, Central does not understand how to decrypt records, and the CSV export will export only metadata fields (and no binary attachments) for encrypted records. You may retrieve each data resource over the REST API and decrypt them yourself, or use ODK Briefcase to do this.

Managed Encryption is recommended for most people. The data is still encrypted "at rest" on the server, and the private key needed to decrypt the data is itself encrypted by the passphrase. Neither the passphrase nor the decrypted private key are ever stored; they are forgotten as soon as the server has finished the work at hand.

The relevant API operations are documented inline above; here we guide you through what exists from a high level.

To invoke Project Manage Encryption, you may use the web management interface, or [you may `POST /projects/…/key`](/reference/project-management/projects/enabling-project-managed-encryption).

To list all the encryption keys associated with the submissions on a given form, [you can `GET /projects/…/forms/…/submissions/keys`](/reference/forms-and-submissions/submissions/listing-encryption-keys). This is particularly useful for obtaining the integer numeric ID associated with each key, which will be necessary to decrypt the records, as well as for obtaining reminder hints about each passphrase.

To perform decryption, [you can `GET` or `POST /projects/…/forms/…/submissions.csv.zip`](/reference/forms-and-submissions/submissions/exporting-form-submissions-to-csv) with extra parameters to provide the necessary passphrases. If you are building a browser-based application, it is recommended that you `POST` rather than `GET`: please see the notes in the linked sections for additional details.

Note that the OData JSON API does not (presently) decrypt data. Any encrypted submissions will be returned only with basic metadata, like submission date and user.

# Data Structures

These are in alphabetic order, with the exception that the `Extended` versions of each structure, where applicable, is listed immediately following the standard version.

## Actor (object)
+ createdAt: `2018-04-18T23:19:14.802Z` (string, required) - ISO date format
+ displayName: `My Display Name` (string, required) - All `Actor`s, regardless of type, have a display name
+ id: `115` (number, required)
+ type: (Actor Type, required) - the Type of this Actor; typically this will be `user`.
+ updatedAt: `2018-04-18T23:42:11.406Z` (string, optional) - ISO date format

## Actor Type (enum)
+ user (string) - A User with an email and login password.
+ fieldKey (string) - An App User which can submit data to a form. ("Field Key" is a legacy internal name for "App User".)
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

## Form (object)
+ projectId: `1` (number, required) - The `id` of the project this form belongs to.
+ xmlFormId: `simple` (string, required) - The `id` of this form as given in its XForms XML definition
+ name: `Simple` (string, optional) - The friendly name of this form. It is given by the `<title>` in the XForms XML definition.
+ version: `2.1` (string, optional) - The `version` of this form as given in its XForms XML definition. If no `version` was specified in the Form, a blank string will be given. If there is no associated Form, `null` will be returned.
+ enketoId: `abcdef` (string, optional) - If it exists, this is the survey ID of this published Form on Enketo at `/-`. Only a cookie-authenticated user may access the preview through Enketo.
+ hash: `51a93eab3a1974dbffc4c7913fa5a16a` (string, required) - An MD5 sum automatically computed based on the XForms XML definition. This is required for OpenRosa compliance.
+ keyId: `3` (number, optional) - If a public encryption key is present on the form, its numeric ID as tracked by Central is given here.
+ state (Form State, required) - The present lifecycle status of this form. Controls whether it is available for download on survey clients or accepts new submissions.
+ createdAt: `2018-01-19T23:58:03.395Z` (string, required) - ISO date format
+ updatedAt: `2018-03-21T12:45:02.312Z` (string, optional) - ISO date format

## Extended Form (Form)
+ submissions: `10` (number, required) - The number of `Submission`s that have been submitted to this `Form`.
+ lastSubmission: `2018-04-18T03:04:51.695Z` (string, optional) - ISO date format. The timestamp of the most recent submission, if any.
+ createdBy: (Actor, optional) - The full information of the Actor who created this Form.
+ excelContentType: (string, optional) - If the Form was created by uploading an Excel file, this field contains the MIME type of that file.

## Draft Form (Form)
+ draftToken: `lSpAIeksRu1CNZs7!qjAot2T17dPzkrw9B4iTtpj7OoIJBmXvnHM8z8Ka4QPEjR7` (string, required) - The test token to use to submit to this draft form. See [Draft Testing Endpoints](/reference/forms-and-submissions/'-draft-submissions).
+ enketoId: `abcdef` (string, optional) - If it exists, this is the survey ID of this draft Form on Enketo at `/-`. Authentication is not needed to access the draft form through Enketo.

## Extended Form Version (Form)
+ publishedBy: (Actor, optional) - The full information of the Actor who published this version of the Form.
+ excelContentType: (string, optional) - If the Form was created by uploading an Excel file, this field contains the MIME type of that file.

## Form Attachment (object)
+ name: `myfile.mp3` (string, required) - The name of the file as specified in the XForm.
+ type: (Form Attachment Type, required) - The expected type of file as specified in the XForm.
+ exists: `true` (boolean, required) - Whether the server has the file or not.
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
+ keyId: `3` (number, optional) - If managed encryption is enabled on the project, the numeric ID of the encryption key as tracked by Central is given here.
+ archived: false (boolean, optional) - Whether the Project is archived or not. `null` is equivalent to `false`. All this does is sort the Project to the bottom of the list and disable management features in the web management application.

## Extended Project (Project)
+ appUsers: `4` (number, required) - The number of App Users created within this Project.
+ forms: `7` (number, required) - The number of forms within this Project.
+ lastSubmission: `2018-04-18T03:04:51.695Z` (string, optional) - ISO date format. The timestamp of the most recent submission to any form in this project, if any.

## Public Link (Actor)
+ token: `d1!E2GVHgpr4h9bpxxtqUJ7EVJ1Q$Dusm2RBXg8XyVJMCBCbvyE8cGacxUx3bcUT` (string, optional) - If present, this is the Token to include as the `st` query parameter for this `Public Link`. If not present, this `Public Link` has been revoked.
+ once: `false` (boolean, optional) - If set to `true`, an Enketo [single submission survey](https://blog.enketo.org/single-submission-surveys/) will be created instead of a standard one, limiting respondents to a single submission each.

## Extended Public Link (Public Link)
+ createdBy (Actor, required) - The full details about the `Actor` that created this `App User`.

## Key (object)
+ id: `1` (number, required) - The numerical ID of the Key.
+ public: `bcFeKDF3Sg8W91Uf5uxaIlM2uK0cUN9tBSGoASbC4LeIPqx65+6zmjbgUnIyiLzIjrx4CAaf9Y9LG7TAu6wKPqfbH6ZAkJTFSfjLNovbKhpOQcmO5VZGGay6yvXrX1TFW6C6RLITy74erxfUAStdtpP4nraCYqQYqn5zD4/1OmgweJt5vzGXW2ch7lrROEQhXB9lK+bjEeWx8TFW/+6ha/oRLnl6a2RBRL6mhwy3PoByNTKndB2MP4TygCJ/Ini4ivk74iSqVnoeuNJR/xUcU+kaIpZEIjxpAS2VECJU9fZvS5Gt84e5wl/t7bUKu+dlh/cUgHfk6+6bwzqGQYOe5A==` (string, required) - The base64-encoded public key, with PEM envelope removed.
+ managed: `true` (boolean, optional) - If true, this is a key generated by Project managed encryption. If not, this key is self-supplied.
+ hint: `it was a secret` (string, optional) - The hint, if given, related to a managed encryption key.

## User (Actor)
+ email: `my.email.address@opendatakit.org` (string, required) - Only `User`s have email addresses associated with them

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
+ submitterId: `23` (number, required) - The ID of the `Actor` (`App User` or `User`) that submitted this `Submission`.
+ deviceId: `imei:123456` (string, optional) - The self-identified `deviceId` of the device that collected the data, sent by it upon submission to the server.
+ createdAt: `2018-01-19T23:58:03.395Z` (string, required) - ISO date format
+ updatedAt: `2018-03-21T12:45:02.312Z` (string, optional) - ISO date format

## Extended Submission (Submission)
+ submitter (Actor, required) - The full details of the `Actor` that submitted this `Submission`.

## Submission Attachment (object)
+ name: `myfile.mp3` (string, required) - The name of the file as specified in the Submission XML.
+ exists: `true` (boolean, required) - Whether the server has the file or not.

## Success (object)
+ success: `true` (boolean, required)


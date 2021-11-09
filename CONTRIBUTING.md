# Contributing to ODK Central Backend

We want ODK Central Backend to be easy to install and use, yet flexible and powerful for a wide variety of projects and organizations. To do that, we need your help! Even if you don't write code, you are a valuable member of our community, and there are many ways you can help improve the project.

# Getting Involved

One of the easiest ways you can participate is to help us [track down bugs](https://github.com/getodk/central/issues), which we do over in the [ODK Central](https://github.com/getodk/central) repository. Did you run into some odd or puzzling behaviour? Did you have trouble installing or updating the server? Is a form upload or data export not working the way you'd expect? We want to know! Please do a quick search of the issues list to see if it's something that's already been submitted. Please do make an effort to figure out if the issue is related to this server, or some other tool you are using (like XLSForm, Build, or Collect). But when in doubt, submit your problem anyway.

## Questions and Discussion

If you are having trouble with making ODK Central Backend work correctly, we encourage you to visit the [community forum](https://forum.getodk.org) where a great many of your knowledgeable peers can help you with your problem.

If you're looking for help or discussion on _how_ ODK Central Backend works internally and how to understand or update its code, the ODK [developer Slack](https://slack.getodk.org/) is for you.

# Contributing Code

## Getting Started

Please see the [project README](https://github.com/getodk/central-backend#setting-up-a-development-environment) for instructions on how to set up your development environment.

## Guidelines

If you're starting work on an issue ticket, please leave a comment saying so. If you run into trouble or have to stop working on a ticket, please leave a comment as well. As you write code, the usual guidelines apply; please ensure you are following existing conventions:

* Our **code style** is loosely based on the [AirBnB Javascript Style Guide](https://github.com/airbnb/javascript), and you can run `make lint` in the project directory to check your code against it. We do make [some exceptions](https://github.com/getodk/central-backend/blob/master/.eslintrc.json) to their rules, and we do make exceptions to the linter when we have a reason and consensus to do so.
* More broadly, we also try to keep our code as maintainable as possible by doing the following:
    * Use [immutability](https://en.wikipedia.org/wiki/Immutable_object) (`const`), [pure functions](https://medium.com/@jamesjefferyuk/javascript-what-are-pure-functions-4d4d5392d49c), [higher-order-functions](https://medium.com/javascript-scene/higher-order-functions-composing-software-5365cf2cbe99) (eg when you see stacked arrow functions like `(x) => (y) => …`) and [functional composition](https://hackernoon.com/javascript-functional-composition-for-every-day-use-22421ef65a10) wherever possible. It should almost always be possible. If you are not sure how to accomplish something with these techniques, please don't be afraid to ask for advice.
    * Reduce or eliminate tight coupling and direct dependencies within the codebase as much as possible. Ideally, things you need can be passed in rather than directly instantiated or required; the dependency injection system we have built (see below) should help.
    * As with any Node.js project, use Streams and Promises whenever dealing with I/O (reading client requests, loading things from the filesystem, database requests, etc).
    * We use [Ramda](http://ramdajs.com/) to help manipulate our data structures. In general, if you have algorithmic data structure work to do, look to see if Ramda has an answer that can help you.
    * We often use `for..of` loops rather than `array.forEach` because they are quite a bit faster. But we do still use either `array.map` or Ramda `map()` rather than build our own result arrays a lot of the time.
    * If a function causes mutation to invisible state or to input data, we try not to return anything from that function.
* We try to **test** (`make test`) as much of our code as possible:
    * If writing framework or utility functions that are easy to test in isolation, favor the use of **unit tests** to verify the code. If a function's input is very easy to directly construct or mock, for example, it is likely a good candidate for unit testing. You can find the existing unit tests in `/test/unit`, and you can run `make test-unit` to run only the unit tests.
    * When writing code that is more closely related to other code, **integration tests** are the best tool. If the inputs to a function require a lot of work to construct or mock, for example, you likely want to write an integration test. In addition, our integration tests are our ultimate verification that the external API works as expected: if you are making a change that affects the input or output of any HTTP API, please write an integration test for it. You can find the existing integration tests in `/test/integration`, and you can run `make test-integration` to run only the integration tests.
    * We do not zealously track our code coverage, but it is a very useful tool for spotting input or output cases that _are_ easy to test that have been missed. We don't have any particular code coverage percentage goal, but please do run the code coverage tool (`make test-coverage`) and look over any code you have changed to see if there are more tests you should write.
* Please format your **commit messages** appropriately:
    * Ensure that your first commit line is 72 characters or fewer, and if you include further text in your commit message that there is an empty line following the leading line.
    * Start your commit message with one of the following tags:
      * `new:` denotes new user features or code functionality.
      * `improve:` indicates an improvement to how an existing feature or code worked.
      * `bug:` should be used when a bug was fixed.
      * `refactor:` is used when big code changes occur internally.
      * `noop:` can be applied to small low-impact changes (eg style fixes or comments).
    * Tag with the GitHub issue number if relevant; eg: `bug #41:`.
    * Please be as descriptive as possible in the 72 characters allowed. This helps us _a lot_ when writing release notes and tracking down regressions. Here are some examples:
      * Instead of `Fixing bugs`, consider `bug #1372: negative top/skip values would break odata output`.
      * Instead of `Updating readme`, consider `improve: making build instructions clearer in README`.
      * Instead of `Adding some tests`, consider `test #889: missing test cases for permissions given anonymous user`.

Once you feel ready to share your progress, please feel free to submit a Pull Request even if you're not quite done. This lets others look over your work and make suggestions before you spend too much time in some particular direction. [Here](https://yangsu.github.io/pull-request-tutorial/) is a great guide on the process of creating a PR.

## Framework Concepts

We have built a lot of custom framework to try to keep ODK Central Backend as flexible and easy to update as possible. We have structured the code in layers:

* The business logic defining the functionality and behavior of the server for users is the outermost layer, and it is the easiest to understand and update.
* The model and database logic defining the Things in the server (Users, Forms, etc) and how they are stored and retrieved from the database are the middle layer. They are still easy to understand and update, but you'll need to understand a little bit more about how other code uses these Things and how the underlying framework works in order to make changes.
    * Whenever possible, we rely on the database to perform data validation rather than implement it in Javascript code. This way, we can be more certain that invalid data hasn't found its way into databases. When the database complains about data validation problems, we translate those problems into user-friendly errors and return them.
* The innermost layer is the framework code, which provides for the other layers easy ways to define and glue together bits of work. It is internally the most intricate, but it should not need to be changed very often.

### Middleware and Preprocessors

We do something a little bit odd: we only use actual Express middleware sparingly. Besides the usual assortment of stock/packaged parsers and loggers, only middleware that rewrites the incoming request URL are actually implemented as Express middleware; everything else we run as what we call a preprocessor.

What this looks like is as follows: an incoming request gets sent through the usual Express stack, including the small number of actual middleware we have. Express the routes the request to a specific resource handler (for instance in `service.post('/some/path', handler)`). We wrap all our `handler`s in an `endpoint(handler)`, which you'll see used in context as you look at the code. The first thing this does is run a series of middleware-like preprocessors that do things like attach user authentication to the request context, one after another, sort of like Express would with actual middleware. The primary difference is that our preprocessors work based on Promises rather than callbacks and mutable Response state.

And in fact, this difference is exactly the reason we have gone with this route: the way `endpoint` formulates the entire lifecycle from preprocessors to the format handler to the actual resource handler itself through to success and failure wire output is as a singular Promise tree. This means that we have a single notion of pass and fail, which we can then hand off to the database transaction manager to determine whether the request operations should be commited or rolled back with a single decision point.

You will find more information about this in the comments in the code itself.

### Dependency Injection

Additionally, the entire server relies heavily on using [dependency injection](https://en.wikipedia.org/wiki/Dependency_injection) rather than direct `require()` statements to pull in dependent code. This helps reduce coupling between files and improves our ability to mock various things for tests. For the most part, if you follow the code patterns that already exist, the usage should become clear. But if you are adding new `Instance` or `query` modules, you will need to visit `/lib/model/package.js` and add references to those modules at the bottom, again following the existing pattern. There are notes in the following documentation to help explain these usages.

### Wire Security

Our general way of handling data element security (eg the user should be able to save things like `displayName` to their own account, but should not be able to directly set `password`; and we will query things like `password` out of the database but it should never be returned to the user over the API) is always at the outermost boundary: the moment of serialization to the wire or deserialization from the wire.

You will find all this management in the various `Instance` classes. The default implementation of methods `forApi` and `fromApi` will use the whitelist schema definitions `readable` and `writable` to determine what values should be allowed to be serialized to the user, and deserialized into a local data object in memory, respectively. Any data object in local memory is presumed to be completely safe to do with at will; there is not, for instance, a separate data security check at the database write level.

If you override the default `forApi` and `fromApi`, it will be up to you to maintain this pattern.

### Form Encryption

We implement the [ODK XForms Encryption Specification](http://getodk.github.io/xforms-spec/encryption) to enable form encryption in transit from the device (in cases where HTTPS is not possible) and at rest on the Central server. In these cases, the XML stored in the `xml` column on the submission is actually the encryption manifest, which lists the files and keys that would be needed to decrypt the data in that submission successfully. The actual encrypted form data is stored as a separate attachment, typically named `submission.xml.enc` (but the name is up to the client).

Within this specification, we also create our own Managed Encryption system, so that with the use of a passphrase the Central server can create and manage the encryption keypair on behalf of the user, rather than make users learn things like OpenSSL and how to store keys securely.

In general, we try to follow these principles in dealing with encrypted and sensitive data:

1. The passphrase and cleartext private key should be passed around as little as possible, and should never hit the disk (within our control; the OS pagefile we can't help). The passphrase is taken in and processed at the API service layer, and passed to `Key.getDecryptor`, which fetches the relevant data from the database, combining it with the passphrase data, and all of this goes into the `getDecryptor` function. This function decrypts the relevant private keys, but these never leave the local function scope context; instead, a second-order function is returned which is capable of decrypting data.
2. Part of how we ensure this sandboxing is the sequestering of all cryptographic processing into the `lib/util/crypto.js` file. If you search the repository for `crypto` you should find very few references elsewhere in the codebase.
3. We have to do a lot of processing of decrypted cleartext after decryption is done; we have to translate data XML into CSV format, for example. We don't allow this data to hit the disk, but we don't take nearly as many precautions with this data as we do with the passphrase and private key data, as the end goal is the pass the decrypted data back to the user over the API anyway.
4. The encryption specification is quite open-ended, and we are not sure what direction the Central management experience for encryption is going to go in. So we work hard to be flexible in the face of any possible combination of encryption applications; using self-managed and Central-managed keys in tandem, using multiple managed keys, mixed plaintext/encrypted records, and so on. We also take care to test all these different mixed cases.

## Navigating the Code

Here is an overview of the directory structure inside of `lib/`:

* `bin/` contains all the executable scripts. These include `run-server.js`, which actually starts the ODK Central Backend server, but also the `cli.js` command line administration utility, and scripts like the `backup.js` executable which runs the configured backup.
* `data/` files deal with Submission row data in various ways. They are very independent, callable from any context (they don't rely on any database code, for example), and so they are separated out here. The `schema.js` file contains a lot of utilities for understanding and using XForms XML schema definitions, while the other files deal with Submission row data.
* `http/` defines a lot of core functionality for how we use Express, the Node.js server framework we rely on. The `endpoint.js` Endpoints are wrapper functions we use on most endpoints in our code (see `resources/`), `middleware.js` are middleware layers that catch the requests as they come in and decorate various common information onto them, and `service.js` is the glue code that actually ties together the middleware and resources to form an Express service.
* `model/` is the most complex area of code; it defines all the Things (Users, Forms, etc) in the server and how they are stored and retrieved from the database. It also contains our database migrations.
    * `model/instance/` defines the actual `Instance`s of the various Things that get passed around, including the static and instance methods available on them. The data associated with each `Instance` (`id`, `name`, `createdAt`, etc) are direct properties on the `Instance`. There are some common methods that are called by the framework, like `forApi` which reformats and filters the data for public consumption, and `forCreate` which decorates and formats the data for storage in the database. All dependencies are declared and injected at the very top of the file, on the line that begins `module.exports = Instance(…`.
    * `model/migrations/` contains the database migrations for the project. Please follow the date-based naming convention of the existing files. Migrations help us update the database structure itself to support changes and new features.
    * `model/query/` contains database queries for storing and retrieving `Instance`s. They are composable, and many of them rely on the basic operations available in `simply.js`, which defines generic get/set operations, and `all.js`, which allows multiple queries to be assembled together. All database queries should be put in these files. For each query, the first order arguments are whatever the query needs to work and are how the query will eventually be called, while dependencies are declared and injected as the second order arguments.
    * `model/trait/` defines some common functionality used across many `Instance` definitions. Like the instance methods directly declared on the `Instance`s, they do simple data operations like retrieve particular properties in particular cases.
    * `model/package.js` is an important file; all the code in `model/instance` and `model/query` rely on dependency injection, and this package file is where they are all declared so that the server knows about them. If you are adding any `Instance`s or `query` modules, you'll need to visit this file and add a line or two at the bottom.
* `outbound/` contains various utilities for templating and sending messages of various kinds: `mail.js`, for example, contains all the email messages we might send as well as the machinery to do so, and `openrosa.js` contains templates for different OpenRosa XML responses.
* `resources/` is where all the HTTP API endpoints are declared; they are the REST Resources of the server (hence the name). This is, in the layers we describe above, the outermost layer. Most of our resources are wrapped in an `endpoint()` function of some sort, declared in `http/`. The `endpoint()` functions help process the final output of each endpoint, performing useful operations like resolving `Promise`s, managing output `Stream`s, and handling some errors.
* `task/` contains many utility operations that we use to construct the scripts in `bin/`, like `cli.js` and the backup/restore scripts. They are native `Promise`s and can be easily composed with `.then()`, like any other `Promise`. In `task.js`, there are various helpers to help print meaningful output for these operations and log audit logs on operations. There is also a `task.withContainer()` method which helps if you need any `model`/`Instance` code in a task (see `task/account.js` for usage).
* `util/` defines a large number of really tiny helper functions and data structures that are used all over the application, as well as some generic tasks like cryptography. Of note is `option.js`, which defines the `Option[T]` class we use when a return type might be empty.


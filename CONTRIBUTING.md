Contributing to Jubilant Garbanzo
=================================

We want Jubilant Garbanzo to be easy to install and use, yet flexible and powerful for a wide variety of projects and organizations. To do that, we need your help! Even if you don't write code, you are a valuable member of our community, and there are many ways you can help improve the project.

Getting Involved
----------------

One of the easiest ways you can participate is to help us [track down bugs](https://github.com/nafundi/jubilant-garbanzo/issues). Did you run into some odd or puzzling behaviour? Did you have trouble installing or updating the server? Is a form upload or data export not working the way you'd expect? We want to know! Please do a quick search of the issues list to see if it's something that's already been submitted. Please do make an effort to figure out if the issue is related to Jubilant Garbanzo, or some other tool you are using. But when in doubt, submit your problem anyway.

Questions and Discussion
------------------------

If you are having trouble with making Jubilant Garbanzo work correctly, we encourage you to visit the [mailing list](https://groups.google.com/forum/#!forum/opendatakit) where a great many of your knowledgeable peers can help you with your problem.

If you're looking for help or discussion on _how_ Jubilant Garbanzo works internally and how to understand or update its code, the ODK [developer Slack](https://opendatakit.slack.com) is for you. If you don't want to sign up for Slack, please feel free to open an issue ticket here on GitHub.

Contributing Code
-----------------

If you're starting work on an issue ticket, please leave a comment saying so. If you run into trouble or have to stop working on a ticket, please leave a comment as well. As you write code, the usual guidelines apply; please ensure you are following existing conventions:

* Our **code style** is loosely based on the [AirBnB Javascript Style Guide](https://github.com/airbnb/javascript), and you can run `make lint` in the project directory to check your code against it. We do make [some exceptions](https://github.com/nafundi/jubilant-garbanzo/blob/master/.eslintrc.json) to their rules, and we do make exceptions to the linter when we have a reason and consensus to do so.
* More broadly, we also try to keep our code as maintainable as possible by doing the following:
    * Use [immutability](https://en.wikipedia.org/wiki/Immutable_object) (`const`), [pure functions](https://medium.com/@jamesjefferyuk/javascript-what-are-pure-functions-4d4d5392d49c), and [functional composition](https://hackernoon.com/javascript-functional-composition-for-every-day-use-22421ef65a10) wherever possible. It should almost always be possible. If you are not sure how to accomplish something with these techniques, please don't be afraid to ask for advice.
    * Reduce or eliminate co-dependencies within the codebase as much as possible. Ideally, things you need can be passed in rather than directly instantiated or required; the dependency injection system we have built (see below) should help.
    * As with any Node.js project, use Streams and Promises whenever dealing with I/O (reading client requests, loading things from the filesystem, database requests, etc).
    * We use [Ramda](http://ramdajs.com/) to help manipulate our data structures. In general, if you have algorithmic data structure work to do, look to see if Ramda has an answer that can help you.
    * We often use `for..of` loops rather than `array.forEach` because they are quite a bit faster. But we do still use either `array.map` or Ramda `map()` rather than build our own result arrays a lot of the time.
* We try to **test** (`make test`) as much of our code as possible:
    * If writing framework or utility functions that are easy to test in isolation, favor the use of **unit tests** to verify the code. If a function's input is very easy to directly construct or mock, for example, it is likely a good candidate for unit testing. You can find the existing unit tests in `/test/unit`, and you can run `make test-unit` to run only the unit tests.
    * When writing code that is more closely related to other code, **integration tests** are the best tool. If the inputs to a function require a lot of work to construct or mock, for example, you likely want to write an integration test. In addition, our integration tests are our ultimate verification that the external API works as expected: if you are making a change that affects the input or output of any HTTP API, please write an integration test for it. You can find the existing integration tests in `/test/integration`, and you can run `make test-integration` to run only the integration tests.
    * We do not zealously track our code coverage, but it is a very useful tool for spotting input or output cases that _are_ easy to test that have been missed. We don't have any particular code coverage percentage goal, but please do run the code coverage tool (`make test-coverage`) and look over any code you have changed to see if there are more tests you should write.
* Please format your **commit messages** appropriately:
    * Ensure that your first commit line is 72 characters or fewer, and if you include further text in your commit message that there is an empty line following the leading line.
    * Start your commit message with one of the following tags: `new:`, `improve:`, `bug:`, `refactor:`, or `noop:` for new features, improvements to existing functionality or code, fixes, big code refactors, and small low-impact changes (eg style fixes or comments) respectively.
    * Tag with the GitHub issue number if relevant; eg: `bug #41:`.
    * Please be as descriptive as possible in the 72 characters allowed. This helps us _a lot_ when writing release notes and tracking down regressions. Here are some examples:
        * Instead of `Fixing bugs`, consider `bug #1372: negative top/skip values would break odata output`.
        * Instead of `Updating readme`, consider `improve: making build instructions clearer in README.`
        * Instead of `Adding some tests`, consider `test #889: missing test cases for permissions given anonymous user`

Once you feel ready to share your progress, please feel free to submit a Pull Request even if you're not quite done. This lets others look over your work and make suggestions before you spend too much time in some particular direction. [Here](https://yangsu.github.io/pull-request-tutorial/) is a great guide on the process of creating a PR.

Framework Concepts
------------------

We have built a lot of custom framework to try to keep Jubilant Garbanzo as flexible and easy to update as possible. We have structured the code in layers:

* The business logic defining the functionality and behavior of the server for users is the outermost layer, and it is the easiest to understand and update.
* The model and database logic defining the Things in the server (Users, Forms, etc) and how they are stored and retrieved from the database are the middle layer. They are still easy to understand and update, but you'll need to understand a little bit more about how other code uses these Things and how the underlying framework works in order to make changes.
* The innermost layer is the framework code, which provides for the other layers easy ways to define and glue together bits of work. It is internally the most intricate, but it should not need to be changed very often.

There are a couple of core concepts that are worth explaining up front:

In most of the server, we use custom `ExplicitPromise`s rather than JS-native `Promise`s. The main difference is that `ExplicitPromise`s do not perform their work as soon as they are created. This has two advantages: the first is that we can formulate and pass around units of work that we might not need without wasting computing time on them, and the second is that we can provide those units of work with additional context that the code creating the work does not know about.

Transactions are a great example of why this might be useful: we might have some method `x.getUser()` that, for example, gets a User from the database. In some cases, this is a very simple task: the database query is sent over the network, and a `Promise[User]` is returned that the method caller can use. But what if we are getting a user so that we can update it? We need a database transaction to happen, and we need the transaction to start before we call `x.getUser()`. We have a couple of options; we can add an argument to the method `x.getUser(myTransaction)` that uses a transaction we pass in if we need it. But this gets tedious to implement over many many database operations, and requires a lot of manual work that can easily go wrong. Ideally, `x.getUser()` never needs to understand how it might be used or whether that usage needs a transaction. This is where the `ExplicitPromise` helps us a lot, because it lets us tell `x.getUser()` about the transaction later on, when we are sure if we need it or not.

We have done a lot of work so that unless you are modifying the core framework code, you rarely have to understand how or why this construction works. For the most part, you can write code like `x.getUser().then((user) => user.update(…))` and because `user.update()` requires a transaction, one will automatically be created to manage the entire operation. The main exception is that if you are mixing `ExplicitPromise`s and native `Promise`s (ie as returned by third-party libraries), you will need to wrap the native `Promise`s with the `ExplicitPromise.of()` method. If you do wish to learn more about how this system works, please read the comment at the top of [this file](https://github.com/nafundi/jubilant-garbanzo/blob/master/lib/model/query/future-query.js).

Additionally, the entire server relies heavily on using [dependency injection](https://en.wikipedia.org/wiki/Dependency_injection) rather than direct `require()` statements to pull in dependent code. This helps reduce coupling between files and improves our ability to mock various things for tests. For the most part, if you follow the code patterns that already exist, the usage should become clear. But if you are adding new `Instance` or `query` modules, you will need to visit `/lib/model/package.js` and add references to those modules at the bottom, again following the existing pattern. There are notes in the following documentation to help explain these usages.

Navigating the Code
-------------------

Here is an overview of the directory structure inside of `lib/`:

* `bin/` contains all the executable scripts. These include `run-server.js`, which actually starts the Jubilant Garbanzo server, but also the `cli.js` command line administration utility, and scripts like the `backup.js` executable which runs the configured backup.
* `data/` files deal with Submission row data in various ways. They are very independent, callable from any context (they don't rely on any database code, for example), and so they are separated out here. The `schema.js` file contains a lot of utilities for understanding and using XForms XML schema definitions, while the other files deal with Submission row data.
* `http/` defines a lot of core functionality for how we use Express, the Node.js server framework we rely on. The `endpoint.js` Endpoints are wrapper functions we use on most endpoints in our code (see `resources/`), `middleware.js` are middleware layers that catch the requests as they come in and decorate various common information onto them, and `service.js` is the glue code that actually ties together the middleware and resources to form an Express service.
* `model/` is the most complex area of code; it defines all the Things (Users, Forms, etc) in the server and how they are stored and retrieved from the database. It also contains our database migrations.
    * `model/instance` defines the actual `Instance`s of the various Things that get passed around, including the static and instance methods available on them. The data associated with each `Instance` (`id`, `name`, `createdAt`, etc) are direct properties on the `Instance`. There are some common methods that are called by the framework, like `forApi` which reformats and filters the data for public consumption, and `forCreate` which decorates and formats the data for storage in the database. All dependencies are declared and injected at the very top of the file, on the line that begins `module.exports = Instance(…`.
    * `model/migrations` contains the database migrations for the project. Please follow the date-based naming convention of the existing files. Migrations help us update the database structure itself to support changes and new features.
    * `model/query` contains database queries for storing and retrieving `Instance`s. They are composable, and many of them rely on the basic operations available in `simply.js`, which defines generic get/set operations, and `all.js`, which allows multiple queries to be assembled together. All database queries should be put in these files. For each query, the first order arguments are whatever the query needs to work and are how the query will eventually be called, while dependencies are declared and injected as the second order arguments.
    * `model/trait` defines some common functionality used across many `Instance` definitions. Like the instance methods directly declared on the `Instance`s, they do simple data operations like retrieve particular properties in particular cases.
    * `model/package.js` is an important file; all the code in `model/instance` and `model/query` rely on dependency injection, and this package file is where they are all declared so that the server knows about them. If you are adding any `Instance`s or `query` modules, you'll need to visit this file and add a line or two at the bottom.
* `outbound/` contains various utilities for templating and sending messages of various kinds: `mail.js`, for example, contains all the email messages we might send as well as the machinery to do so, and `openrosa.js` contains templates for different OpenRosa XML responses.
* `resources/` is where all the HTTP API endpoints are declared; they are the REST Resources of the server (hence the name). This is, in the layers we describe above, the outermost layer. Most of our resources are wrapped in an `endpoint()` function of some sort, declared in `http/`. the `endpoint()` functions help process the final output of each endpoint, performing useful operations like resolving `Promise`s, managing output `Stream`s, and handling some errors.
* `task/` contains many utility operations that we use to construct the scripts in `bin/`, like `cli.js` and the backup/restore scripts. They are native `Promise`s and can be easily composed with `.then()`, like any other `Promise`. In `task.js`, there are various helpers to help print meaningful output for these operations and log audit logs on operations. There is also a `task.withContainer()` method which helps if you need any `model`/`Instance` code in a task (see `task/account.js` for usage).
* `util/` defines a large number of really tiny helper functions and data structures that are used all over the application, as well as some generic tasks like cryptography. Of note are `option.js`, which defines the `Option[T]` class we use when a return type might be empty, as well as the `promise.js` file, which declares the basic `ExplicitPromise` described above.


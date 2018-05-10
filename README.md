# Jubilant Garbanzo

![Platform](https://img.shields.io/badge/platform-Node.js-blue.svg)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Build status](https://circleci.com/gh/nafundi/jubilant-garbanzo.svg?style=shield)](https://circleci.com/gh/nafundi/jubilant-garbanzo)

Jubilant Garbanzo (or just Jubilant for short) is a minimal [Open Data Kit](https://opendatakit.org/) server based on Node.js and Postgres. It is currently under development. This repository holds back-end code only: [Super Adventure](https://github.com/nafundi/super-adventure) holds front-end code, and [Effective Spork](https://github.com/nafundi/effective-spork) contains both the Docker-based production deployment infrastructure for the combined frontend/backend, as well as the higher-level project management and issue tickets.

## Setting up your development environment

First, install Node.js 8.

Next, create a database and user in Postgres. Either use the same settings as the [default configuration file](config/default.json), or update your local configuration file to match the settings you choose. For example:

```sql
CREATE USER jubilant WITH PASSWORD 'jubilant';
CREATE DATABASE jubilant with owner=jubilant encoding=UTF8;
```

Then, simply go to the repository root in a command line (where this README is) and run `make` with no arguments. This will install all npm dependencies and run all necessary migrations on the database; see the [makefile](Makefile) for details.

### Starting the development server

To run the server, run `make run` from the repository root. Once started, the server will be available on port `8383`.

You can also run `make debug` to run the server with a standard node inspector port running (use your favorite tool, or visit [about:inspect](chrome://inspect) in Chrome to attach breakpoints and step through statements).

### Command line scripts

A number of operational tasks (creating accounts, setting passwords, etc) may be accomplished directly via local command line. These may be accessed by running `node lib/cli.js` from the project root. The full list of commands and arguments will be provided by the script.

### Sending email

It isn't necessary to send mail in order to run a development server. The default email configuration (see `config/default.json`) uses the `json` transport (as does the test configuration), in which case emails are outputted to the local server log and delivery is not attempted.

If one wishes to send mail, the `sendmail` provider is relatively foolproof so long as it is available locally. Postfix is the easiest way to ensure this. It may be necessary to configure Postfix to negotiate TLS with servers it connects to. If so, these commands ought to suffice:

```bash
sudo postfix tls enable-client
sudo postfix start
```

Even so, often mail messages will go at first to spam, so be sure to check that.

## Testing

Jubilant is tested with both unit and integration tests. The unit tests (`/test/unit`) check, in isolation, the more-complex parts of Jubilant's core code, such as the query promise and model systems, the various util functions, and some of the http handlers. The integration tests (`/test/integration`) focus on verifying the correct behaviour of the API itself and the business logic (ie the `lib/resources/*` code and therefore concrete model/query implementation) which are independently simple but which altogether form a complex system.

To run all tests (both unit and integration), run `make test` in the project root. We use [Mocha](https://mochajs.org/), [Should.js](https://shouldjs.github.io/), and [Supertest](https://github.com/visionmedia/supertest) as our testing frameworks. [CircleCI](https://circleci.com/gh/nafundi/jubilant-garbanzo) is configured to run all tests for verification.

Various commands are available:

* To run only unit tests (which are much speedier than integration tests), run `make test-unit` in the project root.
* To run only API integration tests, run `make test-integration` instead.
* As provided by default by Mocha, add `.only` after any `describe` or `it` call in the tests to run only the marked tests.
* To examine test coverage (runs both test suites), type `make test-coverage`. We use [Istanbul](https://istanbul.js.org/).

## Style Guidelines

Please see the [Contribution Guide](https://github.com/nafundi/jubilant-garbanzo/blob/master/CONTRIBUTING.md) for complete information on our coding style.

We use linting as _a part of_ coding style verification. To run the linter, run `make lint` from the repository root. We use [ESLint](https://eslint.org/) with [rules](.eslintrc.json) based on the [Airbnb JavaScript style guide](https://github.com/airbnb/javascript). The linter is not perfect; we will make exceptions when we have a consensus to do so.

